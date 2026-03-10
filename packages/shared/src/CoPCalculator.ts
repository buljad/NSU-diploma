// packages/shared/src/CoPCalculator.ts

import type { SensorData, Coordinates, CalibrationData } from './types.js';
import { SENSOR_DISTANCE, PLATFORM_SIZE } from './constants.js';

/**
 * Калькулятор центра давления (Center of Pressure)
 * 
 * Схема расположения датчиков:
 * 
 *       Y+ (вперёд)
 *         ↑
 *    ┌────┴────┐
 *    │ D1   D2 │
 *    │    ●    │  ← Центр платформы (0, 0)
 *    │ D4   D3 │
 *    └────┬────┘
 *         ↓
 *       Y- (назад)
 *   
 *   X- ←───────→ X+
 * (лево)      (право)
 */
export class CoPCalculator {
  /** Расстояние между датчиками (мм) */
  private sensorDistanceX: number;
  private sensorDistanceY: number;
  
  /** Смещения нуля для каждого датчика */
  private offsets: SensorData = { d1: 0, d2: 0, d3: 0, d4: 0 };
  
  /** Минимальная сила для расчёта CoP (защита от деления на 0) */
  private minForce: number = 100;

  constructor(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
    minForce?: number;
  } = {}) {
    this.sensorDistanceX = options.sensorDistanceX ?? SENSOR_DISTANCE.x;
    this.sensorDistanceY = options.sensorDistanceY ?? SENSOR_DISTANCE.y;
    this.minForce = options.minForce ?? 100;
  }

  /**
   * Установить смещения нуля (калибровка)
   */
  setOffsets(offsets: SensorData): void {
    this.offsets = { ...offsets };
  }

  /**
   * Получить текущие смещения
   */
  getOffsets(): SensorData {
    return { ...this.offsets };
  }

  /**
   * Вычислить координаты CoP из данных 4 датчиков
   */
  calculate(sensors: SensorData): Coordinates {
    // Применяем калибровочные смещения
    const d1 = sensors.d1 - this.offsets.d1;
    const d2 = sensors.d2 - this.offsets.d2;
    const d3 = sensors.d3 - this.offsets.d3;
    const d4 = sensors.d4 - this.offsets.d4;

    // Суммарная сила (пропорциональна весу)
    const totalForce = d1 + d2 + d3 + d4;

    // Защита от деления на ноль
    if (Math.abs(totalForce) < this.minForce) {
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    // Расчёт CoP по формулам:
    // X = (Lx/2) * ((D2 + D3) - (D1 + D4)) / F_total
    // Y = (Ly/2) * ((D1 + D2) - (D3 + D4)) / F_total
    
    const x = (this.sensorDistanceX / 2) * ((d2 + d3) - (d1 + d4)) / totalForce;
    const y = (this.sensorDistanceY / 2) * ((d1 + d2) - (d3 + d4)) / totalForce;

    return {
      x: x,
      y: y,
      z: 0,
      f: totalForce
    };
  }

  /**
   * Вычислить CoP и сразу вернуть в миллиметрах
   * (для случая когда датчики уже откалиброваны в физические единицы)
   */
  calculateMm(sensors: SensorData, scale: number = 1): { x: number; y: number; f: number } {
    const cop = this.calculate(sensors);
    return {
      x: cop.x * scale,
      y: cop.y * scale,
      f: cop.f
    };
  }

  /**
   * Сбросить калибровку
   */
  reset(): void {
    this.offsets = { d1: 0, d2: 0, d3: 0, d4: 0 };
  }

  /**
   * Обновить параметры
   */
  configure(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
    minForce?: number;
  }): void {
    if (options.sensorDistanceX !== undefined) {
      this.sensorDistanceX = options.sensorDistanceX;
    }
    if (options.sensorDistanceY !== undefined) {
      this.sensorDistanceY = options.sensorDistanceY;
    }
    if (options.minForce !== undefined) {
      this.minForce = options.minForce;
    }
  }
}