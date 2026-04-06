// packages/client/src/lib/game/constants.ts
//
// Все магические числа, цвета и конфигурации игры «Поймай мяч».
//
// ПРАВИЛО ZERO-GC:
//   Все строки (цвета, имена) — предаллоцированные константы.
//   В render loop обращение к ним — чтение из массива по индексу.
//   Никакой конкатенации строк, никаких template literals в draw().
// ────────────────────────────────────────────────────────────

import {
  STAGE_1,
  STAGE_2,
  STAGE_3,
  STAGE_FINAL,
  DIFF_EASY,
  DIFF_MEDIUM,
  DIFF_HARD,
} from './types';

import type { StageConfig, DifficultyPreset } from './types';

// ============================================================
// 1. ЦВЕТА ШАРОВ (предаллоцированные строки для Canvas)
// ============================================================

/**
 * Основные цвета шаров.
 * Доступ: ctx.fillStyle = BALL_FILL_COLORS[ball.colorIndex]
 * Это чтение из массива — zero-GC.
 */
export const BALL_FILL_COLORS: readonly string[] = [
  '#FF6B6B',   // 0: Красный
  '#4ECDC4',   // 1: Бирюзовый
  '#FFE66D',   // 2: Жёлтый
  '#74B9FF',   // 3: Синий
  '#A8E6CF',   // 4: Зелёный
  '#6C5CE7',   // 5: Фиолетовый
  '#FDCB6E',   // 6: Оранжевый
  '#FF8B94',   // 7: Розовый
];

/** Цвета обводки шаров (темнее fill на ~20%) */
export const BALL_STROKE_COLORS: readonly string[] = [
  '#D94F4F',   // 0: Красный
  '#3BA89E',   // 1: Бирюзовый
  '#D4BD4A',   // 2: Жёлтый
  '#5A94CC',   // 3: Синий
  '#7FBF9E',   // 4: Зелёный
  '#5649B9',   // 5: Фиолетовый
  '#CAA258',   // 6: Оранжевый
  '#D96B77',   // 7: Розовый
];

/** Цвета свечения шаров (для glow-эффекта, более прозрачные) */
export const BALL_GLOW_COLORS: readonly string[] = [
  'rgba(255,107,107,0.3)',
  'rgba(78,205,196,0.3)',
  'rgba(255,230,109,0.3)',
  'rgba(116,185,255,0.3)',
  'rgba(168,230,207,0.3)',
  'rgba(108,92,231,0.3)',
  'rgba(253,203,110,0.3)',
  'rgba(255,139,148,0.3)',
];

/**
 * Русские названия цветов для UI-подсказки «Лови синие!»
 * Доступ: BALL_COLOR_NAMES[targetColorIndex]
 */
export const BALL_COLOR_NAMES: readonly string[] = [
  'красные',
  'бирюзовые',
  'жёлтые',
  'синие',
  'зелёные',
  'фиолетовые',
  'оранжевые',
  'розовые',
];

/** Общее количество доступных цветов */
export const TOTAL_COLORS = BALL_FILL_COLORS.length;

// ============================================================
// 2. СИМВОЛЫ (Финальный этап)
// ============================================================

/**
 * Символы внутри шаров для финального этапа.
 * На финале цвет НЕ определяет цель — только символ.
 */
export const BALL_SYMBOLS: readonly string[] = [
  '★',   // 0: Звезда (целевой по умолчанию)
  '●',   // 1: Круг
  '▲',   // 2: Треугольник
  '◆',   // 3: Ромб
  '♥',   // 4: Сердце
  '✦',   // 5: Четырёхконечная звезда
  '■',   // 6: Квадрат
  '⬟',   // 7: Пятиугольник
];

/** Индекс целевого символа на финальном этапе */
export const TARGET_SYMBOL_INDEX = 0; // Звезда ★

// ============================================================
// 3. РАЗМЕРЫ OBJECT POOL
// ============================================================

/** Максимум шаров в пуле (предаллокация) */
export const MAX_BALLS = 30;

/** Максимум всплывающих текстов очков */
export const MAX_FLOATING_TEXTS = 12;

// ============================================================
// 4. ПАРАМЕТРЫ ШАРОВ
// ============================================================

/** Радиус шара по умолчанию (px, до множителя сложности) */
export const BALL_DEFAULT_RADIUS = 22;

/** Минимальный радиус (px, после всех множителей) */
export const BALL_MIN_RADIUS = 14;

/** Максимальный радиус (px, после всех множителей) */
export const BALL_MAX_RADIUS = 40;

/** Длительность fade-in при спавне (мс) */
export const BALL_FADE_IN_MS = 350;

/** Длительность анимации «пойман» (мс) */
export const BALL_CATCH_ANIM_MS = 400;

/** Длительность анимации «промах» (мс) */
export const BALL_MISS_ANIM_MS = 250;

/**
 * Отступ от края Canvas для спавна (px).
 * Шары появляются в полосе y ∈ [-SPAWN_MARGIN, 0] (за верхним краем).
 */
export const BALL_SPAWN_MARGIN = 50;

/**
 * Отступ от края Canvas для despawn (px).
 * Шар деактивируется при y > canvasH + DESPAWN_MARGIN.
 */
export const BALL_DESPAWN_MARGIN = 30;

/** Горизонтальный отступ от краёв при спавне (px) */
export const BALL_SPAWN_PADDING_X = 40;

// ============================================================
// 5. ПАРАМЕТРЫ КОРЗИНКИ
// ============================================================

/** Скругление углов корзинки (px) */
export const BASKET_CORNER_RADIUS = 8;

/** Толщина обводки корзинки (px) */
export const BASKET_STROKE_WIDTH = 2.5;

// ============================================================
// 6. WOBBLE (тряска при рывке)
// ============================================================

/**
 * Скорость осцилляции тряски (рад/с).
 * Чем выше — тем «быстрее дрожит» корзинка.
 */
export const WOBBLE_FREQUENCY = 25;

/**
 * Максимальное визуальное смещение при wobble (px).
 * При wobbleIntensity = 1.0 корзинка смещается на ±WOBBLE_MAX_OFFSET.
 */
export const WOBBLE_MAX_OFFSET = 12;

/**
 * Минимальная интенсивность wobble, которая ещё блокирует dwell.
 * Если wobbleIntensity < этого порога — шар можно ловить.
 */
export const WOBBLE_CATCH_BLOCK_THRESHOLD = 0.15;

// ============================================================
// 7. ЗОНА КОМФОРТА (механика «мастер ловцов»)
// ============================================================

/**
 * Время непрерывного нахождения в зоне для бонуса (мс).
 * Из ТЗ: «если корзина остаётся в заданной зоне более 10 секунд подряд»
 */
export const COMFORT_ZONE_BONUS_TIME_MS = 10_000;

/** Визуальный радиус зоны комфорта на экране (px) — рисуется как пунктирный круг */
export const COMFORT_ZONE_VISUAL_RADIUS = 60;

// ============================================================
// 8. ОЧКИ
// ============================================================

/** Очки за правильно пойманный обычный шар */
export const POINTS_CATCH = 10;

/** Очки за правильно пойманный быстрый шар */
export const POINTS_CATCH_FAST = 20;

/** Штраф за пропуск целевого шара (улетел за экран) */
export const POINTS_MISS = -5;

/** Штраф за ловлю НЕцелевого шара */
export const POINTS_WRONG = -15;

/** Каждые N правильных подряд — бонус серии */
export const STREAK_BONUS_EVERY = 5;

/** Очки за бонус серии */
export const POINTS_STREAK_BONUS = 25;

/** Очки за бонус зоны комфорта (10 сек в центре) */
export const POINTS_ZONE_BONUS = 50;

// ============================================================
// 9. ЦВЕТА ДЛЯ ВСПЛЫВАЮЩИХ ТЕКСТОВ (предаллоцированные)
// ============================================================

/**
 * Цвета текстов очков. Индексация по SCORE_EVT_* константам.
 *   [0] = CATCH (зелёный)
 *   [1] = MISS (серый)
 *   [2] = WRONG (красный)
 *   [3] = STREAK (золотой)
 *   [4] = ZONE_BONUS (голубой)
 */
export const SCORE_TEXT_COLORS: readonly string[] = [
  '#2ecc71',           // catch
  '#95a5a6',           // miss
  '#e74c3c',           // wrong
  '#f1c40f',           // streak
  '#74b9ff',           // zone bonus
];

/** Скорость всплытия текста очков (px/s, вверх) */
export const SCORE_FLOAT_SPEED = 70;

/** Время жизни всплывающего текста (мс) */
export const SCORE_FLOAT_LIFETIME_MS = 1400;

// ============================================================
// 10. DWELL (кольцо прогресса ловли)
// ============================================================

/** Цвет заполненной части кольца прогресса */
export const DWELL_RING_FILL = 'rgba(46, 204, 113, 0.85)';

/** Цвет фона кольца прогресса */
export const DWELL_RING_BG = 'rgba(255, 255, 255, 0.2)';

/** Толщина кольца прогресса (px) */
export const DWELL_RING_WIDTH = 3;

/** Отступ кольца от края шара (px) */
export const DWELL_RING_GAP = 4;

// ============================================================
// 11. FLASH (вспышка при смене цвета — Этап 2+)
// ============================================================

/** Длительность вспышки при смене целевого цвета (мс) */
export const COLOR_CHANGE_FLASH_MS = 900;

/** Цвет вспышки (overlay поверх Canvas) */
export const COLOR_CHANGE_FLASH_COLOR = 'rgba(255, 255, 255, 0.15)';

// ============================================================
// 12. ОБЩИЙ РЕНДЕРИНГ
// ============================================================

/** Цвет фона игрового Canvas */
export const GAME_BG_COLOR = '#0a0a1a';

/** Цвет обводки игровой области */
export const GAME_AREA_BORDER_COLOR = 'rgba(255, 255, 255, 0.08)';

/** Цвет корзинки (нормальное состояние) */
export const BASKET_FILL_COLOR = 'rgba(255, 255, 255, 0.9)';

/** Цвет обводки корзинки (нормальное состояние) */
export const BASKET_STROKE_COLOR = 'rgba(74, 158, 255, 0.8)';

/** Цвет корзинки при тряске */
export const BASKET_WOBBLE_FILL_COLOR = 'rgba(255, 140, 140, 0.85)';

/** Цвет обводки корзинки при тряске */
export const BASKET_WOBBLE_STROKE_COLOR = 'rgba(231, 76, 60, 0.8)';

/** Цвет зоны комфорта (пунктирный круг) */
export const COMFORT_ZONE_COLOR = 'rgba(46, 204, 113, 0.2)';

/** Цвет зоны комфорта (когда активна/бонус близко) */
export const COMFORT_ZONE_ACTIVE_COLOR = 'rgba(46, 204, 113, 0.5)';

/** Шрифт для HUD (очки, таймер) */
export const HUD_FONT = 'bold 20px sans-serif';

/** Шрифт для подсказки «Лови синие!» */
export const TARGET_HINT_FONT = 'bold 28px sans-serif';

/** Шрифт для всплывающих очков */
export const SCORE_FLOAT_FONT = 'bold 18px sans-serif';

/** Шрифт для символов внутри шаров */
export const BALL_SYMBOL_FONT = 'bold 20px sans-serif';

/** Шрифт для финального экрана результатов */
export const RESULTS_TITLE_FONT = 'bold 36px sans-serif';
export const RESULTS_BODY_FONT = '20px sans-serif';

// ============================================================
// 13. КОНФИГУРАЦИИ ЭТАПОВ (базовые значения)
// ============================================================

/**
 * Таблица конфигураций по этапам.
 * Финальные значения вычисляются:
 *   ballSpeed = config.ballSpeedMin + random * (max - min)  ×  difficulty.ballSpeedMultiplier
 *   dwellTime = config.dwellTimeMs  ×  difficulty.dwellTimeMultiplier
 *   ballRadius = BALL_DEFAULT_RADIUS  ×  difficulty.ballRadiusMultiplier
 */
export const STAGE_CONFIGS: Readonly<Record<number, StageConfig>> = {
  [STAGE_1]: {
    stage: STAGE_1,
    maxActiveBalls: 3,
    ballSpeedMin: 55,
    ballSpeedMax: 90,
    spawnIntervalMs: 2800,
    colorCount: 3,
    targetColorFixed: true,
    colorChangeIntervalMs: 0,
    dwellTimeMs: 1300,
    hasFastBalls: false,
    fastBallRatio: 0,
    fastBallSpeedMultiplier: 1,
    useSymbols: false,
    catchesToAdvance: 8,
    durationMs: 0,
  },

  [STAGE_2]: {
    stage: STAGE_2,
    maxActiveBalls: 4,
    ballSpeedMin: 75,
    ballSpeedMax: 130,
    spawnIntervalMs: 2200,
    colorCount: 5,
    targetColorFixed: false,
    colorChangeIntervalMs: 17_000,
    dwellTimeMs: 1100,
    hasFastBalls: false,
    fastBallRatio: 0,
    fastBallSpeedMultiplier: 1,
    useSymbols: false,
    catchesToAdvance: 12,
    durationMs: 0,
  },

  [STAGE_3]: {
    stage: STAGE_3,
    maxActiveBalls: 5,
    ballSpeedMin: 90,
    ballSpeedMax: 160,
    spawnIntervalMs: 1900,
    colorCount: 4,
    targetColorFixed: true,
    colorChangeIntervalMs: 0,
    dwellTimeMs: 1000,
    hasFastBalls: true,
    fastBallRatio: 0.3,
    fastBallSpeedMultiplier: 2.2,
    useSymbols: false,
    catchesToAdvance: 12,
    durationMs: 0,
  },

  [STAGE_FINAL]: {
    stage: STAGE_FINAL,
    maxActiveBalls: 7,
    ballSpeedMin: 110,
    ballSpeedMax: 190,
    spawnIntervalMs: 1300,
    colorCount: 6,
    targetColorFixed: false,
    colorChangeIntervalMs: 12_000,
    dwellTimeMs: 800,
    hasFastBalls: true,
    fastBallRatio: 0.2,
    fastBallSpeedMultiplier: 1.8,
    useSymbols: true,
    catchesToAdvance: 0,
    durationMs: 60_000,
  },
};

// ============================================================
// 14. ПРЕСЕТЫ СЛОЖНОСТИ
// ============================================================

export const DIFFICULTY_PRESETS: Readonly<Record<number, DifficultyPreset>> = {
  [DIFF_EASY]: {
    label: 'Легко',
    basketWidth: 110,
    basketHeight: 50,
    dwellTimeMultiplier: 1.3,
    ballSpeedMultiplier: 0.7,
    ballRadiusMultiplier: 1.3,
    wobbleThreshold: 800,
    wobbleDecayRate: 4.5,
    gameScale: 7,
    comfortZoneRadiusMm: 20,
  },

  [DIFF_MEDIUM]: {
    label: 'Средне',
    basketWidth: 85,
    basketHeight: 42,
    dwellTimeMultiplier: 1.0,
    ballSpeedMultiplier: 1.0,
    ballRadiusMultiplier: 1.0,
    wobbleThreshold: 500,
    wobbleDecayRate: 3.0,
    gameScale: 9,
    comfortZoneRadiusMm: 15,
  },

  [DIFF_HARD]: {
    label: 'Сложно',
    basketWidth: 65,
    basketHeight: 36,
    dwellTimeMultiplier: 0.7,
    ballSpeedMultiplier: 1.4,
    ballRadiusMultiplier: 0.8,
    wobbleThreshold: 300,
    wobbleDecayRate: 2.0,
    gameScale: 12,
    comfortZoneRadiusMm: 10,
  },
};

// ============================================================
// 15. ВСПОМОГАТЕЛЬНЫЕ ПРЕДВЫЧИСЛЕНИЯ
// ============================================================

/**
 * Предвычисленные строки для всплывающих очков.
 * Ключ — количество очков, значение — готовая строка.
 * Заполняется при импорте модуля (один раз).
 *
 * В render loop: text = PRECOMPUTED_SCORE_TEXTS.get(points) ?? `${points}`
 * Второй вариант (fallback) создаст строку, но это edge case.
 */
export const PRECOMPUTED_SCORE_TEXTS: ReadonlyMap<number, string> = new Map([
  [POINTS_CATCH,        `+${POINTS_CATCH}`],
  [POINTS_CATCH_FAST,   `+${POINTS_CATCH_FAST}`],
  [POINTS_MISS,         `${POINTS_MISS}`],
  [POINTS_WRONG,        `${POINTS_WRONG}`],
  [POINTS_STREAK_BONUS, `+${POINTS_STREAK_BONUS} СЕРИЯ!`],
  [POINTS_ZONE_BONUS,   `+${POINTS_ZONE_BONUS} БАЛАНС!`],
]);