// packages/server/src/CalibrationStorage.ts

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SensorData } from '@stabilometer/shared';

const CALIBRATION_FILE = join(process.cwd(), 'calibration.json');

export interface StoredCalibration {
  /** Смещения нуля для каждого датчика */
  sensorOffsets: SensorData;
  /** Размер платформы в мм */
  platformSize: { width: number; height: number };
  /** Расстояние между датчиками в мм */
  sensorDistance: { x: number; y: number };
  /** Дата калибровки */
  createdAt: string;
  /** ID устройства (опционально) */
  deviceId?: string;
}

export class CalibrationStorage {
  static load(): StoredCalibration | null {
    try {
      if (!existsSync(CALIBRATION_FILE)) {
        console.log('📁 Файл калибровки не найден');
        return null;
      }

      const data = readFileSync(CALIBRATION_FILE, 'utf-8');
      const calibration = JSON.parse(data) as StoredCalibration;
      
      console.log('✅ Калибровка загружена из файла:', {
        d1: calibration.sensorOffsets.d1,
        d2: calibration.sensorOffsets.d2,
        d3: calibration.sensorOffsets.d3,
        d4: calibration.sensorOffsets.d4,
        age: this.getAge(calibration.createdAt)
      });
      
      return calibration;
    } catch (error) {
      console.error('❌ Ошибка загрузки калибровки:', error);
      return null;
    }
  }

  static save(calibration: StoredCalibration): boolean {
    try {
      writeFileSync(CALIBRATION_FILE, JSON.stringify(calibration, null, 2));
      console.log('💾 Калибровка сохранена в файл');
      return true;
    } catch (error) {
      console.error('❌ Ошибка сохранения калибровки:', error);
      return false;
    }
  }

  static exists(): boolean {
    return existsSync(CALIBRATION_FILE);
  }

  private static getAge(createdAt: string): string {
    const age = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(age / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} дн. назад`;
    if (hours > 0) return `${hours} ч. назад`;
    return 'только что';
  }
}