// packages/shared/src/types.ts

export interface Vector2D {
  x: number;
  y: number;
}

export interface Vector3D extends Vector2D {
  z: number;
}

/**
 * Сырые данные с 4 тензодатчиков
 */
export interface SensorData {
  d1: number; // Верхний левый датчик
  d2: number; // Верхний правый датчик
  d3: number; // Нижний правый датчик
  d4: number; // Нижний левый датчик
}

/**
 * Координаты центра давления (CoP)
 */
export interface Coordinates {
  x: number; // Положение по X (мм)
  y: number; // Положение по Y (мм)
  z: number; // Резерв (всегда 0)
  f: number; // Суммарная нагрузка в условных единицах (не кг и не Н)
}

export interface AxisConfiguration {
  swapXY: boolean;
  invertX: boolean;
  invertY: boolean;
  rotationDeg: number;
}

export interface CalibrationData {
  /** Смещение нуля для каждого датчика */
  sensorOffsets: SensorData;
  /** Размер платформы в мм */
  platformSize: { width: number; height: number };
  /** Расстояние между датчиками в мм */
  sensorDistance: { x: number; y: number };
  /** Временная метка калибровки */
  timestamp: number;
  /** Количество сэмплов */
  sampleCount: number;
  /** Валидность калибровки */
  isValid: boolean;
}

export interface StabilogramSample {
  /** Сырые данные с датчиков */
  sensors: SensorData;
  /** Вычисленные координаты CoP после вычитания нуля, в мм */
  raw: Coordinates;
  /** После калибровки и трансформации осей */
  centered: Coordinates;
  /** После серверного фильтра для отображения */
  filtered: Coordinates;
  /** Физические координаты в мм */
  mm: Vector2D;
  /** Время с устройства */
  deviceTime: number;
  /** Время получения на клиенте */
  clientTime: number;
  /** Номер пакета */
  packetNumber: number;
  /** Пригодность измерения для анализа; отсутствует у старых записей. */
  isValid?: boolean;
  /** Например not-calibrated, insufficient-load или calibrating. */
  invalidReason?: string;
  /** Время получения сервером (Unix, мс), отдельно от времени браузера. */
  serverTime?: number;
}

export interface ParsedPacket {
  /** Статус байт (0 или 1) */
  status: number;
  /** Сырые данные с 4 датчиков */
  sensors: SensorData;
  /** Время с устройства */
  deviceTime: number;
  /** Номер пакета */
  packetNumber: number;
  /** Валидность пакета */
  isValid: boolean;
  /** Описание ошибки */
  error?: string;
}

export interface ParserStats {
  totalPackets: number;
  validPackets: number;
  invalidPackets: number;
  bufferOverflows: number;
  partialPackets: number;
  lastError: string | null;
}

// WebSocket message types
export type ServerMessageType =
  | 'DATA'
  | 'DATA_BATCH'
  | 'CONNECTED'
  | 'SERIAL_CONNECTED'
  | 'SERIAL_DISCONNECTED'
  | 'CALIBRATION_STARTED'
  | 'CALIBRATION_PROGRESS'
  | 'CALIBRATION_COMPLETE'
  | 'CALIBRATION_CANCELLED'
  | 'SIGNAL_QUALITY'
  | 'PERFORMANCE_UPDATED'
  | 'SENSOR_DIAGNOSIS'
  | 'AXES_CONFIGURED'
  | 'PORTS_LIST'
  | 'ERROR'
  | 'PONG';

export type ClientMessageType =
  | 'CONNECT'
  | 'DISCONNECT'
  | 'CALIBRATE_ZERO'
  | 'CONFIGURE_AXES'
  | 'LIST_PORTS'
  | 'SET_PERFORMANCE'
  | 'DIAGNOSE_SENSORS'
  | 'PING';

export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface WSMessage<T = unknown> {
  type: string;
  payload?: T;
  timestamp?: number;
}
