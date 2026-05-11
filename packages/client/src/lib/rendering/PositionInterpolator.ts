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
  
  private smoothingFactor = 0.4;
  
  // ✅ ИСПРАВЛЕНО: Увеличены таймауты для batch-режима
  private maxExtrapolationTime = 500; // Было 250ms → стало 500ms
  private fadeToZeroTime = 2000; // Было 1000ms → стало 2000ms
  
  // ✅ НОВОЕ: Детекция активного потока данных
  private lastDataReceiveTime = 0;
  private isStreamActive = false;
  private streamTimeoutMs = 1000; // Считаем поток активным, если пакет пришел < 1сек назад

  addSample(position: Vector2D, timestamp: number): void {
    // ✅ НОВОЕ: Отмечаем, что поток данных активен
    this.lastDataReceiveTime = performance.now();
    this.isStreamActive = true;

    let velocity: Vector2D = { x: 0, y: 0 };

    if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1];
      const dt = (timestamp - last.timestamp) / 1000;

      if (dt > 0.001 && dt < 0.5) {
        velocity = {
          x: (position.x - last.position.x) / dt,
          y: (position.y - last.position.y) / dt
        };
        
        const maxVel = 500; 
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

    // ✅ НОВОЕ: Проверяем активность потока данных
    const timeSinceLastData = renderTime - this.lastDataReceiveTime;
    if (timeSinceLastData > this.streamTimeoutMs) {
      this.isStreamActive = false;
    }

    const latest = this.samples[this.samples.length - 1];
    const timeSince = renderTime - latest.timestamp;

    let target: Vector2D;

    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Не применяем fadeToZero при активном потоке
    if (timeSince <= this.maxExtrapolationTime) {
      // Нормальная экстраполяция с затуханием скорости
      const dt = timeSince / 1000;
      const decay = Math.exp(-dt * 3); 
      
      target = {
        x: latest.position.x + latest.velocity.x * dt * decay,
        y: latest.position.y + latest.velocity.y * dt * decay
      };
      
    } else if (this.isStreamActive) {
      // ✅ НОВАЯ ЛОГИКА: Поток активен, но пакет запаздывает
      // Просто держим последнюю позицию без ухода к центру!
      target = {
        x: latest.position.x,
        y: latest.position.y
      };
      
      console.log(`⏸️ Holding position (stream active, waiting for data) timeSince=${timeSince.toFixed(0)}ms`);
      
    } else if (timeSince <= this.fadeToZeroTime) {
      // ✅ Поток остановлен - плавное затухание
      const fadeProgress = (timeSince - this.maxExtrapolationTime) / 
                          (this.fadeToZeroTime - this.maxExtrapolationTime);
      const fadeFactor = 1 - fadeProgress; 
      
      target = {
        x: latest.position.x * fadeFactor,
        y: latest.position.y * fadeFactor
      };
      
      console.log(`🔻 Fading to center (stream inactive) fadeFactor=${fadeFactor.toFixed(2)}`);
      
    } else {
      // Полная остановка
      target = { x: 0, y: 0 };
    }

    // Адаптивное сглаживание
    const distance = Math.sqrt(
      (target.x - this.currentPosition.x) ** 2 + 
      (target.y - this.currentPosition.y) ** 2
    );
    
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
    this.isStreamActive = false;
    this.lastDataReceiveTime = 0;
  }
  
  // ✅ НОВОЕ: Диагностика
  getDebugInfo() {
    return {
      isStreamActive: this.isStreamActive,
      timeSinceLastData: performance.now() - this.lastDataReceiveTime,
      samplesCount: this.samples.length,
      currentPosition: this.currentPosition
    };
  }
}