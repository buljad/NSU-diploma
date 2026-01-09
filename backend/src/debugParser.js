/**
 * ОТЛАДОЧНЫЙ ПАРСЕР СТАБИЛОМЕТРА
 * Цели:
 *  - корректно декодировать пакеты
 *  - проверить signed/unsigned
 *  - подобрать центр и масштаб (сырые → мм)
 *  - видеть реальный шум и разброс без нагрузки
 *
 * Формат пакета: #CCCC1CCCC2CCCC3CCCC4TTT#&
 *  C1..C4 – по 4 символа (24-бит значения)
 *  TTT    – 3 символа (время / счётчик)
 */

/**
 * Декодирование одного ASCII-символа в 6-битное значение (0–63)
 */
function decodeASCIIByte(charCode) {
  // В твоём протоколе используются символы от '#' (35) и выше.
  // Простейшая схема: 35 → 0, 36 → 1, ... 98 → 63
  // При необходимости эту таблицу можно уточнить, но сейчас она соответствует генератору.
  if (charCode >= 35 && charCode <= 98) {
    return charCode - 35;
  }
  return 0;
}

/**
 * Декодирование 4-символьного поля в 24-битное значение (0..16_777_215)
 */
function decode4ByteField(field) {
  if (field.length !== 4) {
    throw new Error(`Invalid 4-byte field length: ${field.length}, expected 4`);
  }

  let result = 0;
  for (let i = 0; i < 4; i++) {
    const charCode = field.charCodeAt(i);
    const decoded = decodeASCIIByte(charCode);
    result = result * 64 + decoded; // 6 бит на символ
  }
  return result; // UNSIGNED 24-bit
}

/**
 * Декодирование 3-символьного поля в 18-битное значение (0..262_143)
 */
function decode3ByteField(field) {
  if (field.length !== 3) {
    throw new Error(`Invalid 3-byte field length: ${field.length}, expected 3`);
  }

  let result = 0;
  for (let i = 0; i < 3; i++) {
    const charCode = field.charCodeAt(i);
    const decoded = decodeASCIIByte(charCode);
    result = result * 64 + decoded;
  }
  return result;
}

/**
 * Преобразование UNSIGNED 24-bit → SIGNED 24-bit (two's complement)
 */
function toSigned24(uint24) {
  // Диапазон unsigned: 0..0xFFFFFF (16_777_215)
  // Диапазон signed:  -8_388_608..+8_388_607
  if (uint24 & 0x800000) {
    // старший бит установлен → отрицательное число
    return uint24 - 0x1000000;
  }
  return uint24;
}

/**
 * Простая статистика для отладки
 */
class SimpleStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.count = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.sum = 0;
    this.sumSq = 0;
  }

  add(value) {
    this.count++;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    this.sum += value;
    this.sumSq += value * value;
  }

  get avg() {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  get range() {
    if (this.count === 0) return 0;
    return this.max - this.min;
  }

  get std() {
    if (this.count === 0) return 0;
    const mean = this.sum / this.count;
    const variance = this.sumSq / this.count - mean * mean;
    return Math.sqrt(Math.max(variance, 0));
  }

  export() {
    if (this.count === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, range: 0, std: 0 };
    }
    return {
      count: this.count,
      min: this.min,
      max: this.max,
      avg: this.avg,
      range: this.range,
      std: this.std,
    };
  }
}

/**
 * Анализатор для отладки: статистика по сырым и мм значениям
 */
class DebugAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = [];
    this.rawStats = {
      x: new SimpleStats(),
      y: new SimpleStats(),
      force: new SimpleStats(),
    };
    this.mmStats = {
      x: new SimpleStats(),
      y: new SimpleStats(),
      force: new SimpleStats(),
    };
  }

  addSample(sample) {
    // sample: { raw, signed, mm, timestamp, deviceTime, ... }
    this.samples.push(sample);

    this.rawStats.x.add(sample.signed.x);
    this.rawStats.y.add(sample.signed.y);
    this.rawStats.force.add(sample.raw.force);

    this.mmStats.x.add(sample.mm.x);
    this.mmStats.y.add(sample.mm.y);
    this.mmStats.force.add(sample.mm.force);

    // Ограничим память
    if (this.samples.length > 2000) {
      this.samples.shift();
    }
  }

  export() {
    return {
      count: this.samples.length,
      raw: {
        x: this.rawStats.x.export(),
        y: this.rawStats.y.export(),
        force: this.rawStats.force.export(),
      },
      mm: {
        x: this.mmStats.x.export(),
        y: this.mmStats.y.export(),
        force: this.mmStats.force.export(),
      },
    };
  }
}

/**
 * ОТЛАДОЧНЫЙ ПАРСЕР СТАБИЛОМЕТРА
 */
export class DebugStabilogramParser {
  constructor() {
    this.buffer = "";
    this.packetsProcessed = 0;
    this.errors = 0;

    // Центр и масштаб — настраиваемые параметры
    this.center = {
      x: 0,        // в сырых (signed)
      y: 0,
      force: 0,
    };

    // Масштаб: сколько сырых единиц приходится на 1 мм
    // Будем подбирать: 1000, 10000, 100000 и т.п.
    this.scaleRawToMm = 1000.0;

    this.analyzer = new DebugAnalyzer();

    // Логирование
    this.logLevel = "normal"; // 'minimal' | 'normal' | 'detailed'
    this.logEvery = 50;
  }

  setCenter(x, y, force = 0) {
    this.center.x = x;
    this.center.y = y;
    this.center.force = force;
  }

  setScale(rawPerMm) {
    this.scaleRawToMm = rawPerMm;
  }

  setLogLevel(level) {
    const valid = ["minimal", "normal", "detailed"];
    if (valid.includes(level)) {
      this.logLevel = level;
    }
  }

  /**
   * Добавление текстовых данных (из SerialPort или WebSocket)
   */
  addData(textChunk) {
    this.buffer += textChunk;
    const out = [];

    while (true) {
      const packet = this._extractPacket();
      if (!packet) break;

      try {
        const parsed = this._parsePacket(packet);
        if (parsed) {
          this.packetsProcessed++;
          this.analyzer.addSample(parsed);
          out.push(parsed);

          if (this._shouldLogPacket()) {
            this._logPacket(parsed);
          }

          if (this.packetsProcessed % 100 === 0) {
            this._logAnalysis();
          }
        }
      } catch (err) {
        this.errors++;
        if (this.logLevel !== "minimal") {
          console.error("❌ Parse error:", err.message);
        }
      }
    }

    // Буфер не разрастается
    if (this.buffer.length > 1000) {
      this.buffer = this.buffer.slice(-200);
    }

    return out;
  }

  _extractPacket() {
    const startIdx = this.buffer.indexOf("#");
    if (startIdx === -1) {
      this.buffer = "";
      return null;
    }

    if (startIdx > 0) {
      this.buffer = this.buffer.slice(startIdx);
    }

    // Ищем шаблон "#...#&"
    const endIdx = this.buffer.indexOf("#&", 1);
    if (endIdx === -1) {
      // Ждём, пока придут оставшиеся байты
      return null;
    }

    const packet = this.buffer.slice(0, endIdx + 2); // включительно "#&"
    this.buffer = this.buffer.slice(endIdx + 2);

    // Ожидаемый формат 22 байта, но для отладки позволим отличия и посмотрим
    if (packet.length !== 22) {
      if (this.logLevel === "detailed") {
        console.warn(`⚠️ Packet length ${packet.length} != 22: "${packet}"`);
      }
    }

    return packet;
  }

  _parsePacket(packet) {
    if (!packet.startsWith("#") || !packet.endsWith("#&")) {
      throw new Error("Invalid packet framing");
    }

    const dataSection = packet.slice(1, -2); // убираем '#' и '#&'
    if (dataSection.length !== 19) {
      // иногда будут мусорные/неполные — отладочно логируем
      if (this.logLevel === "detailed") {
        console.warn(`⚠️ Data section length ${dataSection.length} != 19`);
      }
      // попробуем всё равно, если хватает символов для полей
      if (dataSection.length < 19) return null;
    }

    const coord1Field = dataSection.slice(0, 4);
    const coord2Field = dataSection.slice(4, 8);
    const coord3Field = dataSection.slice(8, 12);
    const coord4Field = dataSection.slice(12, 16);
    const timeField   = dataSection.slice(16, 19);

    const c1 = decode4ByteField(coord1Field);
    const c2 = decode4ByteField(coord2Field);
    const c3 = decode4ByteField(coord3Field);
    const c4 = decode4ByteField(coord4Field);
    const deviceTime = decode3ByteField(timeField);

    // Интерпретация как signed 24-bit
    const signed = {
      x: toSigned24(c1),
      y: toSigned24(c2),
      force: c3,   // пока без знака
      extra: c4,
    };

    // Центрирование вокруг текущего центра
    const centered = {
      x: signed.x - this.center.x,
      y: signed.y - this.center.y,
      force: signed.force - this.center.force,
    };

    // Масштаб (сырые → мм)
    const mm = {
      x: centered.x / this.scaleRawToMm,
      y: centered.y / this.scaleRawToMm,
      force: centered.force / this.scaleRawToMm,
    };

    return {
      _rawPacket: packet,
      timestamp: Date.now(),
      deviceTime,
      raw: { x: c1, y: c2, force: c3, extra: c4 },
      signed,
      centered,
      mm,
      index: this.packetsProcessed,
    };
  }

  _shouldLogPacket() {
    if (this.logLevel === "minimal") {
      return this.packetsProcessed % (this.logEvery * 10) === 0;
    }
    if (this.logLevel === "normal") {
      return this.packetsProcessed % this.logEvery === 0;
    }
    return true; // detailed
  }

  _logPacket(p) {
    if (this.logLevel === "minimal") {
      console.log(
        `📦 #${this.packetsProcessed}: X=${p.mm.x.toFixed(2)}мм, Y=${p.mm.y.toFixed(2)}мм (raw X=${p.signed.x}, Y=${p.signed.y})`
      );
      return;
    }

    console.log("\n╔════════════════════════════════════════════╗");
    console.log(`║ 📊 PACKET #${this.packetsProcessed} [DEBUG]`);
    console.log("╟────────────────────────────────────────────╢");
    console.log(`║ 📦 RAW: ${p._rawPacket}`);
    console.log("╟────────────────────────────────────────────╢");
    console.log("║ 🔢 RAW UNSIGNED (0..16M):");
    console.log(`║   X: ${p.raw.x.toLocaleString()} counts`);
    console.log(`║   Y: ${p.raw.y.toLocaleString()} counts`);
    console.log(`║   F: ${p.raw.force.toLocaleString()} counts`);
    console.log(`║   E: ${p.raw.extra.toLocaleString()}`);
    console.log("╟────────────────────────────────────────────╢");
    console.log("║ 🔢 SIGNED 24-bit:");
    console.log(`║   X: ${p.signed.x.toLocaleString()} counts`);
    console.log(`║   Y: ${p.signed.y.toLocaleString()} counts`);
    console.log("╟────────────────────────────────────────────╢");
    console.log("║ 🎯 CENTERED (minus center):");
    console.log(`║   Xc: ${p.centered.x.toLocaleString()} counts`);
    console.log(`║   Yc: ${p.centered.y.toLocaleString()} counts`);
    console.log("╟────────────────────────────────────────────╢");
    console.log("║ 📏 MILLIMETERS (scaled):");
    console.log(`║   X: ${p.mm.x.toFixed(2)} mm`);
    console.log(`║   Y: ${p.mm.y.toFixed(2)} mm`);
    console.log(`║   F: ${p.mm.force.toFixed(2)} (условные)`);
    console.log("╚════════════════════════════════════════════╝");
  }

  _logAnalysis() {
    const stats = this.analyzer.export();

    console.log("\n┌─── DEBUG ANALYSIS ───────────────────────┐");
    console.log(`│ 📊 Samples: ${stats.count}`);
    console.log("│ RAW SIGNED X:");
    console.log(
      `│   min=${stats.raw.x.min.toFixed(0)}, max=${stats.raw.x.max.toFixed(
        0
      )}, avg=${stats.raw.x.avg.toFixed(0)}, std=${stats.raw.x.std.toFixed(0)}`
    );
    console.log("│ RAW SIGNED Y:");
    console.log(
      `│   min=${stats.raw.y.min.toFixed(0)}, max=${stats.raw.y.max.toFixed(
        0
      )}, avg=${stats.raw.y.avg.toFixed(0)}, std=${stats.raw.y.std.toFixed(0)}`
    );
    console.log("│ MM X:");
    console.log(
      `│   min=${stats.mm.x.min.toFixed(2)}, max=${stats.mm.x.max.toFixed(
        2
      )}, avg=${stats.mm.x.avg.toFixed(2)}, std=${stats.mm.x.std.toFixed(2)}`
    );
    console.log("│ MM Y:");
    console.log(
      `│   min=${stats.mm.y.min.toFixed(2)}, max=${stats.mm.y.max.toFixed(
        2
      )}, avg=${stats.mm.y.avg.toFixed(2)}, std=${stats.mm.y.std.toFixed(2)}`
    );
    console.log("└──────────────────────────────────────────┘\n");
  }

  /**
   * Получить текущую статистику для UI
   */
  getStats() {
    return {
      packetsProcessed: this.packetsProcessed,
      errors: this.errors,
      center: this.center,
      scaleRawToMm: this.scaleRawToMm,
      analysis: this.analyzer.export(),
      bufferSize: this.buffer.length,
    };
  }

  clearBuffer() {
    this.buffer = "";
  }

  resetAnalyzer() {
    this.analyzer.reset();
  }
}

/**
 * Утилита: разовый парсинг строки-пакета (для тестов)
 */
export function debugParsePacketOnce(packet) {
  const parser = new DebugStabilogramParser();
  parser.setLogLevel("detailed");
  const packets = parser.addData(packet);
  return packets[0] || null;
}

export default {
  DebugStabilogramParser,
  debugParsePacketOnce,
};
