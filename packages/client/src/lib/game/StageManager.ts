// packages/client/src/lib/game/StageManager.ts
//
// Стейт-машина этапов + спавнер шаров + управление целевым цветом.
//
// ОТВЕТСТВЕННОСТЬ:
//   ✅ Знает текущий этап и его конфигурацию
//   ✅ Спавнит шары в BallPool по таймеру
//   ✅ Управляет целевым цветом (выбор, смена по таймеру)
//   ✅ Вычисляет эффективные параметры (StageConfig × DifficultyPreset)
//   ✅ Проверяет условия перехода к следующему этапу
//
// НЕ ОТВЕТСТВЕННОСТЬ:
//   ❌ Отрисовка, UI, Svelte
//   ❌ Коллизии, очки
//   ❌ Управление корзинкой
//
// ZERO-GC:
//   ✅ update() — только скалярная арифметика + вызов pool.spawn() со скалярами
//   ✅ trySpawnBall() — Math.random() возвращает примитив, без аллокаций
//   ✅ Строки читаются из BALL_COLOR_NAMES[] по индексу
// ─────────────────────────────────────────────────────────────

import type { StageConfig, DifficultyPreset } from './types';
import type { BallPool } from './BallPool';
import type { ScoreManager } from './ScoreManager';
import {
  STAGE_1,
  STAGE_2,
  STAGE_3,
  STAGE_FINAL,
  STAGE_RESULTS,
  BALL_NORMAL,
  BALL_FAST,
} from './types';
import {
  STAGE_CONFIGS,
  DIFFICULTY_PRESETS,
  BALL_DEFAULT_RADIUS,
  BALL_MIN_RADIUS,
  BALL_MAX_RADIUS,
  BALL_SPAWN_MARGIN,
  BALL_SPAWN_PADDING_X,
  BALL_SYMBOLS,
  TARGET_SYMBOL_INDEX,
  BALL_COLOR_NAMES,
  TOTAL_COLORS,
} from './constants';


/** Порядок этапов для автоперехода */
const STAGE_ORDER: readonly number[] = [
  STAGE_1, STAGE_2, STAGE_3, STAGE_FINAL, STAGE_RESULTS,
];

/**
 * Максимальная серия нецелевых шаров подряд.
 * Если превышена — следующий шар будет целевым (гарантия прогресса).
 */
const MAX_NON_TARGET_STREAK = 5;


export class StageManager {

  // ════════════════════════════════════════════════
  // Публичное состояние (читается BallCatcherGame и рендерером)
  // ════════════════════════════════════════════════

  /** Текущий этап (STAGE_* константа) */
  currentStage: number = STAGE_1;

  /** Индекс целевого цвета в BALL_FILL_COLORS[] */
  targetColorIndex: number = 3; // Синий по умолчанию

  /** Время последней смены цвета (для flash-эффекта в рендерере) */
  lastColorChangeTime: number = 0;

  /** Время начала текущего этапа (performance.now) */
  stageStartTime: number = 0;

  /** Прошло с начала этапа (мс) */
  stageElapsedMs: number = 0;

  // ════════════════════════════════════════════════
  // Эффективные параметры (config × difficulty, public для чтения)
  // ════════════════════════════════════════════════

  effectiveDwellTimeMs: number = 1000;
  effectiveBallRadius: number = BALL_DEFAULT_RADIUS;

  // ════════════════════════════════════════════════
  // Приватное состояние
  // ════════════════════════════════════════════════

  private config: StageConfig = STAGE_CONFIGS[STAGE_1];
  private difficulty: DifficultyPreset = DIFFICULTY_PRESETS[1]; // DIFF_MEDIUM

  private canvasWidth: number;
  private canvasHeight: number;

  // Таймеры
  private lastSpawnTime: number = 0;
  private lastColorChangeCheckTime: number = 0;

  // Счётчики
  private catchCountBaseline: number = 0;
  private nonTargetSpawnStreak: number = 0;

  // Эффективные (приватные, вычисляются из config × difficulty)
  private effectiveBallSpeedMin: number = 50;
  private effectiveBallSpeedMax: number = 90;
  private effectiveSpawnIntervalMs: number = 2500;

  // ────────────────────────────────────────────────────
  // Конструктор
  // ────────────────────────────────────────────────────

  constructor(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  // ────────────────────────────────────────────────────
  // Конфигурация (вызывается при смене этапа / сложности)
  // ────────────────────────────────────────────────────

  /**
   * Настроить StageManager на новый этап.
   *
   * @param difficultyIndex - DIFF_EASY / DIFF_MEDIUM / DIFF_HARD
   * @param stage           - STAGE_* константа
   * @param scoreManager    - Для чтения catchCount baseline
   * @param now             - performance.now()
   */
  configure(
    difficultyIndex: number,
    stage: number,
    scoreManager: ScoreManager,
    now: number,
  ): void {
    this.currentStage = stage;
    this.stageStartTime = now;
    this.stageElapsedMs = 0;
    this.lastSpawnTime = now;
    this.lastColorChangeCheckTime = now;
    this.catchCountBaseline = scoreManager.catchCount;
    this.nonTargetSpawnStreak = 0;

    // Конфиг этапа (fallback на STAGE_1 если этап не найден)
    const cfg = STAGE_CONFIGS[stage];
    this.config = cfg !== undefined ? cfg : STAGE_CONFIGS[STAGE_1];

    // Пресет сложности
    const diff = DIFFICULTY_PRESETS[difficultyIndex];
    this.difficulty = diff !== undefined ? diff : DIFFICULTY_PRESETS[1];

    this.recomputeEffectiveValues();

    // Выбрать начальный целевой цвет (не тот же, что был)
    this.selectNewTargetColor();
    this.lastColorChangeTime = now;
  }

  // ────────────────────────────────────────────────────
  // Обновление (вызывается каждый кадр из BallCatcherGame)
  // ────────────────────────────────────────────────────

  /**
   * Обновить таймеры, проверить условия, спавнить шары.
   *
   * ZERO-GC: Только скалярная арифметика и вызовы spawn() со скалярами.
   *
   * @returns true если текущий этап завершён и нужно перейти к следующему
   */
  update(
    scoreManager: ScoreManager,
    pool: BallPool,
    wobbleIntensity: number,
    dt: number,
    now: number,
  ): boolean {
    // ── 1. Обновить таймер этапа ──
    this.stageElapsedMs += dt * 1000;

    // ── 2. Проверка окончания по времени ──
    if (this.config.durationMs > 0 && this.stageElapsedMs >= this.config.durationMs) {
      return true; // Этап завершён по времени
    }

    // ── 3. Проверка окончания по количеству ──
    if (this.config.catchesToAdvance > 0) {
      const stageCatches = scoreManager.catchCount - this.catchCountBaseline;
      if (stageCatches >= this.config.catchesToAdvance) {
        return true; // Этап завершён по количеству
      }
    }

    // ── 4. Смена целевого цвета (Этап 2+) ──
    if (
      !this.config.targetColorFixed &&
      this.config.colorChangeIntervalMs > 0
    ) {
      const sinceChange = now - this.lastColorChangeCheckTime;
      if (sinceChange >= this.config.colorChangeIntervalMs) {
        this.lastColorChangeCheckTime = now;
        this.selectNewTargetColor();
        this.lastColorChangeTime = now;
      }
    }

    // ── 5. Спавн шаров ──
    this.trySpawnBall(pool, wobbleIntensity, now);

    return false; // Этап продолжается
  }

  // ────────────────────────────────────────────────────
  // Целевой цвет
  // ────────────────────────────────────────────────────

  /**
   * Выбрать новый целевой цвет (гарантированно отличный от текущего).
   */
  selectNewTargetColor(): void {
    const count = this.config.colorCount;
    if (count <= 1) {
      this.targetColorIndex = 0;
      return;
    }

    // Равномерное распределение по (count-1) значениям, исключая текущий
    let newIndex = Math.floor(Math.random() * (count - 1));
    if (newIndex >= this.targetColorIndex) {
      newIndex++;
    }

    // Защита от выхода за пределы
    if (newIndex >= TOTAL_COLORS) {
      newIndex = 0;
    }

    this.targetColorIndex = newIndex;
  }

  /**
   * Русское название текущего целевого цвета.
   * Чтение из предаллоцированного массива — zero-GC.
   */
  getTargetColorName(): string {
    return BALL_COLOR_NAMES[this.targetColorIndex] ?? 'неизвестные';
  }

  // ────────────────────────────────────────────────────
  // Оставшееся время (для UI)
  // ────────────────────────────────────────────────────

  /**
   * Оставшееся время этапа в секундах. -1 если этап не ограничен по времени.
   */
  getTimeRemainingSec(): number {
    if (this.config.durationMs <= 0) return -1;
    const remaining = this.config.durationMs - this.stageElapsedMs;
    return remaining > 0 ? remaining * 0.001 : 0;
  }

  // ────────────────────────────────────────────────────
  // Следующий этап
  // ────────────────────────────────────────────────────

  /**
   * Получить идентификатор следующего этапа.
   * @returns STAGE_* константа, или STAGE_RESULTS если этапы закончились
   */
  getNextStage(): number {
    for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
      if (STAGE_ORDER[i] === this.currentStage) {
        return STAGE_ORDER[i + 1];
      }
    }
    return STAGE_RESULTS;
  }

  // ────────────────────────────────────────────────────
  // Canvas resize
  // ────────────────────────────────────────────────────

  updateCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  // ────────────────────────────────────────────────────
  // Сброс
  // ────────────────────────────────────────────────────

  reset(): void {
    this.currentStage = STAGE_1;
    this.targetColorIndex = 3;
    this.stageStartTime = 0;
    this.stageElapsedMs = 0;
    this.lastSpawnTime = 0;
    this.lastColorChangeCheckTime = 0;
    this.lastColorChangeTime = 0;
    this.catchCountBaseline = 0;
    this.nonTargetSpawnStreak = 0;
  }

  // ────────────────────────────────────────────────────
  // Private: спавн
  // ────────────────────────────────────────────────────

  /**
   * Попытаться заспавнить шар. Проверяет таймер и лимит активных.
   *
   * ZERO-GC: Math.random() → примитив. pool.spawn() принимает скаляры.
   */
  private trySpawnBall(
    pool: BallPool,
    wobbleIntensity: number,
    now: number,
  ): void {
    // Проверка лимита активных шаров
    if (pool.activeCount >= this.config.maxActiveBalls) return;

    // Проверка таймера спавна.
    // На финале: wobble ускоряет спавн (поток усиливается при рывках)
    let intervalMs = this.effectiveSpawnIntervalMs;
    if (this.currentStage === STAGE_FINAL && wobbleIntensity > 0.1) {
      // При maxWobble (1.0) интервал уменьшается вдвое
      intervalMs = intervalMs / (1 + wobbleIntensity);
    }

    if (now - this.lastSpawnTime < intervalMs) return;

    this.lastSpawnTime = now;

    // ── Тип шара ──
    let ballType = BALL_NORMAL;
    if (this.config.hasFastBalls && Math.random() < this.config.fastBallRatio) {
      ballType = BALL_FAST;
    }

    // ── Позиция ──
    const x = BALL_SPAWN_PADDING_X
            + Math.random() * (this.canvasWidth - 2 * BALL_SPAWN_PADDING_X);
    const y = -(Math.random() * BALL_SPAWN_MARGIN);

    // ── Скорость ──
    const baseSpeed = this.effectiveBallSpeedMin
                    + Math.random() * (this.effectiveBallSpeedMax - this.effectiveBallSpeedMin);
    const speed = ballType === BALL_FAST
                ? baseSpeed * this.config.fastBallSpeedMultiplier
                : baseSpeed;

    // Небольшой горизонтальный дрифт для разнообразия
    const vx = (Math.random() - 0.5) * 25;
    const vy = speed; // Падает вниз

    // ── Цвет ──
    const colorIndex = Math.floor(Math.random() * this.config.colorCount);

    // ── Целевой? ──
    let isTarget: boolean;
    let symbolIndex = -1;

    if (this.config.useSymbols) {
      // ── Финальный этап: цель определяется символом ──
      if (this.nonTargetSpawnStreak >= MAX_NON_TARGET_STREAK || Math.random() < 0.28) {
        symbolIndex = TARGET_SYMBOL_INDEX;
      } else {
        // Случайный НЕ-целевой символ
        symbolIndex = 1 + Math.floor(Math.random() * (BALL_SYMBOLS.length - 1));
      }
      isTarget = symbolIndex === TARGET_SYMBOL_INDEX;
    } else {
      // ── Обычные этапы: цель определяется цветом ──
      if (this.nonTargetSpawnStreak >= MAX_NON_TARGET_STREAK) {
        // Гарантируем целевой шар
        isTarget = true;
      } else {
        isTarget = colorIndex === this.targetColorIndex;
      }
    }

    // ── Радиус ──
    let radius = this.effectiveBallRadius;
    // Быстрые шары чуть меньше
    if (ballType === BALL_FAST) {
      radius *= 0.85;
    }

    // Финальный цвет для целевого шара (в обычных этапах)
    const finalColorIndex = (!this.config.useSymbols && isTarget)
                          ? this.targetColorIndex
                          : colorIndex;

    // ── Спавн ──
    const result = pool.spawn(
      x, y, vx, vy,
      finalColorIndex,
      radius,
      ballType,
      isTarget,
      symbolIndex,
      now,
    );

    // Обновить счётчик нецелевых серий
    if (result !== -1) {
      if (isTarget) {
        this.nonTargetSpawnStreak = 0;
      } else {
        this.nonTargetSpawnStreak++;
      }
    }
  }

  // ────────────────────────────────────────────────────
  // Private: вычисление эффективных параметров
  // ────────────────────────────────────────────────────

  private recomputeEffectiveValues(): void {
    const c = this.config;
    const d = this.difficulty;

    this.effectiveBallSpeedMin = c.ballSpeedMin * d.ballSpeedMultiplier;
    this.effectiveBallSpeedMax = c.ballSpeedMax * d.ballSpeedMultiplier;
    this.effectiveSpawnIntervalMs = c.spawnIntervalMs;
    this.effectiveDwellTimeMs = c.dwellTimeMs * d.dwellTimeMultiplier;

    // Радиус с ограничением
    let r = BALL_DEFAULT_RADIUS * d.ballRadiusMultiplier;
    if (r < BALL_MIN_RADIUS) r = BALL_MIN_RADIUS;
    if (r > BALL_MAX_RADIUS) r = BALL_MAX_RADIUS;
    this.effectiveBallRadius = r;
  }
}