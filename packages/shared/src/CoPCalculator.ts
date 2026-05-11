// packages/shared/src/CoPCalculator.ts

import type { SensorData, Coordinates, CalibrationData } from './types.js';
import { SENSOR_DISTANCE, PLATFORM_SIZE } from './constants.js';

/**
 * Калькулятор центра давления (Center of Pressure) v2.4+ 
 * 
 * ✅ КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ:
 * - Убрано динамическое масштабирование (уничтожало точность)
 * - Правильная обработка отрицательных значений после вычитания offset'ов
 * - Упрощенная и стабильная формула CoP
 * - Защита от деления на ноль при малой силе
 */
export class CoPCalculator {
  private sensorDistanceX: number;
  private sensorDistanceY: number;
  private offsets: SensorData = { d1: 0, d2: 0, d3: 0, d4: 0 };
  private isCalibrated: boolean = false;
  
  // ✅ ИСПРАВЛЕНО: Фиксированный масштаб вместо динамического
  private readonly FORCE_SCALE = 0.001;  // Перевод единиц датчика в "условные единицы силы"
  private readonly MIN_TOTAL_FORCE = 10; // Минимальная сила для валидного CoP (в scaled единицах)
  private readonly MAX_COORD = 150;
  
  private sampleCount = 0;
  private forceHistory: number[] = [];
  private problemCounter = 0;

  constructor(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
  } = {}) {
    this.sensorDistanceX = options.sensorDistanceX ?? SENSOR_DISTANCE.x;
    this.sensorDistanceY = options.sensorDistanceY ?? SENSOR_DISTANCE.y;
    console.log('🎯 CoPCalculator v2.4+ created (stable math):', {
      sensorDistanceX: this.sensorDistanceX,
      sensorDistanceY: this.sensorDistanceY
    });
  }

  setOffsets(offsets: SensorData): void {
    this.offsets = { ...offsets };
    this.isCalibrated = true;
    
    // ✅ УБРАНО: Динамическое масштабирование и проверка на несбалансированность
    console.log('✅ Калибровка установлена v2.4+:', {
      offsets: {
        d1: offsets.d1.toFixed(0),
        d2: offsets.d2.toFixed(0),
        d3: offsets.d3.toFixed(0),
        d4: offsets.d4.toFixed(0)
      },
      forceScale: this.FORCE_SCALE,
      minTotalForce: this.MIN_TOTAL_FORCE
    });
  }

  getOffsets(): SensorData {
    return { ...this.offsets };
  }

  isReady(): boolean {
    return this.isCalibrated;
  }

 calculate(sensors: SensorData): Coordinates {
    if (!this.isCalibrated) {
      return { x: 0, y: 0, z: 0, f: 0 };
    }

    this.sampleCount++;

    // ✅ ШАГ 1 & 2: Вычитаем оффсеты и СРАЗУ отсекаем отрицательный шум
    // Любое значение меньше оффсета приравниваем к 0 (давления нет)
    const d1 = Math.max(0, (sensors.d1 - this.offsets.d1) * this.FORCE_SCALE);
    const d2 = Math.max(0, (sensors.d2 - this.offsets.d2) * this.FORCE_SCALE);
    const d3 = Math.max(0, (sensors.d3 - this.offsets.d3) * this.FORCE_SCALE);
    const d4 = Math.max(0, (sensors.d4 - this.offsets.d4) * this.FORCE_SCALE);

    // ✅ ШАГ 3: Общая сила теперь — это сумма чистых положительных давлений
    const totalForce = d1 + d2 + d3 + d4;
    
    // ✅ ШАГ 4: Снижаем порог до минимума, так как мы уже убрали отрицательный шум
    if (totalForce < 0.1) { 
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    // ✅ ШАГ 5: Вычисляем CoP (теперь числитель и знаменатель согласованы)
    const xRaw = (this.sensorDistanceX / 2) * ((d2 + d3) - (d1 + d4)) / totalForce;
    const yRaw = (this.sensorDistanceY / 2) * ((d1 + d2) - (d3 + d4)) / totalForce;

    // ШАГ 6: Проверка на валидность чисел
    if (!isFinite(xRaw) || !isFinite(yRaw)) {
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    // ШАГ 7: Ограничение
    const x = Math.max(-this.MAX_COORD, Math.min(this.MAX_COORD, xRaw));
    const y = Math.max(-this.MAX_COORD, Math.min(this.MAX_COORD, yRaw));

    this.updateForceStatistics(totalForce);

    if (this.sampleCount % 5000 === 0) {
      this.logDiagnostics(sensors, { x, y }, totalForce);
    }

    return { x, y, z: 0, f: totalForce };
  }

  private updateForceStatistics(force: number): void {
    this.forceHistory.push(force);
    if (this.forceHistory.length > 1000) {
      this.forceHistory.shift();
    }
  }

  private logDiagnostics(sensors: SensorData, result: { x: number; y: number }, totalForce: number): void {
    const avgForce = this.forceHistory.length > 0
      ? this.forceHistory.reduce((a, b) => a + b, 0) / this.forceHistory.length
      : 0;
      
    console.log('🔍 CoP Диагностика v2.4+:', {
      sampleCount: this.sampleCount,
      problemCount: this.problemCounter,
      currentForce: totalForce.toFixed(3),
      forceStats: {
        avg: avgForce.toFixed(3),
        min: Math.min(...this.forceHistory).toFixed(3),
        max: Math.max(...this.forceHistory).toFixed(3),
        samples: this.forceHistory.length
      },
      result: [result.x.toFixed(1), result.y.toFixed(1)],
      settings: {
        forceScale: this.FORCE_SCALE,
        minTotalForce: this.MIN_TOTAL_FORCE,
        maxCoord: this.MAX_COORD
      }
    });
  }

  reset(): void {
    this.offsets = { d1: 0, d2: 0, d3: 0, d4: 0 };
    this.isCalibrated = false;
    this.sampleCount = 0;
    this.forceHistory = [];
    this.problemCounter = 0;
    console.log('🔄 CoPCalculator v2.4+ reset');
  }

  configure(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
  }): void {
    if (options.sensorDistanceX !== undefined) {
      this.sensorDistanceX = options.sensorDistanceX;
    }
    if (options.sensorDistanceY !== undefined) {
      this.sensorDistanceY = options.sensorDistanceY;
    }
    console.log('🔧 Параметры CoPCalculator v2.4+ обновлены:', { 
      sensorDistanceX: this.sensorDistanceX, 
      sensorDistanceY: this.sensorDistanceY 
    });
  }

  getStats(): {
    sampleCount: number;
    problemCount: number;
    forceHistorySize: number;
    avgForce: number;
    isCalibrated: boolean;
  } {
    const avgForce = this.forceHistory.length > 0
      ? this.forceHistory.reduce((a, b) => a + b, 0) / this.forceHistory.length
      : 0;

    return {
      sampleCount: this.sampleCount,
      problemCount: this.problemCounter,
      forceHistorySize: this.forceHistory.length,
      avgForce,
      isCalibrated: this.isCalibrated
    };
  }
}