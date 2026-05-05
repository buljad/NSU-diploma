// packages/client/src/lib/rendering/PositionInterpolator.ts

import type { Vector2D } from '@stabilometer/shared';

interface SamplePoint {
  position: Vector2D;
  velocity: Vector2D;
  timestamp: number;
}

export class PositionInterpolator {
  private samples: SamplePoint[] = [];
  private readonly maxSamples = 3;
  private currentPosition: Vector2D = { x: 0, y: 0 };
  private currentVelocity: Vector2D = { x: 0, y: 0 };
  
  // ✅ КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Увеличиваем время экстраполяции
  private smoothingFactor = 0.5;  // ✅ Было 0.3 → более отзывчивый
  private maxExtrapolationTime = 150;  // ✅ Было 40ms → в 3.75 раза больше!

  addSample(position: Vector2D, timestamp: number): void {
    let velocity: Vector2D = { x: 0, y: 0 };

    if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1];
      const dt = (timestamp - last.timestamp) / 1000;

      if (dt > 0 && dt < 0.5) {
        velocity = {
          x: (position.x - last.position.x) / dt,
          y: (position.y - last.position.y) / dt
        };
        
        // ✅ ЗАЩИТА ОТ НЕРЕАЛЬНЫХ СКОРОСТЕЙ
        const maxVel = 800; // мм/с
        if (Math.abs(velocity.x) > maxVel || Math.abs(velocity.y) > maxVel) {
          console.warn('⚠️ Ограничена скорость:', velocity);
          velocity.x = Math.max(-maxVel, Math.min(maxVel, velocity.x));
          velocity.y = Math.max(-maxVel, Math.min(maxVel, velocity.y));
        }
      }
    }

    this.samples.push({ position, velocity, timestamp });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getInterpolatedPosition(renderTime: number = performance.now()): Vector2D {
    if (this.samples.length === 0) {
      return this.currentPosition;
    }

    const latest = this.samples[this.samples.length - 1];
    const timeSince = renderTime - latest.timestamp;

    let target: Vector2D;

    // ✅ ИСПРАВЛЕНИЕ: Экстраполяция работает до 150ms вместо 40ms
    if (timeSince <= this.maxExtrapolationTime) {
      const dt = timeSince / 1000;
      
      // ✅ УЛУЧШЕННАЯ ЭКСТРАПОЛЯЦИЯ: С затуханием скорости
      const decay = Math.exp(-dt * 3); // Экспоненциальное затухание
      
      target = {
        x: latest.position.x + latest.velocity.x * dt * decay,
        y: latest.position.y + latest.velocity.y * dt * decay
      };
    } else {
      // ✅ ДАЖЕ ПРИ ДОЛГОЙ ЗАДЕРЖКЕ: Плавно к последней позиции
      target = {
        x: latest.position.x,
        y: latest.position.y
      };
    }

    // ✅ АДАПТИВНОЕ СГЛАЖИВАНИЕ: Быстрее реагируем на большие расстояния
    const distance = Math.sqrt(
      (target.x - this.currentPosition.x) ** 2 + 
      (target.y - this.currentPosition.y) ** 2
    );
    
    // Чем дальше цель, тем быстрее движемся (до максимума 0.8)
    const adaptiveSmoothing = Math.min(0.8, this.smoothingFactor + distance * 0.005);

    this.currentPosition = {
      x: this.currentPosition.x + (target.x - this.currentPosition.x) * adaptiveSmoothing,
      y: this.currentPosition.y + (target.y - this.currentPosition.y) * adaptiveSmoothing
    };

    // Обновляем скорость с тем же сглаживанием
    const targetVel = latest.velocity;
    this.currentVelocity = {
      x: this.currentVelocity.x + (targetVel.x - this.currentVelocity.x) * adaptiveSmoothing,
      y: this.currentVelocity.y + (targetVel.y - this.currentVelocity.y) * adaptiveSmoothing
    };

    return this.currentPosition;
  }

  getVelocity(): Vector2D {
    return this.currentVelocity;
  }

  reset(): void {
    this.samples = [];
    this.currentPosition = { x: 0, y: 0 };
    this.currentVelocity = { x: 0, y: 0 };
  }
}