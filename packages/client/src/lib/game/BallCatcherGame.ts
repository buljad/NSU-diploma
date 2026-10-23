// packages/client/src/lib/game/BallCatcherGame.ts
//
// Главный оркестратор игры «Поймай мяч».
// Связывает все подсистемы, управляет жизненным циклом.
//
// DESIGN:
//   • НЕ знает о Svelte, Canvas, DOM или stabilogramStore.
//   • Получает CoP-данные через параметры update().
//   • Предоставляет публичные поля и подсистемы для рендерера.
//   • getSnapshot() создаёт GameSnapshot для Svelte Store (вне render loop).
//
// ПОРЯДОК ОБНОВЛЕНИЯ (каждый кадр):
//   1. basketController.update(copX, copY, velX, velY, dt)
//   2. collisionDetector.check(pool, basket, score, dt, now)
//   3. ballPool.update(dt, now)
//   4. checkOffScreenBalls()
//   5. handleComfortZone(copX, copY, dt)
//   6. scoreManager.updateFloatingTexts(dt)
//   7. stageManager.update(score, pool, wobble, dt, now)
//   8. Проверка перехода этапа
//
// ZERO-GC в update():
//   ✅ Все вызовы — чтение/мутация примитивов
//   ✅ Никаких new, [], {}, .map(), .filter()
//   ✅ getSnapshot() — ЕДИНСТВЕННОЕ место с аллокацией (вызывается ~2-4 Гц)
// ─────────────────────────────────────────────────────────────

import type { GameSnapshot, DifficultyPreset, GamePauseReason, GameStageResult } from './types';
import {
	STAGE_MENU,
	STAGE_1,
	STAGE_RESULTS,
	STAGE_PAUSED,
	DIFF_MEDIUM,
	BALL_STATE_INACTIVE,
	BALL_STATE_FALLING,
	BALL_STATE_DWELLING
} from './types';
import { DIFFICULTY_PRESETS, BALL_DESPAWN_MARGIN, BALL_COLOR_NAMES } from './constants';
import { BallPool } from './BallPool';
import { BasketController } from './BasketController';
import { CollisionDetector } from './CollisionDetector';
import { ScoreManager } from './ScoreManager';
import { StageManager } from './StageManager';

/** Максимальный допустимый dt (секунды). Больше = физика ломается. */
const MAX_DT = 0.1;

/** Минимальный допустимый dt (секунды). Меньше = шум таймера. */
const MIN_DT = 0.001;

export class BallCatcherGame {
	// ════════════════════════════════════════════════
	// Публичные подсистемы (рендерер читает напрямую, zero-GC)
	// ════════════════════════════════════════════════

	readonly ballPool: BallPool;
	readonly basketController: BasketController;
	readonly collisionDetector: CollisionDetector;
	readonly scoreManager: ScoreManager;
	readonly stageManager: StageManager;

	// ════════════════════════════════════════════════
	// Публичное состояние (рендерер читает напрямую)
	// ════════════════════════════════════════════════

	/** Игра запущена? (false = меню или результаты) */
	isRunning: boolean = false;

	/** Игра на паузе? (WS disconnect, устройство отключено, и т.д.) */
	isPaused: boolean = false;

	/** Общее время с начала игры (мс) */
	totalElapsedMs: number = 0;

	/** Active game clock: spawning and animations never advance during a pause. */
	simulationTime: number = 0;

	/** Текущий уровень сложности (DIFF_* константа) */
	currentDifficulty: number = DIFF_MEDIUM;

	// ════════════════════════════════════════════════
	// Приватное состояние
	// ════════════════════════════════════════════════

	private canvasWidth: number;
	private canvasHeight: number;
	private lastUpdateTime: number = 0;
	private manualPaused = false;
	private transportPaused = false;
	private readonly stageResults: GameStageResult[] = [];
	private stageCatchBaseline = 0;
	private stageMissBaseline = 0;
	private stageWrongBaseline = 0;
	private stageScoreBaseline = 0;

	get pauseReason(): GamePauseReason | null {
		return this.manualPaused ? 'manual' : this.transportPaused ? 'transport' : null;
	}

	// ────────────────────────────────────────────────────
	// Конструктор
	// ────────────────────────────────────────────────────

	constructor(canvasWidth: number, canvasHeight: number) {
		this.canvasWidth = canvasWidth;
		this.canvasHeight = canvasHeight;

		// Создаём все подсистемы с MEDIUM-пресетом по умолчанию.
		// Реальная конфигурация происходит в start().
		const defaultPreset = DIFFICULTY_PRESETS[DIFF_MEDIUM];

		this.ballPool = new BallPool();
		this.basketController = new BasketController(canvasWidth, canvasHeight, defaultPreset);
		this.collisionDetector = new CollisionDetector();
		this.scoreManager = new ScoreManager();
		this.stageManager = new StageManager(canvasWidth, canvasHeight);
		this.stageManager.currentStage = STAGE_MENU;
	}

	// ────────────────────────────────────────────────────
	// Жизненный цикл
	// ────────────────────────────────────────────────────

	/**
	 * Запустить игру с выбранной сложностью.
	 * Сбрасывает всё состояние и начинает с Этапа 1.
	 *
	 * @param difficulty - DIFF_EASY / DIFF_MEDIUM / DIFF_HARD
	 */
	start(difficulty: number, now = performance.now()): void {
		this.currentDifficulty = DIFFICULTY_PRESETS[difficulty] ? difficulty : DIFF_MEDIUM;
		const preset = this.getDifficultyPreset(difficulty);

		// Сброс всех подсистем
		this.ballPool.deactivateAll();
		this.basketController.configure(preset);
		this.basketController.reset();
		this.scoreManager.reset();
		this.stageManager.reset();

		// Настройка первого этапа
		this.simulationTime = 0;
		this.stageResults.length = 0;
		this.stageCatchBaseline =
			this.stageMissBaseline =
			this.stageWrongBaseline =
			this.stageScoreBaseline =
				0;
		this.stageManager.configure(this.currentDifficulty, STAGE_1, this.scoreManager, 0);
		this.collisionDetector.configure(this.stageManager.effectiveDwellTimeMs);

		// Запуск
		this.isRunning = true;
		this.isPaused = false;
		this.manualPaused = this.transportPaused = false;
		this.totalElapsedMs = 0;
		this.lastUpdateTime = now;
	}

	/**
	 * Поставить игру на паузу.
	 * Вызывается при потере WS, отключении устройства, и т.д.
	 */
	pause(reason: GamePauseReason = 'manual'): void {
		if (!this.isRunning) return;
		if (reason === 'manual') this.manualPaused = true;
		else this.transportPaused = true;
		this.isPaused = this.manualPaused || this.transportPaused;
	}

	/**
	 * Снять паузу.
	 */
	resume(reason: GamePauseReason = 'manual', now = performance.now()): void {
		if (!this.isRunning || !this.isPaused) return;
		if (reason === 'manual') this.manualPaused = false;
		else this.transportPaused = false;
		const stillPaused = this.manualPaused || this.transportPaused;
		if (this.isPaused && !stillPaused) this.lastUpdateTime = now;
		this.isPaused = stillPaused;
	}

	/** Reconnection may clear only a transport pause, and only on fresh input. */
	updateTransportState(connected: boolean, fresh: boolean, now = performance.now()): void {
		if (!this.isRunning) return;
		if (!connected || !fresh) this.pause('transport');
		else this.resume('transport', now);
	}

	/**
	 * Перезапустить игру с текущей сложностью.
	 */
	restart(): void {
		this.start(this.currentDifficulty);
	}

	/**
	 * Остановить игру (выход в меню).
	 */
	stop(): void {
		this.isRunning = false;
		this.isPaused = false;
		this.manualPaused = this.transportPaused = false;
		this.stageManager.currentStage = STAGE_MENU;
		this.ballPool.deactivateAll();
	}

	// ────────────────────────────────────────────────────
	// Главный цикл обновления (ZERO-GC)
	// ────────────────────────────────────────────────────

	/**
	 * Обновить состояние игры. Вызывается Canvas-компонентом
	 * в requestAnimationFrame (60-144 Гц).
	 *
	 * ZERO-GC: Только чтение/мутация примитивов и вызовы методов.
	 *
	 * @param copX  - CoP X в мм (stabilogramStore.getRenderPosition().x)
	 * @param copY  - CoP Y в мм (stabilogramStore.getRenderPosition().y)
	 * @param velX  - Скорость CoP X в мм/с
	 * @param velY  - Скорость CoP Y в мм/с
	 * @param now   - performance.now()
	 */
	update(copX: number, copY: number, velX: number, velY: number, now: number): void {
		// ── Ранний выход ──
		if (!this.isRunning || this.isPaused) return;

		const stage = this.stageManager.currentStage;
		if (stage === STAGE_MENU || stage === STAGE_RESULTS) return;

		// ── Дельта времени ──
		const dtRaw = (now - this.lastUpdateTime) * 0.001; // мс → сек
		this.lastUpdateTime = now;

		// Защита от взрыва физики (первый кадр, ALT+TAB, отладчик)
		if (dtRaw < MIN_DT || dtRaw > MAX_DT) return;

		const dt = dtRaw;
		this.totalElapsedMs += dt * 1000;
		this.simulationTime += dt * 1000;
		const activeTime = this.simulationTime;

		// ═══════════════════════════════════════
		// 1. КОРЗИНКА
		// ═══════════════════════════════════════
		this.basketController.update(copX, copY, velX, velY, dt);

		// ═══════════════════════════════════════
		// 2. КОЛЛИЗИИ (шары ещё на позициях пред. кадра → выгодно игроку)
		// ═══════════════════════════════════════
		this.collisionDetector.check(
			this.ballPool,
			this.basketController,
			this.scoreManager,
			dt,
			activeTime
		);

		// ═══════════════════════════════════════
		// 3. ФИЗИКА ШАРОВ (движение, fade-in, анимации)
		// ═══════════════════════════════════════
		this.ballPool.update(dt, activeTime);

		// ═══════════════════════════════════════
		// 4. ВЫЛЕТ ЗА ЭКРАН
		// ═══════════════════════════════════════
		this.checkOffScreenBalls();

		// ═══════════════════════════════════════
		// 5. ЗОНА КОМФОРТА
		// ═══════════════════════════════════════
		this.handleComfortZone(copX, copY, dt);

		// ═══════════════════════════════════════
		// 6. ВСПЛЫВАЮЩИЕ ТЕКСТЫ ОЧКОВ
		// ═══════════════════════════════════════
		this.scoreManager.updateFloatingTexts(dt);

		// ═══════════════════════════════════════
		// 7. ЭТАП: спавн, смена цвета, проверка перехода
		// ═══════════════════════════════════════
		const shouldAdvance = this.stageManager.update(
			this.scoreManager,
			this.ballPool,
			this.basketController.basket.wobbleIntensity,
			dt,
			activeTime
		);

		if (shouldAdvance) {
			this.advanceStage(activeTime);
		}
	}

	// ────────────────────────────────────────────────────
	// Снимок состояния (для Svelte Store, ~2-4 Гц)
	// ────────────────────────────────────────────────────

	/**
	 * Создать снимок состояния для UI.
	 *
	 * ⚠️ АЛЛОКАЦИЯ: Создаёт объект GameSnapshot.
	 *    Вызывать НЕ в render loop, а по таймеру или при событиях.
	 */
	getSnapshot(): GameSnapshot {
		const sm = this.stageManager;
		const sc = this.scoreManager;

		return {
			stage: sm.currentStage,
			difficulty: this.currentDifficulty,
			score: sc.score,
			streak: sc.streak,
			bestStreak: sc.bestStreak,
			targetColorIndex: sm.targetColorIndex,
			targetColorName: sm.getTargetColorName(),
			catchCount: sc.catchCount,
			missCount: sc.missCount,
			wrongCatchCount: sc.wrongCatchCount,
			stageTimeRemaining: sm.getTimeRemainingSec(),
			totalElapsed: this.totalElapsedMs * 0.001,
			isInComfortZone: sc.isInComfortZone,
			comfortZoneTime: sc.comfortZoneTime,
			isPaused: this.isPaused,
			isRunning: this.isRunning,
			pauseReason: this.pauseReason,
			stages: this.stageResults.map((result) => ({ ...result }))
		};
	}

	// ────────────────────────────────────────────────────
	// Canvas resize
	// ────────────────────────────────────────────────────

	updateCanvasSize(width: number, height: number): void {
		this.canvasWidth = width;
		this.canvasHeight = height;
		this.basketController.updateCanvasSize(width, height);
		this.stageManager.updateCanvasSize(width, height);
	}

	// ────────────────────────────────────────────────────
	// Private: переход этапа
	// ────────────────────────────────────────────────────

	/**
	 * Перейти к следующему этапу.
	 * Очищает шары, настраивает подсистемы под новый этап.
	 */
	private advanceStage(now: number): void {
		const score = this.scoreManager;
		this.stageResults.push({
			stage: this.stageManager.currentStage,
			elapsedSeconds: this.stageManager.stageElapsedMs / 1000,
			catches: score.catchCount - this.stageCatchBaseline,
			misses: score.missCount - this.stageMissBaseline,
			wrongCatches: score.wrongCatchCount - this.stageWrongBaseline,
			score: score.score - this.stageScoreBaseline
		});
		this.stageCatchBaseline = score.catchCount;
		this.stageMissBaseline = score.missCount;
		this.stageWrongBaseline = score.wrongCatchCount;
		this.stageScoreBaseline = score.score;
		const nextStage = this.stageManager.getNextStage();

		// Очистить все шары (чистый переход для детей)
		this.ballPool.deactivateAll();

		if (nextStage === STAGE_RESULTS) {
			// ══ Игра завершена ══
			this.stageManager.currentStage = STAGE_RESULTS;
			this.isRunning = false;
			return;
		}

		// ══ Настроить новый этап ══
		this.stageManager.configure(this.currentDifficulty, nextStage, this.scoreManager, now);

		// Обновить dwell time в CollisionDetector
		this.collisionDetector.configure(this.stageManager.effectiveDwellTimeMs);
	}

	// ────────────────────────────────────────────────────
	// Private: вылет шаров за экран
	// ────────────────────────────────────────────────────

	/**
	 * Проверить все активные шары на вылет за нижний край Canvas.
	 *
	 * ZERO-GC: Итерация по фиксированному массиву, мутация полей.
	 */
	private checkOffScreenBalls(): void {
		const balls = this.ballPool.balls;
		const cap = this.ballPool.capacity;
		const bottomEdge = this.canvasHeight + BALL_DESPAWN_MARGIN;

		for (let i = 0; i < cap; i++) {
			const b = balls[i];

			// Только FALLING и DWELLING могут «улететь»
			if (b.state !== BALL_STATE_FALLING && b.state !== BALL_STATE_DWELLING) {
				continue;
			}

			if (b.y <= bottomEdge) continue;

			// Шар улетел за экран
			if (b.isTarget) {
				// Целевой шар пропущен — штраф
				this.scoreManager.onMiss(b.x, this.canvasHeight - 30);
				this.ballPool.markMissed(i);
			} else {
				// Нецелевой шар — просто деактивируем (без штрафа)
				this.ballPool.deactivate(i);
			}
		}
	}

	// ────────────────────────────────────────────────────
	// Private: зона комфорта
	// ────────────────────────────────────────────────────

	/**
	 * Проверить нахождение в зоне комфорта и начислить бонус.
	 *
	 * ZERO-GC: Скалярные вызовы.
	 */
	private handleComfortZone(copX: number, copY: number, dt: number): void {
		const inZone = this.basketController.isInComfortZone(copX, copY);
		const bonus = this.scoreManager.updateComfortZone(inZone, dt);

		if (bonus) {
			// Бонус! Текст в центре Canvas
			this.scoreManager.addZoneBonus(this.canvasWidth * 0.5, this.canvasHeight * 0.4);
		}
	}

	// ────────────────────────────────────────────────────
	// Private: утилиты
	// ────────────────────────────────────────────────────

	/**
	 * Получить пресет сложности (с fallback на MEDIUM).
	 */
	private getDifficultyPreset(difficulty: number): DifficultyPreset {
		const preset = DIFFICULTY_PRESETS[difficulty];
		return preset !== undefined ? preset : DIFFICULTY_PRESETS[DIFF_MEDIUM];
	}
}
