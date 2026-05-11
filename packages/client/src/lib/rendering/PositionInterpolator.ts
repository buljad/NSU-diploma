// packages/client/src/lib/rendering/PositionInterpolator.ts

import type { Vector2D } from '@stabilometer/shared';

interface SamplePoint {
  position: Vector2D;
  velocity: Vector2D;
  timestamp: number;
}

/**
 * Position Interpolator v2.3+ 
 * 
 * ✅ ИСПРАВЛЕНО для плавных движений:
 * - Менее агрессивное затухание velocity для плавных движений
 * - Улучшенное адаптивное сглаживание
 * - Защита от рывков при малых изменениях
 * - Стабилизация при переходах между скоростями
 */
export class PositionInterpolator {
  private samples: SamplePoint[] = [];
  private readonly maxSamples = 3;
  private currentPosition: Vector2D = { x: 0, y: 0 };
  private currentVelocity: Vector2D = { x: 0, y: 0 };
  
  // ✅ ИСПРАВЛЕННЫЕ параметры сглаживания  
  private smoothingFactor = 0.3;  // Было 0.4 → стало 0.3 (менее агрессивное)
  
  private maxExtrapolationTime = 400; // Увеличено с 250ms для batch
  private fadeToZeroTime = 1500;      // Увеличено с 1000ms
  private streamTimeoutMs = 1200;     // Увеличено с 1000ms

  private lastDataReceiveTime = 0;
  private isStreamActive = false;

  addSample(position: Vector2D, timestamp: number): void {
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
        
        // ✅ БОЛЕЕ МЯГКОЕ ограничение velocity
        const maxVel = 600; // Было 500 → стало 600
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

    const timeSinceLastData = renderTime - this.lastDataReceiveTime;
    if (timeSinceLastData > this.streamTimeoutMs) {
      this.isStreamActive = false;
    }

    const latest = this.samples[this.samples.length - 1];
    const timeSince = renderTime - latest.timestamp;

    let target: Vector2D;

    if (timeSince <= this.maxExtrapolationTime) {
      const dt = timeSince / 1000;
      
      // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Адаптивное затухание в зависимости от скорости
      const velocityMagnitude = Math.sqrt(latest.velocity.x ** 2 + latest.velocity.y ** 2);
      let decay;
      
      if (velocityMagnitude < 50) { 
        // 🟢 ПЛАВНОЕ ДВИЖЕНИЕ: очень медленное затухание
        decay = Math.exp(-dt * 0.8); // Было 3 → стало 0.8
        
      } else if (velocityMagnitude < 150) { 
        // 🟡 СРЕДНЯЯ СКОРОСТЬ: умеренное затухание
        decay = Math.exp(-dt * 1.5); // Было 3 → стало 1.5
        
      } else { 
        // 🔴 БЫСТРОЕ ДВИЖЕНИЕ: нормальное затухание
        decay = Math.exp(-dt * 2.5); // Было 3 → стало 2.5
      }
      
      target = {
        x: latest.position.x + latest.velocity.x * dt * decay,
        y: latest.position.y + latest.velocity.y * dt * decay
      };
      
    } else if (this.isStreamActive) {
      // Поток активен, но пакет задерживается - держим позицию
      target = {
        x: latest.position.x,
        y: latest.position.y
      };
      
    } else if (timeSince <= this.fadeToZeroTime) {
      // Плавное затухание к центру при долгой потере
      const fadeProgress = (timeSince - this.maxExtrapolationTime) / 
                          (this.fadeToZeroTime - this.maxExtrapolationTime);
      const fadeFactor = 1 - fadeProgress; 
      
      target = {
        x: latest.position.x * fadeFactor,
        y: latest.position.y * fadeFactor
      };
      
    } else {
      target = { x: 0, y: 0 };
    }

    const distance = Math.sqrt(
      (target.x - this.currentPosition.x) ** 2 + 
      (target.y - this.currentPosition.y) ** 2
    );
    
    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Намного более мягкое адаптивное сглаживание
    let adaptiveSmoothing;
    
    if (distance < 2) { 
      // ОЧЕНЬ маленькие изменения - почти без сглаживания
      adaptiveSmoothing = 0.05;
      
    } else if (distance < 8) { 
      // Маленькие изменения - очень медленное сглаживание
      adaptiveSmoothing = Math.min(0.15, this.smoothingFactor * 0.5);
      
    } else if (distance < 25) { 
      // Средние изменения - умеренное сглаживание  
      adaptiveSmoothing = Math.min(0.4, this.smoothingFactor + distance * 0.003);
      
    } else { 
      // Большие изменения - нормальное сглаживание
      adaptiveSmoothing = Math.min(0.7, this.smoothingFactor + distance * 0.01);
    }

    // ✅ ДОПОЛНИТЕЛЬНАЯ СТАБИЛИЗАЦИЯ: плавный переход скоростей
    const velocityMagnitude = Math.sqrt(latest.velocity.x ** 2 + latest.velocity.y ** 2);
    if (velocityMagnitude < 80 && distance < 15) {
      // При плавном движении еще больше снижаем сглаживание
      adaptiveSmoothing *= 0.6;
    }

    this.currentPosition = {
      x: this.currentPosition.x + (target.x - this.currentPosition.x) * adaptiveSmoothing,
      y: this.currentPosition.y + (target.y - this.currentPosition.y) * adaptiveSmoothing
    };

    // ✅ ИСПРАВЛЕННОЕ обновление velocity
    const targetVel = timeSince > this.maxExtrapolationTime 
      ? { x: 0, y: 0 } 
      : latest.velocity;

    // Более мягкое обновление velocity для избежания рывков
    const velSmoothFactor = Math.min(adaptiveSmoothing * 0.7, 0.3);
      
    this.currentVelocity = {
      x: this.currentVelocity.x + (targetVel.x - this.currentVelocity.x) * velSmoothFactor,
      y: this.currentVelocity.y + (targetVel.y - this.currentVelocity.y) * velSmoothFactor
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
  
  // ✅ РАСШИРЕННАЯ диагностика
  getDebugInfo() {
    const latest = this.samples[this.samples.length - 1];
    const now = performance.now();
    
    return {
      isStreamActive: this.isStreamActive,
      timeSinceLastData: now - this.lastDataReceiveTime,
      samplesCount: this.samples.length,
      currentPosition: this.currentPosition,
      currentVelocity: this.currentVelocity,
      latestSample: latest ? {
        position: latest.position,
        velocity: latest.velocity,
        timestamp: latest.timestamp,
        age: now - latest.timestamp
      } : null,
      thresholds: {
        maxExtrapolation: this.maxExtrapolationTime,
        fadeToZero: this.fadeToZeroTime,
        streamTimeout: this.streamTimeoutMs
      },
      smoothingFactor: this.smoothingFactor
    };
  }

  // ✅ НОВЫЕ МЕТОДЫ НАСТРОЙКИ
  updateSettings(settings: {
    smoothingFactor?: number;
    maxExtrapolationTime?: number;
    fadeToZeroTime?: number;
  }): void {
    if (settings.smoothingFactor !== undefined) {
      this.smoothingFactor = Math.max(0.1, Math.min(0.8, settings.smoothingFactor));
    }
    if (settings.maxExtrapolationTime !== undefined) {
      this.maxExtrapolationTime = settings.maxExtrapolationTime;
    }
    if (settings.fadeToZeroTime !== undefined) {
      this.fadeToZeroTime = settings.fadeToZeroTime;
    }

    console.log('🔧 PositionInterpolator settings updated:', settings);
  }

  setModeForGentleMovements(): void {
    this.smoothingFactor = 0.2;
    this.maxExtrapolationTime = 500;
    this.fadeToZeroTime = 2000;
    console.log('🎯 PositionInterpolator optimized for gentle movements');
  }

  setModeForSharpMovements(): void {
    this.smoothingFactor = 0.4;
    this.maxExtrapolationTime = 300;
    this.fadeToZeroTime = 1000;
    console.log('🎯 PositionInterpolator optimized for sharp movements');
  }
}