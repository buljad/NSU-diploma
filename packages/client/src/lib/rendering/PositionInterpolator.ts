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
  
  // ✅ КРИТИЧЕСКИЕ ПАРАМЕТРЫ
  private smoothingFactor = 0.4; // ✅ СНИЖЕНО с 0.5 для плавности
  private maxExtrapolationTime = 100; // ✅ СНИЖЕНО со 150 до 100ms
  private fadeToZeroTime = 500; // ✅ НОВОЕ: через 500ms плавно к центру

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
        
        const maxVel = 500; // ✅ СНИЖЕНО с 800
        if (Math.abs(velocity.x) > maxVel || Math.abs(velocity.y) > maxVel) {
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

    if (timeSince <= this.maxExtrapolationTime) {
      // ✅ НОРМАЛЬНАЯ ЭКСТРАПОЛЯЦИЯ (первые 100ms)
      const dt = timeSince / 1000;
      const decay = Math.exp(-dt * 4); // ✅ Более быстрое затухание
      
      target = {
        x: latest.position.x + latest.velocity.x * dt * decay,
        y: latest.position.y + latest.velocity.y * dt * decay
      };
    } else if (timeSince <= this.fadeToZeroTime) {
      // ✅ ПЛАВНОЕ ЗАТУХАНИЕ К ЦЕНТРУ (100-500ms)
      const fadeProgress = (timeSince - this.maxExtrapolationTime) / 
                          (this.fadeToZeroTime - this.maxExtrapolationTime);
      const fadeFactor = 1 - fadeProgress; // 1.0 → 0.0
      
      target = {
        x: latest.position.x * fadeFactor,
        y: latest.position.y * fadeFactor
      };
    } else {
      // ✅ ДОЛГАЯ ПОТЕРЯ ДАННЫХ (>500ms): К центру
      target = { x: 0, y: 0 };
    }

    // ✅ АДАПТИВНОЕ СГЛАЖИВАНИЕ
    const distance = Math.sqrt(
      (target.x - this.currentPosition.x) ** 2 + 
      (target.y - this.currentPosition.y) ** 2
    );
    
    // При больших расстояниях - быстрее, при малых - плавнее
    const adaptiveSmoothing = distance > 20 
      ? Math.min(0.7, this.smoothingFactor + distance * 0.01)
      : this.smoothingFactor;

    this.currentPosition = {
      x: this.currentPosition.x + (target.x - this.currentPosition.x) * adaptiveSmoothing,
      y: this.currentPosition.y + (target.y - this.currentPosition.y) * adaptiveSmoothing
    };

    const targetVel = timeSince > this.maxExtrapolationTime 
      ? { x: 0, y: 0 } 
      : latest.velocity;
      
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