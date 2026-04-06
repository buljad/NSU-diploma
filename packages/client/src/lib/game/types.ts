// packages/client/src/lib/game/types.ts
//
// Все типы и числовые идентификаторы игры «Поймай мяч».
// Интерфейсы спроектированы под Object Pool паттерн:
//   - Все поля — примитивы (number / boolean / string).
//   - Никаких вложенных объектов (Vector2D и т.п.).
//   - Объекты НИКОГДА не создаются в render loop — только мутируются.
// ────────────────────────────────────────────────────────────

// ============================================================
// 1. ЧИСЛОВЫЕ ИДЕНТИФИКАТОРЫ (вместо enum — совместимо с Object Pool)
// ============================================================

/** Этапы игры */
export const STAGE_MENU    = 0;
export const STAGE_1       = 1;  // «Лови только заданный цвет»
export const STAGE_2       = 2;  // «Цвет меняется!»
export const STAGE_3       = 3;  // «Двойная ловля»
export const STAGE_FINAL   = 4;  // «Цветной поток»
export const STAGE_RESULTS = 5;
export const STAGE_PAUSED  = 6;

/** Типы шаров */
export const BALL_NORMAL = 0;   // Обычный — ловим удержанием (dwell)
export const BALL_FAST   = 1;   // Быстрый — ловим точечным попаданием

/** Уровни сложности */
export const DIFF_EASY   = 0;
export const DIFF_MEDIUM = 1;
export const DIFF_HARD   = 2;

/** Состояние шара в пуле */
export const BALL_STATE_INACTIVE = 0;  // Свободен в пуле
export const BALL_STATE_FALLING  = 1;  // Летит по экрану
export const BALL_STATE_DWELLING = 2;  // Корзинка на нём, идёт захват
export const BALL_STATE_CAUGHT   = 3;  // Пойман, анимация ловли
export const BALL_STATE_MISSED   = 4;  // Улетел, анимация промаха

/** Типы событий очков (для FloatingText) */
export const SCORE_EVT_CATCH        = 0;
export const SCORE_EVT_MISS         = 1;
export const SCORE_EVT_WRONG        = 2;
export const SCORE_EVT_STREAK       = 3;
export const SCORE_EVT_ZONE_BONUS   = 4;

// ============================================================
// 2. ИГРОВЫЕ ОБЪЕКТЫ (Object Pool)
// ============================================================

/**
 * Шар в Object Pool.
 *
 * ПРАВИЛА:
 *  - Все 30 экземпляров создаются ПРИ СТАРТЕ игры.
 *  - В render loop поля ТОЛЬКО мутируются (ball.x = ...).
 *  - НИКОГДА не делать `balls.push(new Ball())`.
 *  - Неактивный шар: state === BALL_STATE_INACTIVE.
 *  - При спавне: найти неактивный, заполнить поля, state = FALLING.
 *  - При уходе за экран: state = INACTIVE.
 */
export interface Ball {
  // ── Позиция и движение (экранные px) ──
  x: number;
  y: number;
  vx: number;          // px/s
  vy: number;          // px/s

  // ── Визуал ──
  colorIndex: number;  // Индекс в BALL_COLORS[]
  radius: number;      // px
  symbolIndex: number; // -1 = нет символа; 0+ = индекс в BALL_SYMBOLS[] (финал)
  opacity: number;     // 0.0–1.0 (fade-in при спавне)

  // ── Состояние ──
  state: number;       // BALL_STATE_*
  ballType: number;    // BALL_NORMAL / BALL_FAST
  isTarget: boolean;   // Целевой шар (правильный цвет/символ)?

  // ── Ловля ──
  dwellProgress: number;  // 0.0–1.0 (прогресс удержания)
  dwellTimestamp: number;  // Когда началось удержание (performance.now)

  // ── Временны́е метки ──
  spawnTime: number;   // performance.now() при активации

  // ── Анимации ──
  animProgress: number; // 0.0–1.0 (для анимаций caught/missed)
}

/**
 * Корзинка-ловушка. Единственный экземпляр, мутируется in-place.
 *
 * Позиция вычисляется из CoP:
 *   screenX = canvasW/2 + cop_mm.x * gameScale
 *   screenY = canvasH/2 - cop_mm.y * gameScale   ← МИНУС (Canvas Y инвертирован)
 */
export interface Basket {
  // ── Позиция (экранные px, центр корзинки) ──
  x: number;
  y: number;
  width: number;       // px
  height: number;      // px

  // ── Wobble (шатание при рывке) ──
  wobbleIntensity: number;   // 0.0 (стабильно) – 1.0 (максимум тряски)
  wobblePhase: number;       // Фаза осцилляции (радианы)
  wobbleOffsetX: number;     // Текущее визуальное смещение X (px)
  wobbleOffsetY: number;     // Текущее визуальное смещение Y (px)

  // ── Jerk detection (для определения рывков) ──
  prevVelX: number;          // Скорость CoP на предыдущем кадре (mm/s)
  prevVelY: number;
}

/**
 * Всплывающий текст очков (+10, -5 и т.д.).
 * Object Pool — предаллокация при старте.
 *
 * Текст формируется ОДИН РАЗ при создании события (~1 Гц).
 * В render loop читается готовая строка — zero-GC.
 */
export interface FloatingText {
  x: number;           // Начальная позиция X (px)
  y: number;           // Начальная позиция Y (px)
  text: string;        // Готовая строка: "+10", "-5", "STREAK x5!" и т.д.
  colorIndex: number;  // Индекс в SCORE_TEXT_COLORS[]
  age: number;         // Время жизни (мс)
  active: boolean;
}

// ============================================================
// 3. КОНФИГУРАЦИЯ ЭТАПОВ
// ============================================================

/**
 * Конфигурация одного этапа игры.
 * Хранится в таблице STAGE_CONFIGS (constants.ts).
 * Финальные значения = base × difficulty multiplier.
 */
export interface StageConfig {
  /** Идентификатор этапа */
  stage: number;

  // ── Шары ──
  /** Максимум одновременно активных шаров */
  maxActiveBalls: number;
  /** Минимальная скорость падения (px/s, до множителя сложности) */
  ballSpeedMin: number;
  /** Максимальная скорость падения (px/s, до множителя сложности) */
  ballSpeedMax: number;
  /** Интервал спавна (мс) */
  spawnIntervalMs: number;
  /** Количество используемых цветов */
  colorCount: number;

  // ── Целевой цвет ──
  /** true = цвет не меняется в течение этапа */
  targetColorFixed: boolean;
  /** Интервал смены целевого цвета (мс). 0 = не меняется */
  colorChangeIntervalMs: number;

  // ── Ловля ──
  /** Время удержания для поимки (мс, до множителя сложности) */
  dwellTimeMs: number;

  // ── Быстрые шары (Этап 3+) ──
  /** Есть ли быстрые шары на этом этапе */
  hasFastBalls: boolean;
  /** Доля быстрых шаров (0.0–1.0) */
  fastBallRatio: number;
  /** Множитель скорости для быстрых шаров */
  fastBallSpeedMultiplier: number;

  // ── Символы (Финал) ──
  /** Использовать символы вместо цветов для определения цели */
  useSymbols: boolean;

  // ── Условия перехода ──
  /** Поймать N шаров для перехода. 0 = по времени */
  catchesToAdvance: number;
  /** Длительность этапа (мс). 0 = по количеству */
  durationMs: number;
}

// ============================================================
// 4. ПРЕСЕТЫ СЛОЖНОСТИ
// ============================================================

/**
 * Пресет сложности — модифицирует базовые StageConfig.
 * Финальное значение = StageConfig.value × DifficultyPreset.multiplier.
 */
export interface DifficultyPreset {
  /** Человекочитаемое название */
  label: string;

  // ── Корзинка ──
  basketWidth: number;         // px
  basketHeight: number;        // px

  // ── Множители (применяются к StageConfig) ──
  /** Время удержания. >1 = больше времени = проще */
  dwellTimeMultiplier: number;
  /** Скорость шаров. <1 = медленнее = проще */
  ballSpeedMultiplier: number;
  /** Радиус шаров. >1 = крупнее = проще */
  ballRadiusMultiplier: number;

  // ── Wobble ──
  /** Порог ускорения для срабатывания тряски (mm/s²). Выше = менее чувствительно */
  wobbleThreshold: number;
  /** Скорость затухания тряски (1/s). Выше = быстрее восстановление */
  wobbleDecayRate: number;

  // ── Маппинг CoP → экран ──
  /** Масштаб: сколько пикселей на 1 мм смещения CoP */
  gameScale: number;

  // ── Зона комфорта ──
  /** Радиус зоны комфорта (мм CoP). Больше = проще удерживать */
  comfortZoneRadiusMm: number;
}

// ============================================================
// 5. СНИМОК СОСТОЯНИЯ ИГРЫ (для Svelte Store / UI)
// ============================================================

/**
 * Снимок состояния игры для UI-компонентов.
 * Обновляется из BallCatcherGame → gameState store → UI.
 */
export interface GameSnapshot {
  /** Текущий этап */
  stage: number;
  /** Текущая сложность */
  difficulty: number;
  /** Набранные очки */
  score: number;
  /** Текущая серия попаданий */
  streak: number;
  /** Лучшая серия за сессию */
  bestStreak: number;
  /** Индекс целевого цвета в BALL_COLORS[] */
  targetColorIndex: number;
  /** Название целевого цвета (для UI надписи «Лови синие!») */
  targetColorName: string;
  /** Всего поймано */
  catchCount: number;
  /** Всего пропущено */
  missCount: number;
  /** Поймано неправильных */
  wrongCatchCount: number;
  /** Оставшееся время этапа (сек). -1 = без лимита */
  stageTimeRemaining: number;
  /** Общее время с начала игры (сек) */
  totalElapsed: number;
  /** Находится ли в зоне комфорта */
  isInComfortZone: boolean;
  /** Время непрерывного нахождения в зоне комфорта (сек) */
  comfortZoneTime: number;
  /** Пауза? */
  isPaused: boolean;
  /** Игра запущена? */
  isRunning: boolean;
}