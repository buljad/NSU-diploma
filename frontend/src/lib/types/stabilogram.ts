/**
 * Типы данных стабилометра
 */

/**
 * Информация о COM-порте
 */
export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  productId?: string;
  vendorId?: string;
}

/**
 * Конфигурация для подключения к COM-порту
 */
export interface SerialConfig {
  baudRate?: number;
  portPath?: string | null;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  testMode?: boolean;
}

/**
 * Интерпретация координат (один вариант)
 */
export interface CoordinateInterpretation {
  x: number;
  y: number;
  force: number;
  extra: number;
  time: number;
}

/**
 * Все варианты интерпретации
 */
export interface StabilogramInterpretation {
  variant1: CoordinateInterpretation; // прямые значения
  variant2: CoordinateInterpretation; // центрированные
  variant3: CoordinateInterpretation; // нормализованные
}

/**
 * Распарсенные данные пакета стабилометра
 */
export interface ParsedStabilogramData {
  raw: string;
  timestamp: number;
  coordinates: {
    coord1: number;
    coord2: number;
    coord3: number;
    coord4: number;
  };
  deviceTime: number;
  interpretation: StabilogramInterpretation;
}

/**
 * Сообщение с данными стабилометра
 */
export interface StabilogramDataMessage {
  type: 'DATA';
  raw: string;
  parsed: ParsedStabilogramData | null;
  timestamp: number;
}

/**
 * Статус подключения
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'reconnecting';

/**
 * Состояние приложения стабилометра
 */
export interface StabilogramState {
  connected: boolean;
  serialConnected: boolean;
  data: StabilogramDataMessage[];
  status: ConnectionStatus;
  error: string | null;
  availablePorts: SerialPortInfo[];
}