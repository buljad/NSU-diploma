import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { AxisConfiguration, SensorData } from '@stabilometer/shared';

export interface StoredCalibration {
  sensorOffsets: SensorData;
  platformSize: { width: number; height: number };
  sensorDistance: { x: number; y: number };
  createdAt: string;
  deviceId?: string;
  sampleCount?: number;
  axisConfig?: AxisConfiguration;
}

export function isStoredCalibration(
  value: unknown,
): value is StoredCalibration {
  if (!value || typeof value !== 'object') return false;
  const data = value as StoredCalibration;
  const positive = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 10000;
  const axes = data.axisConfig;
  return (
    !!data.sensorOffsets &&
    (['d1', 'd2', 'd3', 'd4'] as const).every(
      (key) =>
        Number.isFinite(data.sensorOffsets[key]) &&
        Math.abs(data.sensorOffsets[key]) <= 0x800000,
    ) &&
    !!data.platformSize &&
    positive(data.platformSize.width) &&
    positive(data.platformSize.height) &&
    !!data.sensorDistance &&
    positive(data.sensorDistance.x) &&
    positive(data.sensorDistance.y) &&
    data.sensorDistance.x <= data.platformSize.width &&
    data.sensorDistance.y <= data.platformSize.height &&
    typeof data.createdAt === 'string' &&
    Number.isFinite(Date.parse(data.createdAt)) &&
    (data.deviceId === undefined || typeof data.deviceId === 'string') &&
    (data.sampleCount === undefined ||
      (Number.isInteger(data.sampleCount) && data.sampleCount >= 0)) &&
    (axes === undefined ||
      (typeof axes.swapXY === 'boolean' &&
        typeof axes.invertX === 'boolean' &&
        typeof axes.invertY === 'boolean' &&
        Number.isFinite(axes.rotationDeg)))
  );
}

/** User data is independent of the working directory and survives app updates. */
export class CalibrationStorage {
  static getPath(): string {
    const base =
      process.env.STABILOMETER_DATA_DIR ||
      (process.platform === 'win32'
        ? join(
            process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
            'Stabilometer',
          )
        : join(
            process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
            'stabilometer',
          ));
    return join(resolve(base), 'calibration.json');
  }

  static load(): StoredCalibration | null {
    try {
      const preferred = this.getPath();
      // Preserve an existing development calibration; an explicit data directory
      // disables fallback so isolated installs/tests cannot inherit another file.
      const legacy = join(process.cwd(), 'calibration.json');
      const path = existsSync(preferred)
        ? preferred
        : !process.env.STABILOMETER_DATA_DIR && existsSync(legacy)
          ? legacy
          : null;
      if (!path) return null;
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!isStoredCalibration(value))
        throw new Error('Invalid calibration file');
      return value;
    } catch (error) {
      console.error('Не удалось прочитать калибровку:', error);
      return null;
    }
  }

  static save(calibration: StoredCalibration): boolean {
    const path = this.getPath();
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      if (!isStoredCalibration(calibration))
        throw new Error('Invalid calibration');
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(temporary, JSON.stringify(calibration, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      const descriptor = openSync(temporary, 'r+');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, path);
      return true;
    } catch (error) {
      console.error('Не удалось сохранить калибровку:', error);
      return false;
    } finally {
      try {
        if (existsSync(temporary)) rmSync(temporary);
      } catch (error) {
        console.error('Не удалось удалить временный файл калибровки:', error);
      }
    }
  }

  static exists(): boolean {
    return existsSync(this.getPath());
  }
}
