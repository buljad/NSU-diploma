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
  private minForce: number = 500;  // ✅ Увеличено с 100 до 500
  
  /** Максимальная координата для защиты от выбросов */
  private maxCoordinate: number;

  constructor(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
    minForce?: number;
  } = {}) {
    this.sensorDistanceX = options.sensorDistanceX ?? SENSOR_DISTANCE.x;
    this.sensorDistanceY = options.sensorDistanceY ?? SENSOR_DISTANCE.y;
    this.minForce = options.minForce ?? 500;
    
    // ✅ Максимальная координата = 1.5 * расстояние между датчиками
    this.maxCoordinate = Math.max(this.sensorDistanceX, this.sensorDistanceY) * 1.5;
  }

  /**
   * Установить смещения нуля (калибровка)
   */
  setOffsets(offsets: SensorData): void {
    this.offsets = { ...offsets };
    console.log('📐 Установлены offset\'ы:', this.offsets);
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

    // ✅ ИСПРАВЛЕНИЕ 1: Защита от отрицательных значений
    // Если offset больше текущего показания, обнуляем
    const d1Safe = Math.max(d1, 0);
    const d2Safe = Math.max(d2, 0);
    const d3Safe = Math.max(d3, 0);
    const d4Safe = Math.max(d4, 0);

    // Суммарная сила (пропорциональна весу)
    const totalForce = d1Safe + d2Safe + d3Safe + d4Safe;

    // ✅ ИСПРАВЛЕНИЕ 2: Усиленная защита от деления на ноль
    if (totalForce < this.minForce) {
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    // Расчёт CoP по формулам:
    // X = (Lx/2) * ((D2 + D3) - (D1 + D4)) / F_total
    // Y = (Ly/2) * ((D1 + D2) - (D3 + D4)) / F_total
    
    const xRaw = (this.sensorDistanceX / 2) * ((d2Safe + d3Safe) - (d1Safe + d4Safe)) / totalForce;
    const yRaw = (this.sensorDistanceY / 2) * ((d1Safe + d2Safe) - (d3Safe + d4Safe)) / totalForce;

    // ✅ ИСПРАВЛЕНИЕ 3: Clamp координат для защиты от выбросов
    const x = this.clampCoordinate(xRaw);
    const y = this.clampCoordinate(yRaw);

    // ✅ ИСПРАВЛЕНИЕ 4: Дополнительная валидация
    if (!this.isValidCoordinate(x) || !this.isValidCoordinate(y)) {
      console.warn('⚠️ Невалидные координаты CoP:', { xRaw, yRaw, x, y, totalForce });
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    return {
      x: x,
      y: y,
      z: 0,
      f: totalForce
    };
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Ограничение координат
   */
  private clampCoordinate(value: number): number {
    return Math.max(-this.maxCoordinate, Math.min(this.maxCoordinate, value));
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Проверка валидности координаты
   */
  private isValidCoordinate(value: number): boolean {
    return Number.isFinite(value) && !Number.isNaN(value);
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
   * ✅ НОВЫЙ МЕТОД: Диагностика текущих показаний
   */
  diagnose(sensors: SensorData): {
    raw: SensorData;
    afterOffsets: SensorData;
    safeValues: SensorData;
    totalForce: number;
    isValid: boolean;
  } {
    const afterOffsets = {
      d1: sensors.d1 - this.offsets.d1,
      d2: sensors.d2 - this.offsets.d2,
      d3: sensors.d3 - this.offsets.d3,
      d4: sensors.d4 - this.offsets.d4,
    };

    const safeValues = {
      d1: Math.max(afterOffsets.d1, 0),
      d2: Math.max(afterOffsets.d2, 0),
      d3: Math.max(afterOffsets.d3, 0),
      d4: Math.max(afterOffsets.d4, 0),
    };

    const totalForce = safeValues.d1 + safeValues.d2 + safeValues.d3 + safeValues.d4;

    return {
      raw: sensors,
      afterOffsets,
      safeValues,
      totalForce,
      isValid: totalForce >= this.minForce
    };
  }

  /**
   * Сбросить калибровку
   */
  reset(): void {
    this.offsets = { d1: 0, d2: 0, d3: 0, d4: 0 };
    console.log('🔄 Калибровка сброшена');
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
    
    // Пересчитываем максимальную координату
    this.maxCoordinate = Math.max(this.sensorDistanceX, this.sensorDistanceY) * 1.5;
    
    console.log('⚙️ Конфигурация обновлена:', {
      sensorDistanceX: this.sensorDistanceX,
      sensorDistanceY: this.sensorDistanceY,
      minForce: this.minForce,
      maxCoordinate: this.maxCoordinate
    });
  }
}