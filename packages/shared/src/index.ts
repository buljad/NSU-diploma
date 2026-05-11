// packages/shared/src/index.ts

// Экспорт классов
export { PacketParser } from './PacketParser.js';
export { ByteRingBuffer, RingBuffer } from './RingBuffer.js';  // ✅ Оба имени
export { AxisTransform } from './AxisTransform.js';
export { CoPCalculator } from './CoPCalculator.js';
export { CoPSmartFilter } from './CoPSmartFilter.js';
export { TypedRingBuffer } from './TypedRingBuffer.js';

// Экспорт типов
export type {
  SensorData,
  ParsedPacket,
  ParserStats,
  Coordinates,
  Vector2D,
  Vector3D,
  StabilogramSample,
  AxisConfiguration,
  CalibrationData,
  PortInfo,
  WSMessage,
  ServerMessageType,
  ClientMessageType
} from './types.js';

// Экспорт констант
export {
  PACKET_TERMINATOR,
  PACKET_LENGTH,
  MAX_BUFFER_SIZE,
  DEFAULT_BAUD_RATE,
  DEFAULT_SAMPLE_RATE,
  WEBSOCKET_PORT,
  WEBSOCKET_HOST,
  PLATFORM_SIZE,
  SENSOR_DISTANCE,
  FILTER_DEFAULTS,
  CALIBRATION_DEFAULTS,
  RENDER_DEFAULTS,
  MM_PER_UNIT,
  PERFORMANCE_DEFAULTS  // ✅ НОВОЕ
} from './constants.js';