// packages/shared/src/PacketParser.ts

import { ByteRingBuffer } from './RingBuffer.js';
import type { SensorData, ParsedPacket, ParserStats } from './types.js';
import { PACKET_TERMINATOR, PACKET_LENGTH, MAX_BUFFER_SIZE } from './constants.js';

/**
 * Парсер пакетов стабилометра
 * 
 * Формат пакета (22 байта):
 * [STATUS:1][D1:4][D2:4][D3:4][D4:4][TIME:4][&:1]
 * 
 * Кодирование 6-bit ASCII (из спецификации):
 * - Если байт < 35: значение 0
 * - Если 35 ≤ байт ≤ 93: значение = байт - 35 (0-58)
 * - Если байт == 94 ('^'): значение 0 (служебный символ, пропускается при кодировании)
 * - Если 95 ≤ байт ≤ 99: значение = байт - 36 (59-63)
 * - Если байт ≥ 100: значение 0 (ошибка передачи)
 */
export class PacketParser {
  private buffer: ByteRingBuffer;
  private stats: ParserStats;
  private packetCounter: number = 0;
  
  /** Предыдущие валидные данные (для детекции выбросов) */
  private lastValidSensors: SensorData | null = null;
  
  /** Включить фильтрацию выбросов */
  private filterOutliers: boolean = true;
  
  /** Порог выброса (максимальный скачок между пакетами) */
  private outlierThreshold: number = 50000;

  /** Таблица декодирования ASCII -> 6-bit значение */
  private static readonly decodeLUT: Int8Array = PacketParser.buildDecodeLUT();

  constructor(options: { filterOutliers?: boolean; outlierThreshold?: number } = {}) {
    this.buffer = new ByteRingBuffer(MAX_BUFFER_SIZE);
    this.stats = this.createInitialStats();
    this.filterOutliers = options.filterOutliers ?? true;
    this.outlierThreshold = options.outlierThreshold ?? 50000;
  }

  private createInitialStats(): ParserStats {
    return {
      totalPackets: 0,
      validPackets: 0,
      invalidPackets: 0,
      bufferOverflows: 0,
      partialPackets: 0,
      lastError: null
    };
  }

  /**
   * Построение таблицы декодирования согласно спецификации Arduino
   */
  private static buildDecodeLUT(): Int8Array {
    const lut = new Int8Array(128);
    
    for (let i = 0; i < 128; i++) {
      if (i < 35) {
        // Байт < 35: берём 0
        lut[i] = 0;
      } else if (i <= 93) {
        // 35 ≤ байт ≤ 93: значение = байт - 35 (0-58)
        lut[i] = i - 35;
      } else if (i === 94) {
        // Байт == 94 ('^'): служебный символ, берём 0
        lut[i] = 0;
      } else if (i <= 99) {
        // 95 ≤ байт ≤ 99: значение = байт - 36 (59-63)
        lut[i] = i - 36;
      } else {
        // Байт ≥ 100: ошибка передачи, берём 0
        lut[i] = 0;
      }
    }

    return lut;
  }

  setFilterOutliers(enabled: boolean): void {
    this.filterOutliers = enabled;
  }

  setOutlierThreshold(threshold: number): void {
    this.outlierThreshold = threshold;
  }

  addData(data: string | Uint8Array): void {
    let bytes: Uint8Array;

    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else {
      bytes = data;
    }

    const written = this.buffer.write(bytes);

    if (written < bytes.length) {
      this.stats.bufferOverflows++;
      this.discardUntilTerminator();
    }
  }

  parseAll(): ParsedPacket[] {
    const packets: ParsedPacket[] = [];
    let maxIterations = 50; // Защита от бесконечного цикла

    while (maxIterations-- > 0) {
      const packet = this.parseNext();
      if (!packet) break;
      packets.push(packet);
    }

    return packets;
  }

  parseNext(): ParsedPacket | null {
    const terminatorPos = this.buffer.indexOf(PACKET_TERMINATOR);

    if (terminatorPos === -1) {
      return null;
    }

    // Пакет слишком короткий - пропускаем мусор
    if (terminatorPos < PACKET_LENGTH - 1) {
      this.stats.invalidPackets++;
      this.stats.lastError = `Incomplete packet: ${terminatorPos + 1} bytes`;
      this.buffer.skip(terminatorPos + 1);
      return this.parseNext();
    }

    // Есть лишние байты перед пакетом - пропускаем их
    if (terminatorPos > PACKET_LENGTH - 1) {
      const skipBytes = terminatorPos - (PACKET_LENGTH - 1);
      this.buffer.skip(skipBytes);
      this.stats.partialPackets++;
    }

    const packetBytes = this.buffer.read(PACKET_LENGTH);
    return this.decodePacket(packetBytes);
  }

  private decodePacket(bytes: Uint8Array): ParsedPacket {
    this.stats.totalPackets++;

    // Проверка терминатора
    if (bytes[PACKET_LENGTH - 1] !== PACKET_TERMINATOR) {
      this.stats.invalidPackets++;
      return this.createInvalidPacket('Invalid terminator');
    }

    try {
      // Статус байт (позиция 0)
      const status = PacketParser.decodeLUT[bytes[0]] ?? 0;
      
      // 4 датчика (позиции 1-4, 5-8, 9-12, 13-16)
      const d1 = this.decode4ByteField(bytes, 1);
      const d2 = this.decode4ByteField(bytes, 5);
      const d3 = this.decode4ByteField(bytes, 9);
      const d4 = this.decode4ByteField(bytes, 13);
      
      // Время (позиции 17-20)
      const deviceTime = this.decode4ByteField(bytes, 17);

      const sensors: SensorData = { d1, d2, d3, d4 };

      // Проверка на выброс (резкий скачок)
      if (this.filterOutliers && this.lastValidSensors) {
        const jump = Math.max(
          Math.abs(d1 - this.lastValidSensors.d1),
          Math.abs(d2 - this.lastValidSensors.d2),
          Math.abs(d3 - this.lastValidSensors.d3),
          Math.abs(d4 - this.lastValidSensors.d4)
        );
        
        if (jump > this.outlierThreshold) {
          this.stats.invalidPackets++;
          return {
            status,
            sensors,
            deviceTime,
            packetNumber: this.packetCounter++,
            isValid: false,
            error: `Outlier detected: jump=${jump}`
          };
        }
      }

      // Сохраняем как последние валидные данные
      this.lastValidSensors = sensors;
      this.stats.validPackets++;

      return {
        status,
        sensors,
        deviceTime,
        packetNumber: this.packetCounter++,
        isValid: true
      };
    } catch (e) {
      this.stats.invalidPackets++;
      const error = e instanceof Error ? e.message : 'Decode error';
      this.stats.lastError = error;
      return this.createInvalidPacket(error);
    }
  }

  private createInvalidPacket(error: string): ParsedPacket {
    return {
      status: 0,
      sensors: { d1: 0, d2: 0, d3: 0, d4: 0 },
      deviceTime: 0,
      packetNumber: this.packetCounter++,
      isValid: false,
      error
    };
  }

  /**
   * Декодирование 4-байтного поля в 24-битное signed значение
   * Little-endian: младшие биты идут первыми
   */
  private decode4ByteField(bytes: Uint8Array, offset: number): number {
    let result = 0;

    // Little-endian: младшие 6 бит первыми
    for (let i = 0; i < 4; i++) {
      const charCode = bytes[offset + i];
      const decoded = PacketParser.decodeLUT[charCode] ?? 0;
      result |= (decoded << (i * 6));
    }

    // Преобразуем в signed 24-bit (two's complement)
    // Если бит 23 установлен - число отрицательное
    if (result >= 0x800000) {
      result -= 0x1000000;
    }

    return result;
  }

  private discardUntilTerminator(): void {
    const pos = this.buffer.indexOf(PACKET_TERMINATOR);
    if (pos !== -1) {
      this.buffer.skip(pos + 1);
    } else {
      this.buffer.skip(Math.floor(this.buffer.length / 2));
    }
  }

  getStats(): ParserStats {
    return { ...this.stats };
  }

  getSuccessRate(): number {
    if (this.stats.totalPackets === 0) return 1;
    return this.stats.validPackets / this.stats.totalPackets;
  }

  resetStats(): void {
    this.stats = this.createInitialStats();
  }

  clear(): void {
    this.buffer.clear();
    this.lastValidSensors = null;
  }
}