import { ByteRingBuffer } from './RingBuffer.js';
import type { SensorData, ParsedPacket, ParserStats } from './types.js';
import {
  PACKET_TERMINATOR,
  PACKET_LENGTH,
  MAX_BUFFER_SIZE,
} from './constants.js';

/**
 * Fixed-size wire frames: status + four signed 24-bit readings + time + '&'.
 * '&' is also a legal encoded payload byte, so delimiter-only framing is unsafe.
 * There is no checksum: corrupt bytes are rejected, never guessed or repaired.
 */
export class PacketParser {
  private buffer = new ByteRingBuffer(MAX_BUFFER_SIZE);
  private stats = this.createInitialStats();
  private packetCounter = 0;
  private lastSensors: SensorData | null = null;
  private filterOutliers: boolean;
  private outlierThreshold: number;
  private enableFastMode: boolean;
  private enableValueCaching: boolean;
  private cache = new Map<number, number>();
  private cacheHits = 0;
  private cacheReads = 0;
  private readonly maxCacheSize = 1000;

  constructor(
    options: {
      filterOutliers?: boolean;
      outlierThreshold?: number;
      enableFastMode?: boolean;
      /** Kept for compatibility; invented packet recovery is always disabled. */
      enablePacketRecovery?: boolean;
      enableValueCaching?: boolean;
      maxRecoveryAttempts?: number;
    } = {},
  ) {
    this.filterOutliers = options.filterOutliers ?? true;
    this.outlierThreshold = options.outlierThreshold ?? 50000;
    this.enableFastMode = options.enableFastMode ?? false;
    this.enableValueCaching = options.enableValueCaching ?? true;
  }

  private createInitialStats(): ParserStats {
    return {
      totalPackets: 0,
      validPackets: 0,
      invalidPackets: 0,
      bufferOverflows: 0,
      partialPackets: 0,
      lastError: null,
    };
  }

  setFastMode(enabled: boolean): void {
    this.enableFastMode = enabled;
  }
  setFilterOutliers(enabled: boolean): void {
    this.filterOutliers = enabled;
  }
  setOutlierThreshold(threshold: number): void {
    if (!Number.isFinite(threshold) || threshold < 0)
      throw new Error('Invalid outlier threshold');
    this.outlierThreshold = threshold;
  }

  addData(data: string | Uint8Array): void {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.length > this.buffer.available) {
      this.stats.bufferOverflows++;
      this.stats.lastError = 'Input buffer overflow; oldest bytes discarded';
      if (bytes.length >= MAX_BUFFER_SIZE) {
        this.buffer.clear();
        this.buffer.write(bytes.subarray(bytes.length - MAX_BUFFER_SIZE));
        return;
      }
      this.buffer.skip(bytes.length - this.buffer.available);
    }
    this.buffer.write(bytes);
  }

  parseAll(): ParsedPacket[] {
    const result: ParsedPacket[] = [];
    let packet: ParsedPacket | null;
    while ((packet = this.parseNext()) !== null) result.push(packet);
    return result;
  }

  parseNext(): ParsedPacket | null {
    if (this.buffer.length < PACKET_LENGTH) return null;
    const bytes = this.buffer.peek(0, PACKET_LENGTH)!;
    const error = this.validateFrame(bytes);
    this.stats.totalPackets++;
    if (error) {
      // Slide a byte at a time to retain a valid frame following noise or truncation.
      this.buffer.skip(1);
      this.stats.partialPackets++;
      return this.invalidPacket(error);
    }
    this.buffer.skip(PACKET_LENGTH);
    const sensors: SensorData = {
      d1: this.decodeField(bytes, 1),
      d2: this.decodeField(bytes, 5),
      d3: this.decodeField(bytes, 9),
      d4: this.decodeField(bytes, 13),
    };
    const packet: ParsedPacket = {
      status: bytes[0] - 35,
      sensors,
      deviceTime: this.decodeField(bytes, 17),
      packetNumber: this.packetCounter++,
      isValid: true,
    };
    if (this.filterOutliers && this.lastSensors) {
      const jump = Math.max(
        ...(['d1', 'd2', 'd3', 'd4'] as const).map((key) =>
          Math.abs(sensors[key] - this.lastSensors![key]),
        ),
      );
      if (jump > this.outlierThreshold) {
        packet.isValid = false;
        packet.error = `Outlier detected: jump=${jump}`;
        this.stats.invalidPackets++;
        this.stats.lastError = packet.error;
      }
    }
    // A sustained real load change must not lock the parser to its old baseline.
    this.lastSensors = sensors;
    if (packet.isValid) this.stats.validPackets++;
    return packet;
  }

  private validateFrame(bytes: Uint8Array): string | null {
    if (bytes[PACKET_LENGTH - 1] !== PACKET_TERMINATOR)
      return 'Invalid frame terminator';
    if (bytes[0] !== 35 && bytes[0] !== 36) return 'Invalid status byte';
    for (let i = 1; i < PACKET_LENGTH - 1; i++) {
      const byte = bytes[i];
      if (byte < 35 || byte > 99 || byte === 94)
        return `Invalid encoded byte at ${i}`;
    }
    return null;
  }

  private decodeField(bytes: Uint8Array, offset: number): number {
    const key =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    this.cacheReads++;
    if (this.enableValueCaching && this.cache.has(key)) {
      this.cacheHits++;
      return this.cache.get(key)!;
    }
    let result = 0;
    for (let i = 0; i < 4; i++) {
      const byte = bytes[offset + i];
      result |= (byte <= 93 ? byte - 35 : byte - 36) << (i * 6);
    }
    if (result >= 0x800000) result -= 0x1000000;
    if (this.enableValueCaching) {
      if (this.cache.size >= this.maxCacheSize)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, result);
    }
    return result;
  }

  private invalidPacket(error: string): ParsedPacket {
    this.stats.invalidPackets++;
    this.stats.lastError = error;
    return {
      status: 0,
      sensors: { d1: 0, d2: 0, d3: 0, d4: 0 },
      deviceTime: 0,
      packetNumber: this.packetCounter++,
      isValid: false,
      error,
    };
  }

  getStats(): ParserStats {
    return { ...this.stats };
  }
  getSuccessRate(): number {
    return this.stats.totalPackets
      ? this.stats.validPackets / this.stats.totalPackets
      : 1;
  }
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hitRate: this.cacheReads ? this.cacheHits / this.cacheReads : 0,
    };
  }
  getPerformanceInfo() {
    return {
      fastMode: this.enableFastMode,
      packetRecovery: false,
      valueCaching: this.enableValueCaching,
      cacheStats: this.getCacheStats(),
    };
  }
  resetStats(): void {
    this.stats = this.createInitialStats();
  }
  clear(): void {
    this.buffer.clear();
    this.lastSensors = null;
    this.packetCounter = 0;
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheReads = 0;
  }
}
