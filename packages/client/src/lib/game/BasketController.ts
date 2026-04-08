// packages/client/src/lib/game/BasketController.ts
//
// Маппинг CoP (мм) → экранная позиция корзинки + детекция рывков (jerk).
//
// ФИЗИКА:
//   screenX = canvasW/2 + cop_mm.x × gameScale
//   screenY = canvasH/2 - cop_mm.y × gameScale   ← МИНУС! (Canvas Y инвертирован)
//
// WOBBLE (тряска):
//   jerk = |Δvelocity| / dt   (мгновенное ускорение, mm/s²)
//   Если jerk > threshold → wobbleIntensity растёт
//   wobbleIntensity экспоненциально затухает
//   Визуальное смещение = sin(phase) × intensity × maxOffset
//
// ZERO-GC: Единственный экземпляр Basket, все поля мутируются in-place.
// ─────────────────────────────────────────────────────────────

import type { Basket, DifficultyPreset } from './types';
import {
  WOBBLE_FREQUENCY,
  WOBBLE_MAX_OFFSET,
  WOBBLE_CATCH_BLOCK_THRESHOLD,
} from './constants';

/** 2π — предвычислено, чтобы не вычислять в hot loop */
const TWO_PI = 6.283185307179586;

export class BasketController {

  /** Прямой доступ к корзинке для рендеринга (zero-GC чтение полей) */
  readonly basket: Basket;

  // ── Настройки (меняются только при смене сложности) ──
  private canvasWidth: number;
  private canvasHeight: number;
  private gameScale: number;
  private wobbleThreshold: number;   // mm/s² — порог срабатывания тряски
  private wobbleDecayRate: number;   // 1/s — скорость затухания

  // ── Зона комфорта ──
  private comfortZoneRadiusSq: number; // mm² (квадрат радиуса, чтобы не считать sqrt)

  constructor(
    canvasWidth: number,
    canvasHeight: number,
    preset: DifficultyPreset,
  ) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.gameScale = preset.gameScale;
    this.wobbleThreshold = preset.wobbleThreshold;
    this.wobbleDecayRate = preset.wobbleDecayRate;
    this.comfortZoneRadiusSq = preset.comfortZoneRadiusMm * preset.comfortZoneRadiusMm;

    // ── Единственный экземпляр корзинки ──
    this.basket = {
      x: canvasWidth / 2,
      y: canvasHeight * 0.82,
      width: preset.basketWidth,
      height: preset.basketHeight,
      wobbleIntensity: 0,
      wobblePhase: 0,
      wobbleOffsetX: 0,
      wobbleOffsetY: 0,
      prevVelX: 0,
      prevVelY: 0,
    };
  }

  // ────────────────────────────────────────────────────
  // Обновление (вызывается 1 раз за кадр)
  // ────────────────────────────────────────────────────

  /**
   * Обновить позицию корзинки из данных стабилометра.
   *
   * ВАЖНО: НЕ добавляет дополнительного сглаживания поверх Kalman + Interpolator.
   * Причина: дополнительный lag ухудшает сенсомоторную интеграцию (суть БОС).
   * Wobble — это АДДИТИВНЫЙ визуальный эффект, не влияющий на базовую позицию.
   *
   * ZERO-GC: Только мутация полей basket.* и скалярные вычисления.
   *
   * @param copX       - CoP X в мм (из stabilogramStore.getRenderPosition().x)
   * @param copY       - CoP Y в мм (из stabilogramStore.getRenderPosition().y)
   * @param velX       - Скорость CoP X в мм/с (из store.velocity.x)
   * @param velY       - Скорость CoP Y в мм/с (из store.velocity.y)
   * @param dt         - Дельта времени в секундах
   */
  update(
    copX: number,
    copY: number,
    velX: number,
    velY: number,
    dt: number,
  ): void {
    // Защита от плохого dt (первый кадр, паузы, ALT+TAB)
    if (dt <= 0 || dt > 0.5) return;

    const b = this.basket;

    // ══════════════════════════════════════════════
    // 1. МАППИНГ CoP → ЭКРАННЫЕ КООРДИНАТЫ
    // ══════════════════════════════════════════════

    // Физический ноль = центр Canvas.
    // Canvas Y инвертирован: вперёд (CoP Y+) → вверх на экране.
    const rawX = this.canvasWidth * 0.5 + copX * this.gameScale;
    const rawY = this.canvasHeight * 0.5 - copY * this.gameScale;

    // Ограничение: корзинка не выходит за Canvas
    const halfW = b.width * 0.5;
    const halfH = b.height * 0.5;

    b.x = rawX;
    b.y = rawY;

    // Clamp X
    if (b.x < halfW) b.x = halfW;
    else if (b.x > this.canvasWidth - halfW) b.x = this.canvasWidth - halfW;

    // Clamp Y
    if (b.y < halfH) b.y = halfH;
    else if (b.y > this.canvasHeight - halfH) b.y = this.canvasHeight - halfH;

    // ══════════════════════════════════════════════
    // 2. ДЕТЕКЦИЯ РЫВКОВ (JERK)
    // ══════════════════════════════════════════════
    //
    // Jerk = dVelocity / dt = ускорение (mm/s²)
    // Если jerk превышает порог → корзинка начинает шататься.

    const dvx = velX - b.prevVelX;
    const dvy = velY - b.prevVelY;
    const jerkSq = dvx * dvx + dvy * dvy;
    const threshSq = this.wobbleThreshold * this.wobbleThreshold * dt * dt;

    // Сохраняем текущую скорость для следующего кадра
    b.prevVelX = velX;
    b.prevVelY = velY;

    // ══════════════════════════════════════════════
    // 3. WOBBLE (ТРЯСКА)
    // ══════════════════════════════════════════════

    // Проверяем без sqrt: |jerk|² > threshold²
    // jerkMagnitude = sqrt(jerkSq) / dt, но сравниваем в квадратах:
    // jerkSq / dt² > wobbleThreshold²
    if (jerkSq > threshSq) {
      // Рывок обнаружен!
      // Интенсивность пропорциональна превышению порога.
      // sqrt(jerkSq) / dt = реальный jerk в mm/s²
      // Делим на (threshold * 3) чтобы масштабировать в [0, 1]
      const jerkMag = Math.sqrt(jerkSq) / dt;
      const newIntensity = jerkMag / (this.wobbleThreshold * 3);
      const clamped = newIntensity > 1 ? 1 : newIntensity;

      // Берём максимум, чтобы не гасить текущую тряску
      if (clamped > b.wobbleIntensity) {
        b.wobbleIntensity = clamped;
      }
    }

    // Затухание (экспоненциальное)
    if (b.wobbleIntensity > 0.001) {
      b.wobbleIntensity *= Math.exp(-this.wobbleDecayRate * dt);

      // Обновляем фазу осцилляции
      b.wobblePhase += WOBBLE_FREQUENCY * dt;
      // Предотвращаем бесконечный рост phase
      if (b.wobblePhase > TWO_PI) {
        b.wobblePhase -= TWO_PI;
      }

      // Визуальное смещение: две перпендикулярные синусоиды
      // с разной частотой для «восьмёрки» вместо линейной тряски
      b.wobbleOffsetX = Math.sin(b.wobblePhase) * b.wobbleIntensity * WOBBLE_MAX_OFFSET;
      b.wobbleOffsetY = Math.cos(b.wobblePhase * 1.3) * b.wobbleIntensity * WOBBLE_MAX_OFFSET * 0.6;
    } else {
      // Полностью затухла
      b.wobbleIntensity = 0;
      b.wobbleOffsetX = 0;
      b.wobbleOffsetY = 0;
    }
  }

  // ────────────────────────────────────────────────────
  // Запросы состояния (zero-GC: только чтение скаляров)
  // ────────────────────────────────────────────────────

  /**
   * Возвращает true если корзинка шатается достаточно сильно,
   * чтобы БЛОКИРОВАТЬ прогресс ловли (dwell).
   *
   * Используется CollisionDetector'ом:
   *   if (basketController.isWobbling()) → сбросить dwellProgress
   */
  isWobbling(): boolean {
    return this.basket.wobbleIntensity >= WOBBLE_CATCH_BLOCK_THRESHOLD;
  }

  /**
   * X-координата для отрисовки (базовая позиция + wobble смещение).
   * Вызывается в draw() для позиционирования спрайта корзинки.
   */
  getDrawX(): number {
    return this.basket.x + this.basket.wobbleOffsetX;
  }

  /**
   * Y-координата для отрисовки (базовая позиция + wobble смещение).
   */
  getDrawY(): number {
    return this.basket.y + this.basket.wobbleOffsetY;
  }

  /**
   * AABB корзинки для коллизий (без wobble — столкновения по логической позиции).
   * Возвращает координаты через out-параметры для zero-GC.
   *
   * Вместо возврата объекта { left, top, right, bottom } —
   * CollisionDetector читает basket.x/y/width/height напрямую.
   * Этот метод — справочный, для документации.
   */
  getHitboxLeft(): number {
    return this.basket.x - this.basket.width * 0.5;
  }

  getHitboxRight(): number {
    return this.basket.x + this.basket.width * 0.5;
  }

  getHitboxTop(): number {
    return this.basket.y - this.basket.height * 0.5;
  }

  getHitboxBottom(): number {
    return this.basket.y + this.basket.height * 0.5;
  }

  /**
   * Проверить, находится ли CoP (в физических мм) в зоне комфорта.
   *
   * Зона комфорта — круг радиуса comfortZoneRadiusMm с центром в (0,0).
   * Проверка в квадратах (без sqrt) для производительности.
   *
   * @param copX - CoP X в мм
   * @param copY - CoP Y в мм
   */
  isInComfortZone(copX: number, copY: number): boolean {
    return (copX * copX + copY * copY) <= this.comfortZoneRadiusSq;
  }

  // ────────────────────────────────────────────────────
  // Конфигурация (вызывается НЕ в render loop)
  // ────────────────────────────────────────────────────

  /**
   * Изменить пресет сложности. Вызывается при переключении Easy/Medium/Hard.
   */
  configure(preset: DifficultyPreset): void {
    this.basket.width = preset.basketWidth;
    this.basket.height = preset.basketHeight;
    this.gameScale = preset.gameScale;
    this.wobbleThreshold = preset.wobbleThreshold;
    this.wobbleDecayRate = preset.wobbleDecayRate;
    this.comfortZoneRadiusSq = preset.comfortZoneRadiusMm * preset.comfortZoneRadiusMm;
  }

  /**
   * Обновить размер Canvas. Вызывается при resize.
   */
  updateCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Сбросить состояние корзинки. Вызывается при рестарте игры.
   */
  reset(): void {
    const b = this.basket;
    b.x = this.canvasWidth * 0.5;
    b.y = this.canvasHeight * 0.5;
    b.wobbleIntensity = 0;
    b.wobblePhase = 0;
    b.wobbleOffsetX = 0;
    b.wobbleOffsetY = 0;
    b.prevVelX = 0;
    b.prevVelY = 0;
  }
}