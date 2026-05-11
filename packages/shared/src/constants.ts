// packages/shared/src/constants.ts

/** Терминатор пакета '&' */
export const PACKET_TERMINATOR = 0x26;

/** Длина пакета в байтах */
export const PACKET_LENGTH = 22;

/** Максимальный размер буфера */
export const MAX_BUFFER_SIZE = 4096;

/** Скорость COM-порта по умолчанию */
export const DEFAULT_BAUD_RATE = 115200;

/** Частота дискретизации (Hz) */
export const DEFAULT_SAMPLE_RATE = 50;

/** WebSocket порт */
export const WEBSOCKET_PORT = 3001;
export const WEBSOCKET_HOST = 'localhost';

/** Размер платформы по умолчанию (мм) */
export const PLATFORM_SIZE = {
  width: 300,   // 30 см
  height: 300   // 30 см
};

/** Расстояние между датчиками (мм) - обычно немного меньше размера платформы */
export const SENSOR_DISTANCE = {
  x: 260,  // Расстояние между датчиками по X
  y: 260   // Расстояние между датчиками по Y
};

/** Настройки фильтра по умолчанию */
export const FILTER_DEFAULTS = {
  processNoise: 0.1,
  measurementNoise: 2,
  dt: 0.02
} as const;

/** Настройки калибровки */
export const CALIBRATION_DEFAULTS = {
  sampleCount: 100,
  stabilityThreshold: 500,    // Максимальное std для стабильности
  outlierThreshold: 4.0,      // Порог выброса в std
  minStableDuration: 1000     // Минимальное время стабильности (мс)
} as const;

/** Настройки рендеринга */
export const RENDER_DEFAULTS = {
  minScale: 2,
  maxScale: 20,
  targetMargin: 0.15,
  maxTrailPoints: 500
} as const;

/** 
 * Коэффициент перевода единиц датчика в мм
 * Подбирается экспериментально!
 * Если показания "улетают" - увеличить значение
 * Если показания слишком маленькие - уменьшить
 */
export const MM_PER_UNIT = 0.01;

/** ✅ НОВЫЕ НАСТРОЙКИ ПРОИЗВОДИТЕЛЬНОСТИ v2.3 */
export const PERFORMANCE_DEFAULTS = {
  // Парсер
  enableFastParsing: true,           // Быстрые алгоритмы парсинга
  enablePacketRecovery: true,        // Восстановление поврежденных пакетов
  enableValueCaching: true,          // Кэширование декодированных значений
  maxRecoveryAttempts: 2,            // Максимум попыток восстановления

  // Серверные буферы
  enableOptimizedBuffers: true,      // Увеличенные буферы SerialPort
  serialBufferSize: 1024 * 8,        // 8KB буфер SerialPort
  maxListeners: 50,                  // Больше слушателей событий

  // Batch-отправка
  enableBatchSending: false,         // Группировка пакетов (экспериментально)
  batchSize: 5,                      // Размер группы пакетов
  batchTimeoutMs: 10,                // Максимальное время накопления

  // Мониторинг
  logSlowOperations: true,           // Логирование медленных операций
  slowOperationThresholdMs: 5,       // Порог "медленной" операции
} as const;