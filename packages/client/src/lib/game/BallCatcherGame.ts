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

import type { GameSnapshot, DifficultyPreset } from './types';
import {
  STAGE_MENU,
  STAGE_1,
  STAGE_RESULTS,
  STAGE_PAUSED,
  DIFF_MEDIUM,
  BALL_STATE_INACTIVE,
  BALL_STATE_FALLING,
  BALL_STATE_DWELLING,
} from './types';
import {
  DIFFICULTY_PRESETS,
  BALL_DESPAWN_MARGIN,
  BALL_COLOR_NAMES,
} from './constants';
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

  /** Текущий уровень сложности (DIFF_* константа) */
  currentDifficulty: number = DIFF_MEDIUM;

  // ════════════════════════════════════════════════
  // Приватное состояние
  // ════════════════════════════════════════════════

  private canvasWidth: number;
  private canvasHeight: number;
  private lastUpdateTime: number = 0;
  private stageBeforePause: number = STAGE_1;

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
  start(difficulty: number): void {
    this.currentDifficulty = difficulty;
    const preset = this.getDifficultyPreset(difficulty);

    // Сброс всех подсистем
    this.ballPool.deactivateAll();
    this.basketController.configure(preset);
    this.basketController.reset();
    this.scoreManager.reset();
    this.stageManager.reset();

    // Настройка первого этапа
    const now = performance.now();
    this.stageManager.configure(difficulty, STAGE_1, this.scoreManager, now);
    this.collisionDetector.configure(this.stageManager.effectiveDwellTimeMs);

    // Запуск
    this.isRunning = true;
    this.isPaused = false;
    this.totalElapsedMs = 0;
    this.lastUpdateTime = now;
  }

  /**
   * Поставить игру на паузу.
   * Вызывается при потере WS, отключении устройства, и т.д.
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.stageBeforePause = this.stageManager.currentStage;
  }

  /**
   * Снять паузу.
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    // Сбрасываем lastUpdateTime чтобы dt не включал время паузы
    this.lastUpdateTime = performance.now();
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
  update(
    copX: number,
    copY: number,
    velX: number,
    velY: number,
    now: number,
  ): void {
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
      now,
    );

    // ═══════════════════════════════════════
    // 3. ФИЗИКА ШАРОВ (движение, fade-in, анимации)
    // ═══════════════════════════════════════
    this.ballPool.update(dt, now);

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
      now,
    );

    if (shouldAdvance) {
      this.advanceStage(now);
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
    const nextStage = this.stageManager.getNextStage();

    // Очистить все шары (чистый переход для детей)
    this.ballPool.deactivateAll();

    if (nextStage === STAGE_RESULTS) {
      // ══ Игра завершена ══
      this.stageManager.currentStage = STAGE_RESULTS;
      // isRunning остаётся true чтобы UI показал результаты
      return;
    }

    // ══ Настроить новый этап ══
    this.stageManager.configure(
      this.currentDifficulty,
      nextStage,
      this.scoreManager,
      now,
    );

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
      this.scoreManager.addZoneBonus(
        this.canvasWidth * 0.5,
        this.canvasHeight * 0.4,
      );
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