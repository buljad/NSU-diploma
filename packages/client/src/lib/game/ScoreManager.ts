// packages/client/src/lib/game/ScoreManager.ts
//
// Управление очками, сериями, зоной комфорта и всплывающими текстами.
//
// DESIGN:
//   • ScoreManager НЕ знает о Canvas / рендеринге.
//   • Он хранит данные (score, streak, FloatingText[]), которые
//     рендерер ЧИТАЕТ для отрисовки.
//   • Вызывающий код (BallCatcherGame) вызывает:
//     - onCatch / onMiss / onWrongCatch при игровых событиях
//     - updateComfortZone() каждый кадр
//     - updateFloatingTexts() каждый кадр
//
// ZERO-GC:
//   ✅ FloatingText[] — предаллоцированный пул
//   ✅ updateFloatingTexts() — только мутация полей
//   ✅ Строки в FloatingText.text — устанавливаются при событии (~1-5 Гц),
//       НЕ конструируются в render loop
//   ✅ PRECOMPUTED_SCORE_TEXTS покрывает все стандартные значения очков
// ─────────────────────────────────────────────────────────────

import type { FloatingText } from './types';
import {
  SCORE_EVT_CATCH,
  SCORE_EVT_MISS,
  SCORE_EVT_WRONG,
  SCORE_EVT_STREAK,
  SCORE_EVT_ZONE_BONUS,
} from './types';
import {
  MAX_FLOATING_TEXTS,
  POINTS_CATCH,
  POINTS_CATCH_FAST,
  POINTS_MISS,
  POINTS_WRONG,
  POINTS_STREAK_BONUS,
  POINTS_ZONE_BONUS,
  STREAK_BONUS_EVERY,
  COMFORT_ZONE_BONUS_TIME_MS,
  SCORE_FLOAT_SPEED,
  SCORE_FLOAT_LIFETIME_MS,
  PRECOMPUTED_SCORE_TEXTS,
} from './constants';


export class ScoreManager {

  // ════════════════════════════════════════════════
  // Публичное состояние (читается UI и рендерером)
  // ════════════════════════════════════════════════

  /** Текущий счёт (может быть отрицательным!) */
  score: number = 0;

  /** Текущая серия правильных ловль подряд */
  streak: number = 0;

  /** Лучшая серия за сессию */
  bestStreak: number = 0;

  /** Всего правильно пойманных шаров */
  catchCount: number = 0;

  /** Всего пропущенных целевых шаров */
  missCount: number = 0;

  /** Всего пойманных НЕцелевых шаров */
  wrongCatchCount: number = 0;

  /** Сейчас в зоне комфорта? */
  isInComfortZone: boolean = false;

  /** Время непрерывного нахождения в зоне комфорта (секунды, для UI) */
  comfortZoneTime: number = 0;

  // ════════════════════════════════════════════════
  // Пул всплывающих текстов (Object Pool)
  // ════════════════════════════════════════════════

  /** Прямой доступ для рендерера (итерация for-i, чтение полей) */
  readonly texts: FloatingText[];
  readonly textCapacity: number;

  // ════════════════════════════════════════════════
  // Приватное состояние
  // ════════════════════════════════════════════════

  /** Аккумулятор времени в зоне комфорта (секунды) */
  private comfortZoneAccum: number = 0;

  /** Порог бонуса зоны комфорта (секунды, предвычислено) */
  private readonly comfortZoneBonusThresholdSec: number;

  // ────────────────────────────────────────────────────
  // Конструктор
  // ────────────────────────────────────────────────────

  constructor(textCapacity: number = MAX_FLOATING_TEXTS) {
    this.textCapacity = textCapacity;
    this.texts = new Array(textCapacity);

    // Предаллокация всех FloatingText
    for (let i = 0; i < textCapacity; i++) {
      this.texts[i] = {
        x: 0,
        y: 0,
        text: '',
        colorIndex: 0,
        age: 0,
        active: false,
      };
    }

    this.comfortZoneBonusThresholdSec = COMFORT_ZONE_BONUS_TIME_MS * 0.001;
  }

  // ────────────────────────────────────────────────────
  // Игровые события (вызываются CollisionDetector / Game)
  // ────────────────────────────────────────────────────

  /**
   * Правильный шар пойман.
   *
   * @param x      - Экранная X позиция шара (для floating text)
   * @param y      - Экранная Y позиция шара
   * @param isFast - Быстрый шар? (×2 очков)
   */
  onCatch(x: number, y: number, isFast: boolean): void {
    const points = isFast ? POINTS_CATCH_FAST : POINTS_CATCH;
    this.score += points;
    this.catchCount++;
    this.streak++;

    if (this.streak > this.bestStreak) {
      this.bestStreak = this.streak;
    }

    // Всплывающий текст «+10» / «+20»
    const text = PRECOMPUTED_SCORE_TEXTS.get(points);
    this.spawnFloatingText(
      x,
      y - 20, // Чуть выше шара
      text !== undefined ? text : '+?',
      SCORE_EVT_CATCH,
    );

    // Проверка бонуса серии
    if (this.streak > 0 && this.streak % STREAK_BONUS_EVERY === 0) {
      this.score += POINTS_STREAK_BONUS;

      const streakText = PRECOMPUTED_SCORE_TEXTS.get(POINTS_STREAK_BONUS);
      this.spawnFloatingText(
        x,
        y - 55, // Ещё выше, чтобы не наложилось на «+10»
        streakText !== undefined ? streakText : 'СЕРИЯ!',
        SCORE_EVT_STREAK,
      );
    }
  }

  /**
   * Целевой шар пропущен (улетел за экран).
   *
   * @param x - Последняя экранная X позиция шара
   * @param y - Последняя экранная Y позиция шара
   */
  onMiss(x: number, y: number): void {
    this.score += POINTS_MISS; // Отрицательное число
    this.missCount++;
    this.streak = 0;

    const text = PRECOMPUTED_SCORE_TEXTS.get(POINTS_MISS);
    this.spawnFloatingText(
      x,
      y,
      text !== undefined ? text : '-?',
      SCORE_EVT_MISS,
    );
  }

  /**
   * Пойман НЕцелевой шар (неправильный цвет / символ).
   *
   * @param x - Экранная X позиция шара
   * @param y - Экранная Y позиция шара
   */
  onWrongCatch(x: number, y: number): void {
    this.score += POINTS_WRONG; // Отрицательное число
    this.wrongCatchCount++;
    this.streak = 0;

    const text = PRECOMPUTED_SCORE_TEXTS.get(POINTS_WRONG);
    this.spawnFloatingText(
      x,
      y - 20,
      text !== undefined ? text : '-?',
      SCORE_EVT_WRONG,
    );
  }

  /**
   * Начислить бонус зоны комфорта.
   * Вызывается игровым циклом когда updateComfortZone() вернул true.
   *
   * @param x - Позиция для floating text (обычно центр Canvas)
   * @param y - Позиция для floating text
   */
  addZoneBonus(x: number, y: number): void {
    this.score += POINTS_ZONE_BONUS;

    const text = PRECOMPUTED_SCORE_TEXTS.get(POINTS_ZONE_BONUS);
    this.spawnFloatingText(
      x,
      y,
      text !== undefined ? text : 'БАЛАНС!',
      SCORE_EVT_ZONE_BONUS,
    );
  }

  // ────────────────────────────────────────────────────
  // Обновление каждый кадр (ZERO-GC)
  // ────────────────────────────────────────────────────

  /**
   * Обновить таймер зоны комфорта.
   *
   * ZERO-GC: Только скалярная арифметика и сравнение.
   *
   * @param isInZone - Результат basketController.isInComfortZone(copX, copY)
   * @param dt       - Дельта времени в СЕКУНДАХ
   * @returns true если бонус сработал (вызывающий код должен вызвать addZoneBonus)
   */
  updateComfortZone(isInZone: boolean, dt: number): boolean {
    this.isInComfortZone = isInZone;

    if (isInZone) {
      this.comfortZoneAccum += dt;
      this.comfortZoneTime = this.comfortZoneAccum;

      if (this.comfortZoneAccum >= this.comfortZoneBonusThresholdSec) {
        // Бонус! Сбрасываем аккумулятор для следующего цикла.
        this.comfortZoneAccum = 0;
        return true;
      }
    } else {
      // Вышел из зоны — сброс
      this.comfortZoneAccum = 0;
      this.comfortZoneTime = 0;
    }

    return false;
  }

  /**
   * Обновить анимацию всплывающих текстов.
   * Тексты плавно поднимаются вверх и исчезают.
   *
   * ZERO-GC: Только мутация существующих полей.
   *
   * @param dt - Дельта времени в СЕКУНДАХ
   */
  updateFloatingTexts(dt: number): void {
    const dtMs = dt * 1000;

    for (let i = 0; i < this.textCapacity; i++) {
      const t = this.texts[i];
      if (!t.active) continue;

      // Возраст (мс)
      t.age += dtMs;

      // Движение вверх
      t.y -= SCORE_FLOAT_SPEED * dt;

      // Деактивация по истечении
      if (t.age >= SCORE_FLOAT_LIFETIME_MS) {
        t.active = false;
      }
    }
  }

  // ────────────────────────────────────────────────────
  // Утилиты для рендерера (zero-GC чтение)
  // ────────────────────────────────────────────────────

  /**
   * Вычислить прозрачность текста по его возрасту.
   * Линейный fade-out в последние 30% жизни.
   *
   * Вызывается рендерером:
   *   ctx.globalAlpha = scoreManager.getTextOpacity(text);
   *
   * ZERO-GC: Скалярная арифметика.
   *
   * @param text - Элемент из this.texts[]
   */
  getTextOpacity(text: FloatingText): number {
    const lifeRatio = text.age / SCORE_FLOAT_LIFETIME_MS;
    if (lifeRatio < 0.7) return 1;
    // Линейный fade от 1.0 до 0.0 в диапазоне [0.7, 1.0]
    return 1 - (lifeRatio - 0.7) / 0.3;
  }

  /**
   * Вычислить масштаб текста (эффект «пружинки» при появлении).
   * Первые 15% жизни: scale 0.3 → 1.15 → 1.0
   *
   * ZERO-GC: Скалярная арифметика.
   *
   * @param text - Элемент из this.texts[]
   */
  getTextScale(text: FloatingText): number {
    const lifeRatio = text.age / SCORE_FLOAT_LIFETIME_MS;
    if (lifeRatio > 0.15) return 1;

    // Нормализуем [0, 0.15] → [0, 1]
    const t = lifeRatio / 0.15;
    // Ease-out overshoot: 0.3 → 1.15 → 1.0
    if (t < 0.6) {
      // 0 → 0.6: scale 0.3 → 1.15
      return 0.3 + (1.15 - 0.3) * (t / 0.6);
    }
    // 0.6 → 1.0: scale 1.15 → 1.0
    return 1.15 - 0.15 * ((t - 0.6) / 0.4);
  }

  // ────────────────────────────────────────────────────
  // Управление
  // ────────────────────────────────────────────────────

  /**
   * Сброс всех данных. Вызывается при рестарте игры.
   */
  reset(): void {
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.catchCount = 0;
    this.missCount = 0;
    this.wrongCatchCount = 0;
    this.isInComfortZone = false;
    this.comfortZoneTime = 0;
    this.comfortZoneAccum = 0;

    // Деактивировать все тексты
    for (let i = 0; i < this.textCapacity; i++) {
      this.texts[i].active = false;
    }
  }

  /**
   * Сброс только серии (при переходе между этапами, если нужно).
   */
  resetStreak(): void {
    this.streak = 0;
  }

  // ────────────────────────────────────────────────────
  // Private: пул всплывающих текстов
  // ────────────────────────────────────────────────────

  /**
   * Активировать всплывающий текст из пула.
   *
   * Частота вызова: ~1-5 Гц (при игровых событиях).
   * Присвоение строки (text = ...) — это смена ссылки, НЕ аллокация.
   * Сами строки — из PRECOMPUTED_SCORE_TEXTS (статические) или
   * fallback-литералы (edge case, тоже статические).
   *
   * @param x          - Экранная X позиция
   * @param y          - Экранная Y позиция
   * @param text       - Готовая строка для отображения
   * @param colorIndex - Индекс в SCORE_TEXT_COLORS[]
   */
  private spawnFloatingText(
    x: number,
    y: number,
    text: string,
    colorIndex: number,
  ): void {
    // Найти неактивный слот
    for (let i = 0; i < this.textCapacity; i++) {
      if (this.texts[i].active) continue;

      const t = this.texts[i];
      t.x = x;
      t.y = y;
      t.text = text;
      t.colorIndex = colorIndex;
      t.age = 0;
      t.active = true;
      return;
    }

    // Пул исчерпан: перезаписать самый старый текст
    let oldestIdx = 0;
    let oldestAge = 0;
    for (let i = 0; i < this.textCapacity; i++) {
      if (this.texts[i].age > oldestAge) {
        oldestAge = this.texts[i].age;
        oldestIdx = i;
      }
    }

    const t = this.texts[oldestIdx];
    t.x = x;
    t.y = y;
    t.text = text;
    t.colorIndex = colorIndex;
    t.age = 0;
    t.active = true;
  }
}