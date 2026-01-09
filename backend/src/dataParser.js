/**
 * ИСПРАВЛЕННЫЙ парсер данных стабилометра для РЕАЛЬНЫХ данных
 * Формат пакета Arduino: STATUS(1) + COORD1(4) + COORD2(4) + COORD3(4) + COORD4(4) + TIME(4) + '&'(1) = 22 байта
 */

/**
 * ПРАВИЛЬНОЕ декодирование ASCII-символа в 6-битное значение
 */
function decodeASCIIByte(charCode) {
  if (charCode >= 35 && charCode <= 93) {
    return charCode - 35;  // Значения 0-58
  }
  if (charCode >= 95 && charCode <= 99) {
    return charCode - 36;  // Значения 59-63 (пропуск ASCII 94)
  }
  
  // Отладка: логируем неожиданные символы
  if (charCode !== 38 && charCode !== 13 && charCode !== 10) { // 38='&', 13/10=CR/LF
    console.warn(`⚠️ Unexpected ASCII: ${charCode} (${String.fromCharCode(charCode)})`);
  }
  return 0;
}

/**
 * Декодирование 4-байтного поля в 24-битное значение  
 */
function decode4ByteField(field) {
  if (field.length !== 4) {
    throw new Error(`Invalid field length: ${field.length}, expected 4`);
  }
  
  let result = 0;
  // Arduino записывает младшие биты первыми
  for (let i = 0; i < 4; i++) {
    const charCode = field.charCodeAt(i);
    const decodedValue = decodeASCIIByte(charCode);
    result |= (decodedValue << (i * 6));  // Собираем по 6 бит
  }
  
  // Преобразуем в знаковое значение (24-битное)
  if (result >= 0x800000) {
    result -= 0x1000000;
  }
  
  return result;
}

/**
 * Класс для статистического анализа данных
 */
class DataAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = [];
    this.calibration = null;
    this.rawStats = {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
      minF: Infinity, maxF: -Infinity
    };
    console.log('🔄 Analyzer reset - ready for new data');
  }

  addSample(coordinates) {
    const sample = {
      ...coordinates,
      timestamp: Date.now()
    };
    
    this.samples.push(sample);
    
    // Обновляем статистику в реальном времени
    const raw = sample.raw;
    this.rawStats.minX = Math.min(this.rawStats.minX, raw.x);
    this.rawStats.maxX = Math.max(this.rawStats.maxX, raw.x);
    this.rawStats.minY = Math.min(this.rawStats.minY, raw.y);
    this.rawStats.maxY = Math.max(this.rawStats.maxY, raw.y);
    this.rawStats.minZ = Math.min(this.rawStats.minZ, raw.z);
    this.rawStats.maxZ = Math.max(this.rawStats.maxZ, raw.z);
    this.rawStats.minF = Math.min(this.rawStats.minF, raw.f);
    this.rawStats.maxF = Math.max(this.rawStats.maxF, raw.f);
    
    // Автоматически предлагаем калибровку каждые 50 образцов
    if (this.samples.length > 0 && this.samples.length % 50 === 0) {
      const stability = this.analyzeStability(30);
      if (stability.stable && !this.calibration) {
        console.log(`📊 [${this.samples.length} samples] Data appears stable - consider calibration`);
        console.log(`   StdX: ${stability.stdX}, StdY: ${stability.stdY} (threshold: ${stability.threshold})`);
      }
    }
  }

  analyzeStability(windowSize = 30) {
    if (this.samples.length < windowSize) {
      return {
        stable: false,
        reason: 'Insufficient data',
        sampleCount: this.samples.length,
        required: windowSize
      };
    }

    const recent = this.samples.slice(-windowSize);
    
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const sample of recent) {
      sumX += sample.centered_raw.x;
      sumY += sample.centered_raw.y;
      sumZ += sample.centered_raw.z;
    }
    
    const avgX = sumX / windowSize;
    const avgY = sumY / windowSize;
    const avgZ = sumZ / windowSize;
    
    let sumSqX = 0, sumSqY = 0, sumSqZ = 0;
    for (const sample of recent) {
      const dx = sample.centered_raw.x - avgX;
      const dy = sample.centered_raw.y - avgY;
      const dz = sample.centered_raw.z - avgZ;
      sumSqX += dx * dx;
      sumSqY += dy * dy; 
      sumSqZ += dz * dz;
    }

    const stdX = Math.sqrt(sumSqX / windowSize);
    const stdY = Math.sqrt(sumSqY / windowSize);
    const stdZ = Math.sqrt(sumSqZ / windowSize);
    
    // Адаптивный порог на основе диапазона данных
    const rangeX = this.rawStats.maxX - this.rawStats.minX;
    const rangeY = this.rawStats.maxY - this.rawStats.minY;
    const maxRange = Math.max(rangeX, rangeY);
    const threshold = Math.max(1000, maxRange * 0.002); // 0.2% от диапазона или минимум 1000
    
    const stable = stdX < threshold && stdY < threshold && stdZ < threshold;

    return {
      stable,
      stdX: Math.round(stdX),
      stdY: Math.round(stdY),
      stdZ: Math.round(stdZ),
      threshold: Math.round(threshold),
      reason: stable ? 'Stable' : 'High variation'
    };
  }

  calibrateZero() {
    const stability = this.analyzeStability(20); // Уменьшено для быстрой калибровки

    if (!stability.stable) {
      return {
        success: false,
        message: `Calibration failed: ${stability.reason}`,
        stability
      };
    }

    const calibSamples = this.samples.slice(-20);
    let sumX = 0, sumY = 0, sumZ = 0, sumF = 0;

    for (const sample of calibSamples) {
      sumX += sample.raw.x;
      sumY += sample.raw.y;
      sumZ += sample.raw.z;
      sumF += sample.raw.f;
    }

    this.calibration = {
      centerX: Math.round(sumX / calibSamples.length),
      centerY: Math.round(sumY / calibSamples.length),
      centerZ: Math.round(sumZ / calibSamples.length),
      centerF: Math.round(sumF / calibSamples.length),
      sampleCount: calibSamples.length,
      timestamp: Date.now()
    };

    console.log(`✅ Auto-calibration successful: X=${this.calibration.centerX}, Y=${this.calibration.centerY}`);

    return {
      success: true,
      message: 'Zero calibration successful',
      calibration: this.calibration,
      stability
    };
  }

  getStatistics() {
    if (this.samples.length === 0) {
      return { samples: 0 };
    }

    return {
      samples: this.samples.length,
      rawRanges: {
        x: { min: this.rawStats.minX, max: this.rawStats.maxX, range: this.rawStats.maxX - this.rawStats.minX },
        y: { min: this.rawStats.minY, max: this.rawStats.maxY, range: this.rawStats.maxY - this.rawStats.minY },
        z: { min: this.rawStats.minZ, max: this.rawStats.maxZ, range: this.rawStats.maxZ - this.rawStats.minZ },
        f: { min: this.rawStats.minF, max: this.rawStats.maxF, range: this.rawStats.maxF - this.rawStats.minF }
      },
      calibrated: this.calibration
    };
  }

  exportData() {
    return {
      samples: this.samples,
      statistics: this.getStatistics(),
      calibration: this.calibration,
      stability: this.analyzeStability()
    };
  }
}

/**
 * Основной парсер стабилометра
 */
export class StabilogramParser {
  constructor() {
    this.buffer = '';
    this.packetsProcessed = 0;
    this.errorsCount = 0;
    this.analyzer = new DataAnalyzer();
    
    this.mode = 'normal';
    this.logLevel = 'minimal';
    this.logInterval = 20;
    
    this.calibration = {
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      centerF: 0,
      applied: false
    };

    // Начальный масштаб - подберется автоматически
    this.SCALE_RAW_TO_MM = 100.0;
    
    console.log(`🔧 Инициализирован ИСПРАВЛЕННЫЙ парсер для реальных данных`);
    console.log(`📏 Начальный масштаб: ${this.SCALE_RAW_TO_MM}`);
  }

  setMode(mode) {
    const validModes = ['normal', 'calibration', 'test'];
    if (validModes.includes(mode)) {
      this.mode = mode;
      if (mode === 'calibration') {
        this.analyzer.reset();
      }
      console.log(`📋 Parser mode: ${mode.toUpperCase()}`);
    }
  }

  setLogLevel(level) {
    const validLevels = ['minimal', 'normal', 'detailed'];
    if (validLevels.includes(level)) {
      this.logLevel = level;
      console.log(`📋 Log level: ${level.toUpperCase()}`);
    }
  }

  setScaleFactor(factor) {
    if (factor > 0) {
      this.SCALE_RAW_TO_MM = factor;
      console.log(`🔧 Масштабирующий коэффициент: ${factor}`);
    }
  }

  addData(data) {
    this.buffer += data;
    const packets = [];

    // Очистка буфера от мусора (символы перевода строки, etc.)
    this.buffer = this.buffer.replace(/[\r\n]/g, '');

    let extractedCount = 0;
    while (extractedCount < 10) { // Защита от бесконечного цикла
      const packet = this.extractPacket();
      if (!packet) break;
      packets.push(packet);
      extractedCount++;
    }

    // Ограничиваем размер буфера
    if (this.buffer.length > 500) {
      console.warn(`⚠️ Buffer overflow (${this.buffer.length} bytes), keeping last 100`);
      this.buffer = this.buffer.slice(-100);
    }

    return packets;
  }

  extractPacket() {
    // Ищем символ '&' (конец пакета)
    const endIdx = this.buffer.indexOf('&');
    if (endIdx === -1) {
      return null; // Пакет не завершен
    }

    // Пакет должен быть ровно 22 байта (21 данных + '&')
    const packetStart = endIdx - 21;
    if (packetStart < 0) {
      // Недостаточно данных перед '&' - это мусор, удаляем
      console.warn(`⚠️ Incomplete packet before '&' at position ${endIdx}, removing garbage`);
      this.buffer = this.buffer.slice(endIdx + 1);
      return null;
    }

    const candidatePacket = this.buffer.slice(packetStart, endIdx + 1);
    this.buffer = this.buffer.slice(endIdx + 1);

    // Проверяем длину
    if (candidatePacket.length !== 22) {
      console.warn(`⚠️ Invalid packet length: ${candidatePacket.length}, expected 22`);
      console.warn(`   Packet: "${candidatePacket}"`);
      console.warn(`   HEX: ${Buffer.from(candidatePacket).toString('hex')}`);
      return null;
    }

    try {
      const parsed = this.parsePacket(candidatePacket);
      if (parsed) {
        this.packetsProcessed++;
        this.analyzer.addSample(parsed);
        
        // Автоматическая калибровка при стабильных данных
        if (this.packetsProcessed > 30 && this.packetsProcessed % 30 === 0 && !this.calibration.applied) {
          const autoCalibResult = this.performZeroCalibration();
          if (autoCalibResult.success) {
            console.log('🎯 Автоматическая калибровка выполнена успешно!');
          }
        }
        
        if (this.shouldLog()) {
          this.logPacket(parsed);
        }
        
        return parsed;
      }
    } catch (error) {
      this.errorsCount++;
      console.error(`❌ Parse error: ${error.message}`);
      console.error(`   Packet: "${candidatePacket}"`);
      console.error(`   HEX: ${Buffer.from(candidatePacket).toString('hex')}`);
      console.error(`   Buffer before: "${this.buffer.slice(0, 50)}..."`);
    }
    
    return null;
  }

  parsePacket(packet) {
    if (!packet.endsWith('&') || packet.length !== 22) {
      throw new Error(`Invalid packet format: length=${packet.length}, ends with '&': ${packet.endsWith('&')}`);
    }

    // Убираем '&' в конце
    const dataSection = packet.slice(0, -1); // 21 байт данных
    
    // Разбираем: STATUS(1) + COORD1(4) + COORD2(4) + COORD3(4) + COORD4(4) + TIME(4)
    const statusByte = dataSection.slice(0, 1);
    const coord1Field = dataSection.slice(1, 5);    // X
    const coord2Field = dataSection.slice(5, 9);    // Y  
    const coord3Field = dataSection.slice(9, 13);   // Z
    const coord4Field = dataSection.slice(13, 17);  // F
    const timeField = dataSection.slice(17, 21);    // Time

    // Декодируем статус
    const status = decodeASCIIByte(statusByte.charCodeAt(0));

    // Декодируем координаты
    const raw = {
      x: decode4ByteField(coord1Field),
      y: decode4ByteField(coord2Field),
      z: decode4ByteField(coord3Field),
      f: decode4ByteField(coord4Field)
    };

    const deviceTime = decode4ByteField(timeField);

    // Центрируем относительно калибровки
    const centered_raw = {
      x: raw.x - this.calibration.centerX,
      y: raw.y - this.calibration.centerY,
      z: raw.z - this.calibration.centerZ,
      f: raw.f - this.calibration.centerF
    };

    // Масштабируем в миллиметры
    const mm = {
      x: centered_raw.x / this.SCALE_RAW_TO_MM,
      y: centered_raw.y / this.SCALE_RAW_TO_MM,
      z: centered_raw.z / this.SCALE_RAW_TO_MM,
      f: centered_raw.f / this.SCALE_RAW_TO_MM
    };

    return {
      raw,
      centered_raw,
      mm,
      status,
      deviceTime,
      packetNumber: this.packetsProcessed,
      timestamp: Date.now(),
      _raw_packet: packet
    };
  }

  shouldLog() {
    if (this.logLevel === 'minimal') {
      return this.packetsProcessed % (this.logInterval * 2) === 0;
    }
    if (this.logLevel === 'normal') {
      return this.packetsProcessed % this.logInterval === 0;
    }
    return true;
  }

  logPacket(parsed) {
    if (this.logLevel === 'minimal') {
      console.log(
        `📦 #${this.packetsProcessed}: ` +
        `X=${parsed.mm.x.toFixed(2)}мм, Y=${parsed.mm.y.toFixed(2)}мм, ` +
        `Z=${parsed.mm.z.toFixed(2)}мм [S=${parsed.status}, T=${parsed.deviceTime}] ` +
        `Raw=(${parsed.raw.x}, ${parsed.raw.y}, ${parsed.raw.z})`
      );
      return;
    }

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log(`║ 📊 PACKET #${this.packetsProcessed.toString().padStart(4)} [Status: ${parsed.status}]`);
    console.log('╟──────────────────────────────────────────────╢');
    console.log(`║ 📦 RAW: ${parsed._raw_packet}`);
    console.log(`║ 🔍 HEX: ${Buffer.from(parsed._raw_packet).toString('hex').toUpperCase()}`);
    console.log('╟──────────────────────────────────────────────╢');
    console.log('║ 🔢 RAW VALUES:');
    console.log(`║   X: ${parsed.raw.x.toString().padStart(8)}`);
    console.log(`║   Y: ${parsed.raw.y.toString().padStart(8)}`);
    console.log(`║   Z: ${parsed.raw.z.toString().padStart(8)}`);
    console.log(`║   F: ${parsed.raw.f.toString().padStart(8)}`);
    console.log(`║   Time: ${parsed.deviceTime}`);
    console.log('╟──────────────────────────────────────────────╢');
    console.log('║ 🎯 CENTERED:');
    console.log(`║   X: ${parsed.centered_raw.x.toString().padStart(8)}`);
    console.log(`║   Y: ${parsed.centered_raw.y.toString().padStart(8)}`);
    console.log(`║   Z: ${parsed.centered_raw.z.toString().padStart(8)}`);
    console.log(`║   F: ${parsed.centered_raw.f.toString().padStart(8)}`);
    console.log('╟──────────────────────────────────────────────╢');
    console.log('║ 📏 MILLIMETERS:');
    console.log(`║   X: ${parsed.mm.x.toFixed(3).padStart(8)} мм`);
    console.log(`║   Y: ${parsed.mm.y.toFixed(3).padStart(8)} мм`);
    console.log(`║   Z: ${parsed.mm.z.toFixed(3).padStart(8)} мм`);
    console.log(`║   F: ${parsed.mm.f.toFixed(3).padStart(8)} мм`);
    console.log('╚══════════════════════════════════════════════╝');

    if (this.packetsProcessed % 50 === 0) {
      this.logAnalysisStatus();
    }
  }

  logAnalysisStatus() {
    const stats = this.analyzer.getStatistics();
    const stability = this.analyzer.analyzeStability();

    console.log('\n┌─── ANALYSIS STATUS ──────────────────────┐');
    console.log(`│ 📊 Packets: ${this.packetsProcessed}, Errors: ${this.errorsCount}`);
    console.log(`│ 📈 Success rate: ${((this.packetsProcessed / (this.packetsProcessed + this.errorsCount)) * 100).toFixed(1)}%`);
    
    if (stats.rawRanges) {
      console.log(`│ 📊 RAW RANGES:`);
      console.log(`│   X: ${stats.rawRanges.x.min} to ${stats.rawRanges.x.max} (range: ${stats.rawRanges.x.range})`);
      console.log(`│   Y: ${stats.rawRanges.y.min} to ${stats.rawRanges.y.max} (range: ${stats.rawRanges.y.range})`);
      console.log(`│   Z: ${stats.rawRanges.z.min} to ${stats.rawRanges.z.max} (range: ${stats.rawRanges.z.range})`);
      console.log(`│   F: ${stats.rawRanges.f.min} to ${stats.rawRanges.f.max} (range: ${stats.rawRanges.f.range})`);
      
      // Автоматическая оценка масштаба
      const maxRange = Math.max(stats.rawRanges.x.range, stats.rawRanges.y.range);
      if (maxRange > 0) {
        const suggestedScale = maxRange / 200; // Предполагаем ±100мм = 200мм диапазон
        console.log(`│ 🔧 Suggested scale: ${Math.round(suggestedScale)} (current: ${this.SCALE_RAW_TO_MM})`);
        
        // Автоматически обновляем масштаб если отличается значительно
        if (Math.abs(suggestedScale - this.SCALE_RAW_TO_MM) > this.SCALE_RAW_TO_MM * 0.5) {
          const newScale = Math.round(suggestedScale);
          console.log(`🔄 Auto-updating scale to: ${newScale}`);
          this.SCALE_RAW_TO_MM = newScale;
        }
      }
    }
    
    console.log(`│ 🎯 STABILITY: ${stability.stable ? '✅' : '❌'} (${stability.reason})`);
    console.log(`│   Std X/Y/Z: ${stability.stdX}/${stability.stdY}/${stability.stdZ}`);
    
    if (this.analyzer.calibration) {
      const cal = this.analyzer.calibration;
      console.log(`│ 🔧 CALIBRATED: ✅ (${cal.sampleCount} samples)`);
      console.log(`│   Center: X=${cal.centerX}, Y=${cal.centerY}`);
    } else {
      console.log(`│ 🔧 CALIBRATION: ❌ NOT APPLIED`);
    }
    console.log('└──────────────────────────────────────────┘\n');
  }

  performZeroCalibration() {
    console.log('\n🎯 PERFORMING ZERO CALIBRATION...');

    const result = this.analyzer.calibrateZero();

    if (result.success) {
      console.log('✅ CALIBRATION SUCCESSFUL!');
      console.log(`   Center X: ${result.calibration.centerX}`);
      console.log(`   Center Y: ${result.calibration.centerY}`);
      console.log(`   Center Z: ${result.calibration.centerZ}`);
      console.log(`   Center F: ${result.calibration.centerF}`);
      console.log(`   Samples: ${result.calibration.sampleCount}`);

      // Применяем к парсеру
      this.calibration = {
        centerX: result.calibration.centerX,
        centerY: result.calibration.centerY,
        centerZ: result.calibration.centerZ,
        centerF: result.calibration.centerF,
        applied: true
      };

      console.log('✅ Calibration applied to parser\n');
    } else {
      console.log('❌ CALIBRATION FAILED!');
      console.log(`   Reason: ${result.message}`);
      console.log(`   Stability: ${result.stability.reason}\n`);
    }

    return result;
  }

  getFullAnalysis() {
    return this.analyzer.exportData();
  }

  resetAnalyzer() {
    this.analyzer.reset();
    this.calibration.applied = false;
    console.log('🔄 Analyzer reset');
  }

  getStats() {
    return {
      mode: this.mode,
      logLevel: this.logLevel,
      scaleFactor: this.SCALE_RAW_TO_MM,
      buffer: {
        size: this.buffer.length,
        content: this.buffer.length > 0 ? `"${this.buffer.slice(0, 50)}..."` : 'empty'
      },
      packets: {
        processed: this.packetsProcessed,
        errors: this.errorsCount,
        successRate: this.packetsProcessed > 0 ? ((this.packetsProcessed / (this.packetsProcessed + this.errorsCount)) * 100).toFixed(1) + '%' : '0%'
      },
      analyzer: this.analyzer.getStatistics(),
      calibration: this.calibration
    };
  }
}

/**
 * Экспорт
 */
export default {
  StabilogramParser,
  DataAnalyzer
};