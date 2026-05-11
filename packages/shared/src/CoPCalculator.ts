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
  private isCalibrated: boolean = false;
  
  // ✅ ДИНАМИЧЕСКОЕ масштабирование на основе реальных данных
  private dynamicScale = 1.0;
  private readonly MIN_FORCE = 50; // в нормализованных единицах
  private readonly MAX_COORD = 150; // максимальное отклонение CoP в мм
  private sampleCount = 0;
  private forceHistory: number[] = [];

  constructor(options: {
    sensorDistanceX?: number;
    sensorDistanceY?: number;
  } = {}) {
    this.sensorDistanceX = options.sensorDistanceX ?? SENSOR_DISTANCE.x;
    this.sensorDistanceY = options.sensorDistanceY ?? SENSOR_DISTANCE.y;
    console.log('🎯 CoPCalculator создан (режим переполнения):', {
      sensorDistanceX: this.sensorDistanceX,
      sensorDistanceY: this.sensorDistanceY
    });
  }

  setOffsets(offsets: SensorData): void {
    this.offsets = { ...offsets };
    this.isCalibrated = true;
    
    // ✅ ДИНАМИЧЕСКОЕ определение масштаба на основе РЕАЛЬНЫХ офсетов
    const avgMagnitude = (Math.abs(offsets.d1) + Math.abs(offsets.d2) + 
                         Math.abs(offsets.d3) + Math.abs(offsets.d4)) / 4;
    
    // Подбираем масштаб так, чтобы типичные значения были в разумном диапазоне
    if (avgMagnitude > 5000000) {
      this.dynamicScale = 0.0000001; // Миллионы -> доли единиц
    } else if (avgMagnitude > 1000000) {
      this.dynamicScale = 0.000001; // Миллионы -> единицы
    } else if (avgMagnitude > 100000) {
      this.dynamicScale = 0.00001;  // Сотни тысяч -> единицы
    } else if (avgMagnitude > 10000) {
      this.dynamicScale = 0.0001;   // Десятки тысяч -> единицы  
    } else if (avgMagnitude > 1000) {
      this.dynamicScale = 0.001;    // Тысячи -> единицы
    } else {
      this.dynamicScale = 0.01;     // Сотни -> единицы
    }
    
    // ✅ Дополнительная проверка на основе диапазона значений
    const maxValue = Math.max(Math.abs(offsets.d1), Math.abs(offsets.d2), 
                              Math.abs(offsets.d3), Math.abs(offsets.d4));
    if (maxValue > 8000000) {
      // Если значения близки к переполнению, используем очень мелкий масштаб
      this.dynamicScale = Math.min(this.dynamicScale, 0.0000001);
    }
    
    console.log('✅ Калибровка установлена:', {
      offsets: {
        d1: offsets.d1.toFixed(0),
        d2: offsets.d2.toFixed(0),
        d3: offsets.d3.toFixed(0),
        d4: offsets.d4.toFixed(0)
      },
      avgMagnitude: avgMagnitude.toFixed(0),
      maxValue: maxValue.toFixed(0),
      dynamicScale: this.dynamicScale,
      expectedForceRange: `${(this.MIN_FORCE / this.dynamicScale).toFixed(0)} - ${(10000 / this.dynamicScale).toFixed(0)}`
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

    // 1. Вычитаем offset'ы (нормализованные - нормализованные)
    const d1_adj = sensors.d1 - this.offsets.d1;
    const d2_adj = sensors.d2 - this.offsets.d2;
    const d3_adj = sensors.d3 - this.offsets.d3;
    const d4_adj = sensors.d4 - this.offsets.d4;

    // 2. Применяем динамическое масштабирование
    const d1 = d1_adj * this.dynamicScale;
    const d2 = d2_adj * this.dynamicScale;
    const d3 = d3_adj * this.dynamicScale;
    const d4 = d4_adj * this.dynamicScale;

    // 3. ✅ УЛУЧШЕННЫЙ расчет силы с учетом знаков
    const totalForce = Math.abs(d1) + Math.abs(d2) + Math.abs(d3) + Math.abs(d4);
    
    // Адаптивная минимальная сила на основе истории
    this.updateForceStatistics(totalForce);
    const adaptiveMinForce = this.getAdaptiveMinForce();
    
    if (totalForce < adaptiveMinForce) {
      return { x: 0, y: 0, z: 0, f: totalForce };
    }

    // 4. ✅ СТАНДАРТНЫЕ формулы CoP с правильными знаками
    const xRaw = (this.sensorDistanceX / 2) * ((d2 + d3) - (d1 + d4)) / totalForce;
    const yRaw = (this.sensorDistanceY / 2) * ((d1 + d2) - (d3 + d4)) / totalForce;

    // 5. ✅ АДАПТИВНОЕ ограничение координат на основе масштаба
    const adaptiveMaxCoord = this.MAX_COORD * Math.min(1, this.dynamicScale * 100000);
    const x = Math.max(-adaptiveMaxCoord, Math.min(adaptiveMaxCoord, xRaw));
    const y = Math.max(-adaptiveMaxCoord, Math.min(adaptiveMaxCoord, yRaw));

    // ✅ Периодическая диагностика
    this.sampleCount++;
    if (this.sampleCount % 1000 === 0) {
      const avgForce = this.forceHistory.length > 0
        ? this.forceHistory.reduce((a, b) => a + b, 0) / this.forceHistory.length
        : 0;
      console.log('🔍 CoP Диагностика:', {
        sampleCount: this.sampleCount,
        rawSensors: [sensors.d1, sensors.d2, sensors.d3, sensors.d4].map(v => v.toFixed(0)),
        adjustedSensors: [d1_adj, d2_adj, d3_adj, d4_adj].map(v => v.toFixed(0)),
        scaledSensors: [d1, d2, d3, d4].map(v => v.toFixed(3)),
        totalForce: totalForce.toFixed(3),
        avgForce: avgForce.toFixed(3),
        adaptiveMinForce: adaptiveMinForce.toFixed(3),
        result: [x.toFixed(1), y.toFixed(1)],
        dynamicScale: this.dynamicScale,
        adaptiveMaxCoord: adaptiveMaxCoord.toFixed(1)
      });
    }

    return { x, y, z: 0, f: totalForce };
  }

  private updateForceStatistics(force: number): void {
    this.forceHistory.push(force);
    if (this.forceHistory.length > 2000) {
      this.forceHistory.shift();
    }
  }

  private getAdaptiveMinForce(): number {
    if (this.forceHistory.length < 10) {
      return this.MIN_FORCE;
    }

    // Вычисляем медиану силы как основу для адаптивного порога
    const sorted = [...this.forceHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Минимальная сила = 10% от медианы, но не меньше базового порога
    return Math.max(this.MIN_FORCE, median * 0.1);
  }

  reset(): void {
    this.offsets = { d1: 0, d2: 0, d3: 0, d4: 0 };
    this.isCalibrated = false;
    this.dynamicScale = 1.0;
    this.sampleCount = 0;
    this.forceHistory = [];
    console.log('🔄 CoPCalculator сброшен');
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
    console.log('🔧 Параметры CoPCalculator обновлены:', { 
      sensorDistanceX: this.sensorDistanceX, 
      sensorDistanceY: this.sensorDistanceY 
    });
  }

  // ✅ РАСШИРЕННАЯ диагностика
  getDiagnosticInfo(sensors: SensorData): {
    rawSensors: SensorData;
    adjustedSensors: SensorData;
    scaledSensors: SensorData;
    totalForceScaled: number;
    adaptiveMinForce: number;
    dynamicScale: number;
    isCalibrated: boolean;
    offsets: SensorData;
    forceHistoryStats: {
      count: number;
      min: number;
      max: number;
      avg: number;
      median: number;
    };
  } {
    const adjusted = {
      d1: sensors.d1 - this.offsets.d1,
      d2: sensors.d2 - this.offsets.d2,
      d3: sensors.d3 - this.offsets.d3,
      d4: sensors.d4 - this.offsets.d4,
    };

    const scaled = {
      d1: adjusted.d1 * this.dynamicScale,
      d2: adjusted.d2 * this.dynamicScale,
      d3: adjusted.d3 * this.dynamicScale,
      d4: adjusted.d4 * this.dynamicScale,
    };

    const totalForceScaled = Math.abs(scaled.d1) + Math.abs(scaled.d2) + 
                            Math.abs(scaled.d3) + Math.abs(scaled.d4);

    // Статистика истории сил
    const forceHistoryStats = this.forceHistory.length > 0 ? {
      count: this.forceHistory.length,
      min: Math.min(...this.forceHistory),
      max: Math.max(...this.forceHistory),
      avg: this.forceHistory.reduce((a, b) => a + b) / this.forceHistory.length,
      median: [...this.forceHistory].sort((a, b) => a - b)[Math.floor(this.forceHistory.length / 2)]
    } : {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      median: 0
    };

    return {
      rawSensors: sensors,
      adjustedSensors: adjusted,
      scaledSensors: scaled,
      totalForceScaled,
      adaptiveMinForce: this.getAdaptiveMinForce(),
      dynamicScale: this.dynamicScale,
      isCalibrated: this.isCalibrated,
      offsets: this.offsets,
      forceHistoryStats
    };
  }

  // ✅ Метод для экспорта статистики
  getStats(): {
    sampleCount: number;
    dynamicScale: number;
    forceHistorySize: number;
    avgForce: number;
    isCalibrated: boolean;
  } {
    const avgForce = this.forceHistory.length > 0
      ? this.forceHistory.reduce((a, b) => a + b, 0) / this.forceHistory.length
      : 0;

    return {
      sampleCount: this.sampleCount,
      dynamicScale: this.dynamicScale,
      forceHistorySize: this.forceHistory.length,
      avgForce,
      isCalibrated: this.isCalibrated
    };
  }
}