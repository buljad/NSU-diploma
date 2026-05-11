// packages/shared/src/CoPSmartFilter.ts

/**
 * Медианный фильтр центра давления (CoP) v2.3+
 *
 * ✅ НАЗНАЧЕНИЕ:
 * - Фильтрация аппаратных выбросов в реальном времени (<1ms задержка)
 * - Детекция и реанимация замираний точки
 * - Адаптивное сглаживание для резких, но валидных движений
 *
 * ✅ КРИТИЧЕСКИЕ УЛУЧШЕНИЯ для резких движений:
 * - Раздельные пороги для плавных (20мм) и резких (60мм) движений
 * - Адаптивное сглаживание вместо жесткого ограничения
 * - Сохранение 70% амплитуды резких движений (было 30%)
 * - Доверие к быстрым движениям пациента
 */

export interface FilteredCoP {
  x: number;
  y: number;
  wasFiltered: boolean;
  confidence: number; // 0-1, уверенность в данных
  filterType?: string; // Тип примененной фильтрации
}

export interface SmartFilterConfig {
  bufferSize: number;
  maxJumpMm: number;
  frozenThreshold: number;
  epsilon: number;

  // ✅ НОВЫЕ ПАРАМЕТРЫ для резких движений
  gentleJumpMm: number; // Порог плавных движений (20мм)
  sharpJumpMm: number; // Порог резких движений (60мм)
  extremeJumpMm: number; // Порог экстремальных выбросов (100мм)

  gentleSmoothFactor: number; // Сглаживание плавных движений (0.2)
  sharpSmoothFactor: number; // Сглаживание резких движений (0.6)
  extremeSmoothFactor: number; // Сглаживание выбросов (0.3)

  adaptiveSmoothing: boolean; // Включить адаптивное сглаживание
  velocityAware: boolean; // Учитывать скорость движения
  enableReanimation: boolean; // Реанимация замираний
}

export interface FilterStats {
  totalSamples: number;
  filteredSamples: number;
  gentleMovements: number;
  sharpMovements: number;
  extremeOutliers: number;
  frozenDetections: number;
  averageConfidence: number;
}

export class CoPSmartFilter {
  private bufferX: number[] = [];
  private bufferY: number[] = [];
  private head = 0;
  private isBufferFull = false;

  private lastX = 0;
  private lastY = 0;
  private lastVelocityX = 0;
  private lastVelocityY = 0;
  private lastTimestamp = 0;

  private frozenCount = 0;
  private stats: FilterStats;

  private config: SmartFilterConfig = {
    bufferSize: 5,
    maxJumpMm: 40,
    frozenThreshold: 10,
    epsilon: 0.05,

    // ✅ КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ для резких движений пациента:
    gentleJumpMm: 30, // Было 20mm → стало 30mm
    sharpJumpMm: 120, // ✅ БЫЛО 60mm → стало 120mm (КЛЮЧЕВОЕ!)
    extremeJumpMm: 200, // Было 100mm → стало 200mm

    gentleSmoothFactor: 0.1, // Было 0.2 → стало 0.1 (меньше фильтрации)
    sharpSmoothFactor: 0.3, // ✅ БЫЛО 0.6 → стало 0.3 (70% сохраняем!)
    extremeSmoothFactor: 0.7, // Было 0.8 → стало 0.7

    adaptiveSmoothing: true,
    velocityAware: true,
    enableReanimation: true,
  };

  constructor(config?: Partial<SmartFilterConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.initializeBuffers();
    this.stats = this.createInitialStats();

    console.log("🎯 CoPSmartFilter initialized with adaptive smoothing:", {
      gentle: `${this.config.gentleJumpMm}mm → ${((1 - this.config.gentleSmoothFactor) * 100).toFixed(0)}%`,
      sharp: `${this.config.sharpJumpMm}mm → ${((1 - this.config.sharpSmoothFactor) * 100).toFixed(0)}%`,
      extreme: `${this.config.extremeJumpMm}mm → ${((1 - this.config.extremeSmoothFactor) * 100).toFixed(0)}%`,
    });
  }

  private createInitialStats(): FilterStats {
    return {
      totalSamples: 0,
      filteredSamples: 0,
      gentleMovements: 0,
      sharpMovements: 0,
      extremeOutliers: 0,
      frozenDetections: 0,
      averageConfidence: 1.0,
    };
  }

  private initializeBuffers(): void {
    this.bufferX = new Array(this.config.bufferSize).fill(0);
    this.bufferY = new Array(this.config.bufferSize).fill(0);
    this.head = 0;
    this.isBufferFull = false;
  }

  /**
   * Основной метод фильтрации
   */
  filter(
    input: { x: number; y: number; z?: number; f?: number },
    timestamp: number,
  ): FilteredCoP {
    this.stats.totalSamples++;

    // ✅ ИНИЦИАЛИЗАЦИЯ: Первый вызов
    if (this.stats.totalSamples === 1) {
      this.initializeWithFirstSample(input.x, input.y, timestamp);
      return {
        x: input.x,
        y: input.y,
        wasFiltered: false,
        confidence: 1.0,
        filterType: "initialization",
      };
    }

    // ✅ ШАГ 1: Вычисляем характеристики движения
    const dt =
      timestamp > this.lastTimestamp
        ? (timestamp - this.lastTimestamp) / 1000
        : 0.02;
    const jumpDistance = Math.sqrt(
      Math.pow(input.x - this.lastX, 2) + Math.pow(input.y - this.lastY, 2),
    );

    // ✅ ШАГ 2: Оценка скорости (если включена)
    let currentVelocity = 0;
    if (this.config.velocityAware && dt > 0.001 && dt < 0.5) {
      currentVelocity = jumpDistance / dt;
    }

    // ✅ ШАГ 3: Добавляем в кольцевой буфер
    this.addToBuffer(input.x, input.y);

    // ✅ ШАГ 4: Определяем тип движения и применяем соответствующую фильтрацию
    const filterResult = this.applyAdaptiveFilter(
      input,
      jumpDistance,
      currentVelocity,
    );

    // ✅ ШАГ 5: Детекция замирания
    if (this.config.enableReanimation) {
      this.detectAndHandleFreezing(filterResult);
    }

    // ✅ ШАГ 6: Обновляем состояние
    this.updateState(filterResult, timestamp);

    // ✅ ШАГ 7: Обновляем статистику
    this.updateStats(filterResult);

    return filterResult;
  }

  private initializeWithFirstSample(
    x: number,
    y: number,
    timestamp: number,
  ): void {
    this.bufferX.fill(x);
    this.bufferY.fill(y);
    this.lastX = x;
    this.lastY = y;
    this.lastTimestamp = timestamp;
    this.frozenCount = 0;
  }

  private addToBuffer(x: number, y: number): void {
    this.bufferX[this.head] = x;
    this.bufferY[this.head] = y;
    this.head = (this.head + 1) % this.config.bufferSize;

    if (!this.isBufferFull && this.head === 0) {
      this.isBufferFull = true;
    }
  }

  private applyAdaptiveFilter(
    input: { x: number; y: number },
    jumpDistance: number,
    velocity: number,
  ): FilteredCoP {
    // ✅ КЛАССИФИКАЦИЯ ДВИЖЕНИЯ
    let movementType: "gentle" | "sharp" | "extreme";
    let smoothFactor: number;
    let confidence: number;

    if (jumpDistance <= this.config.gentleJumpMm) {
      // 🟢 ПЛАВНОЕ ДВИЖЕНИЕ (0-20мм)
      movementType = "gentle";
      smoothFactor = this.config.gentleSmoothFactor;
      confidence = 1.0;
      this.stats.gentleMovements++;
    } else if (jumpDistance <= this.config.sharpJumpMm) {
      // 🟡 РЕЗКОЕ ДВИЖЕНИЕ (20-60мм) - КЛЮЧЕВАЯ ЗОНА ПРОБЛЕМЫ
      movementType = "sharp";

      if (this.config.adaptiveSmoothing) {
        // ✅ АДАПТИВНОЕ СГЛАЖИВАНИЕ: Больше сглаживания для больших скачков
        const sharpnessRatio =
          (jumpDistance - this.config.gentleJumpMm) /
          (this.config.sharpJumpMm - this.config.gentleJumpMm);

        smoothFactor =
          this.config.gentleSmoothFactor +
          (this.config.sharpSmoothFactor - this.config.gentleSmoothFactor) *
            sharpnessRatio;
      } else {
        smoothFactor = this.config.sharpSmoothFactor;
      }

      confidence = 0.8;
      this.stats.sharpMovements++;
    } else {
      // 🔴 ЭКСТРЕМАЛЬНЫЙ ВЫБРОС (>60мм)
      movementType = "extreme";
      smoothFactor = this.config.extremeSmoothFactor;
      confidence = 0.3;
      this.stats.extremeOutliers++;
    }

    // ✅ ПРИМЕНЯЕМ ФИЛЬТРАЦИЮ
    if (movementType === "gentle") {
      // Плавные движения почти не фильтруем
      return {
        x: input.x,
        y: input.y,
        wasFiltered: false,
        confidence,
        filterType: movementType,
      };
    } else {
      // Резкие и экстремальные движения фильтруем через медиану
      const medianX = this.getMedianFromBuffer(this.bufferX);
      const medianY = this.getMedianFromBuffer(this.bufferY);

      const filteredX =
        this.lastX + (medianX - this.lastX) * (1 - smoothFactor);
      const filteredY =
        this.lastY + (medianY - this.lastY) * (1 - smoothFactor);

      return {
        x: filteredX,
        y: filteredY,
        wasFiltered: true,
        confidence,
        filterType: `${movementType} (${jumpDistance.toFixed(1)}mm → ${((1 - smoothFactor) * 100).toFixed(0)}%)`,
      };
    }
  }

  private detectAndHandleFreezing(result: FilteredCoP): void {
    const distance = Math.sqrt(
      Math.pow(result.x - this.lastX, 2) + Math.pow(result.y - this.lastY, 2),
    );

    if (distance < this.config.epsilon) {
      this.frozenCount++;
    } else {
      this.frozenCount = 0;
    }

    // ✅ РЕАНИМАЦИЯ ЗАМИРАНИЯ
    if (this.frozenCount >= this.config.frozenThreshold) {
      const noise = 0.1;
      result.x += (Math.random() - 0.5) * noise;
      result.y += (Math.random() - 0.5) * noise;
      result.wasFiltered = true;
      result.confidence = Math.min(result.confidence, 0.9);
      result.filterType = `frozen-reanimation (${this.frozenCount})`;
      this.stats.frozenDetections++;
    }
  }

  private updateState(result: FilteredCoP, timestamp: number): void {
    this.lastX = result.x;
    this.lastY = result.y;
    this.lastTimestamp = timestamp;
  }

  private updateStats(result: FilteredCoP): void {
    if (result.wasFiltered) {
      this.stats.filteredSamples++;
    }

    // Скользящее среднее для confidence
    const alpha = 0.05; // Медленное обновление
    this.stats.averageConfidence =
      this.stats.averageConfidence * (1 - alpha) + result.confidence * alpha;
  }

  private getMedianFromBuffer(buffer: number[]): number {
    const effectiveSize = this.isBufferFull
      ? this.config.bufferSize
      : this.head;
    const values = buffer.slice(0, effectiveSize);

    values.sort((a, b) => a - b);

    const mid = Math.floor(values.length / 2);
    return values.length % 2
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;
  }

  // ✅ ПУБЛИЧНЫЕ МЕТОДЫ УПРАВЛЕНИЯ

  updateConfig(newConfig: Partial<SmartFilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log("🎯 CoPSmartFilter config updated:", newConfig);
  }

  reset(): void {
    this.initializeBuffers();
    this.lastX = 0;
    this.lastY = 0;
    this.lastVelocityX = 0;
    this.lastVelocityY = 0;
    this.lastTimestamp = 0;
    this.frozenCount = 0;
    this.stats = this.createInitialStats();
    console.log("🔄 CoPSmartFilter reset");
  }

  // ✅ ДИАГНОСТИКА И МОНИТОРИНГ

  getStats(): FilterStats {
    return { ...this.stats };
  }

  getConfig(): SmartFilterConfig {
    return { ...this.config };
  }

  getCurrentState(): {
    lastPosition: { x: number; y: number };
    frozenCount: number;
    bufferSize: number;
    isBufferFull: boolean;
  } {
    return {
      lastPosition: { x: this.lastX, y: this.lastY },
      frozenCount: this.frozenCount,
      bufferSize: this.config.bufferSize,
      isBufferFull: this.isBufferFull,
    };
  }

  getPerformanceStats(): {
    filterRate: number; // % отфильтрованных пакетов
    averageConfidence: number; // Средняя уверенность
    movementDistribution: {
      // Распределение типов движений
      gentle: number;
      sharp: number;
      extreme: number;
    };
  } {
    const total = this.stats.totalSamples || 1;

    return {
      filterRate: (this.stats.filteredSamples / total) * 100,
      averageConfidence: this.stats.averageConfidence,
      movementDistribution: {
        gentle: (this.stats.gentleMovements / total) * 100,
        sharp: (this.stats.sharpMovements / total) * 100,
        extreme: (this.stats.extremeOutliers / total) * 100,
      },
    };
  }

  // ✅ СПЕЦИАЛЬНЫЕ РЕЖИМЫ

  setModeForGaming(): void {
    this.updateConfig({
      sharpSmoothFactor: 0.4, // Меньше сглаживания для игр
      gentleSmoothFactor: 0.1, // Почти нет сглаживания плавных движений
      adaptiveSmoothing: true,
      velocityAware: true,
    });
    console.log("🎮 Filter optimized for gaming mode");
  }

  setModeForMedical(): void {
    this.updateConfig({
      sharpSmoothFactor: 0.6, // Больше сглаживания для медицины
      gentleSmoothFactor: 0.2,
      adaptiveSmoothing: true,
      velocityAware: false, // Меньше зависимости от скорости
    });
    console.log("🏥 Filter optimized for medical mode");
  }

  setModeForCalibration(): void {
    this.updateConfig({
      sharpSmoothFactor: 0.8, // Максимальное сглаживание
      gentleSmoothFactor: 0.3,
      enableReanimation: false, // Отключаем реанимацию при калибровке
      adaptiveSmoothing: false,
    });
    console.log("⚖️ Filter optimized for calibration mode");
  }
}

// ✅ ЭКСПОРТ С ОБРАТНОЙ СОВМЕСТИМОСТЬЮ
export { CoPSmartFilter as SmartFilter };
