// packages/shared/src/CoPSmartFilter.ts

/**
 * Медианный фильтр центра давления (CoP) v2.3+
 *
 * ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ:
 * - Правильная инициализация буфера при первом вызове
 * - Защита от мусора в незаполненном буфере
 * - Корректный сброс состояния после reset()
 */

export interface FilteredCoP {
  x: number;
  y: number;
  wasFiltered: boolean;
  confidence: number;
  filterType?: string;
}

export interface SmartFilterConfig {
  bufferSize: number;
  maxJumpMm: number;
  frozenThreshold: number;
  epsilon: number;

  gentleJumpMm: number;
  sharpJumpMm: number;
  extremeJumpMm: number;

  gentleSmoothFactor: number;
  sharpSmoothFactor: number;
  extremeSmoothFactor: number;

  adaptiveSmoothing: boolean;
  velocityAware: boolean;
  enableReanimation: boolean;

  ignoreZeroInputs: boolean;
  zeroInputThreshold: number;
}

export interface FilterStats {
  totalSamples: number;
  filteredSamples: number;
  zeroInputsIgnored: number;
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
  private lastValidX = 0;
  private lastValidY = 0;
  private lastTimestamp = 0;

  private frozenCount = 0;
  private stats: FilterStats;

  private config: SmartFilterConfig = {
    bufferSize: 3, // ✅ Снижаем до 3 для мгновенной реакции в покое
    maxJumpMm: 40,
    frozenThreshold: 30, // ✅ Увеличиваем (реже детектируем замирание)
    epsilon: 0.1, // ✅ Чуть больше мертвая зона

    gentleJumpMm: 15,
    sharpJumpMm: 100,
    extremeJumpMm: 200,

    gentleSmoothFactor: 0.1,
    sharpSmoothFactor: 0.3,
    extremeSmoothFactor: 0.7,

    adaptiveSmoothing: true,
    velocityAware: true,
    enableReanimation: false, // 🚨 ОТКЛЮЧАЕМ. Это была причина рывков в покое!

    ignoreZeroInputs: true,
    zeroInputThreshold: 0.1, // ✅ Согласовано с новым CoPCalculator
  };

  constructor(config?: Partial<SmartFilterConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.initializeBuffers();
    this.stats = this.createInitialStats();

    console.log("🎯 CoPSmartFilter v2.3+ initialized (buffer-safe):", {
      gentle: `${this.config.gentleJumpMm}mm → ${((1 - this.config.gentleSmoothFactor) * 100).toFixed(0)}%`,
      sharp: `${this.config.sharpJumpMm}mm → ${((1 - this.config.sharpSmoothFactor) * 100).toFixed(0)}%`,
      extreme: `${this.config.extremeJumpMm}mm → ${((1 - this.config.extremeSmoothFactor) * 100).toFixed(0)}%`,
      ignoreZeros: this.config.ignoreZeroInputs,
    });
  }

  private createInitialStats(): FilterStats {
    return {
      totalSamples: 0,
      filteredSamples: 0,
      zeroInputsIgnored: 0,
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

  filter(
    input: { x: number; y: number; z?: number; f?: number },
    timestamp: number,
  ): FilteredCoP {
    this.stats.totalSamples++;

    // ✅ НОВАЯ ЛОГИКА: Проверяем на нулевые входы от CoPCalculator
    const inputDistance = Math.sqrt(input.x ** 2 + input.y ** 2);
    const isZeroInput = inputDistance < this.config.zeroInputThreshold;

    if (
      isZeroInput &&
      this.config.ignoreZeroInputs &&
      this.stats.totalSamples > 1
    ) {
      this.stats.zeroInputsIgnored++;

      if (this.stats.zeroInputsIgnored % 100 === 1) {
        console.warn(
          "🚫 CoPSmartFilter: Ignoring zero input from CoPCalculator:",
          {
            input: { x: input.x.toFixed(3), y: input.y.toFixed(3) },
            ignoredCount: this.stats.zeroInputsIgnored,
            returningLast: {
              x: this.lastValidX.toFixed(1),
              y: this.lastValidY.toFixed(1),
            },
          },
        );
      }

      return {
        x: this.lastValidX,
        y: this.lastValidY,
        wasFiltered: true,
        confidence: 0.5,
        filterType: `zero-input-ignored (count: ${this.stats.zeroInputsIgnored})`,
      };
    }

    // ✅ Обновляем последние валидные координаты
    if (!isZeroInput) {
      this.lastValidX = input.x;
      this.lastValidY = input.y;
    }

    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Первый вызов - инициализация без фильтрации
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

    // ✅ ШАГ 2: Оценка скорости
    let currentVelocity = 0;
    if (this.config.velocityAware && dt > 0.001 && dt < 0.5) {
      currentVelocity = jumpDistance / dt;
    }

    // ✅ ШАГ 3: Добавляем в кольцевой буфер (только валидные значения)
    if (!isZeroInput) {
      this.addToBuffer(input.x, input.y);
    }

    // ✅ ШАГ 4: КРИТИЧЕСКАЯ ПРОВЕРКА - не применяем медианную фильтрацию пока буфер не заполнен!
    if (!this.isBufferFull) {
      // Буфер еще заполняется - просто передаем данные с минимальным сглаживанием
      const smoothFactor = 0.3;
      const filteredX =
        this.lastX + (input.x - this.lastX) * (1 - smoothFactor);
      const filteredY =
        this.lastY + (input.y - this.lastY) * (1 - smoothFactor);

      this.lastX = filteredX;
      this.lastY = filteredY;
      this.lastTimestamp = timestamp;

      return {
        x: filteredX,
        y: filteredY,
        wasFiltered: true,
        confidence: 0.7,
        filterType: `buffer-filling (${this.head}/${this.config.bufferSize})`,
      };
    }

    // ✅ ШАГ 5: Определяем тип движения и применяем фильтрацию (только если буфер полный!)
    const filterResult = this.applyAdaptiveFilter(
      input,
      jumpDistance,
      currentVelocity,
    );

    // ✅ ШАГ 6: Детекция замирания (только для не-нулевых входов)
    if (this.config.enableReanimation && !isZeroInput) {
      this.detectAndHandleFreezing(filterResult);
    }

    // ✅ ШАГ 7: Обновляем состояние
    this.updateState(filterResult, timestamp);

    // ✅ ШАГ 8: Обновляем статистику
    this.updateStats(filterResult);

    return filterResult;
  }

  private initializeWithFirstSample(
    x: number,
    y: number,
    timestamp: number,
  ): void {
    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Заполняем буфер первым значением
    this.bufferX.fill(x);
    this.bufferY.fill(y);
    this.lastX = x;
    this.lastY = y;
    this.lastValidX = x;
    this.lastValidY = y;
    this.lastTimestamp = timestamp;
    this.frozenCount = 0;

    // ✅ НОВОЕ: Принудительно отмечаем буфер как незаполненный
    this.head = 1; // Первый элемент уже записан
    this.isBufferFull = false;

    console.log("🎯 CoPSmartFilter initialized with first sample:", {
      x: x.toFixed(1),
      y: y.toFixed(1),
    });
  }

  private addToBuffer(x: number, y: number): void {
    this.bufferX[this.head] = x;
    this.bufferY[this.head] = y;
    this.head = (this.head + 1) % this.config.bufferSize;

    if (!this.isBufferFull && this.head === 0) {
      this.isBufferFull = true;
      console.log(
        "✅ CoPSmartFilter buffer is now FULL, median filtering enabled",
      );
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
      movementType = "gentle";
      smoothFactor = this.config.gentleSmoothFactor;
      confidence = 1.0;
      this.stats.gentleMovements++;
    } else if (jumpDistance <= this.config.sharpJumpMm) {
      movementType = "sharp";

      if (this.config.adaptiveSmoothing) {
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

      confidence = 0.9;
      this.stats.sharpMovements++;
    } else {
      movementType = "extreme";
      smoothFactor = this.config.extremeSmoothFactor;
      confidence = 0.4;
      this.stats.extremeOutliers++;
    }

    // ✅ ПРИМЕНЯЕМ ФИЛЬТРАЦИЮ
    if (movementType === "gentle" || smoothFactor < 0.1) {
      // Плавные движения почти не фильтруем
      return {
        x: input.x,
        y: input.y,
        wasFiltered: false,
        confidence,
        filterType: movementType,
      };
    } else {
      // ✅ КРИТИЧЕСКАЯ ПРОВЕРКА: Буфер должен быть полным!
      if (!this.isBufferFull) {
        console.error(
          "🚨 CRITICAL: Trying to use median filter with unfilled buffer!",
        );
        return {
          x: input.x,
          y: input.y,
          wasFiltered: false,
          confidence: 0.5,
          filterType: "buffer-not-ready",
        };
      }

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

    if (this.frozenCount >= this.config.frozenThreshold) {
      const noise = 0.05;
      result.x += (Math.random() - 0.5) * noise;
      result.y += (Math.random() - 0.5) * noise;
      result.wasFiltered = true;
      result.confidence = Math.min(result.confidence, 0.8);
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

    const alpha = 0.05;
    this.stats.averageConfidence =
      this.stats.averageConfidence * (1 - alpha) + result.confidence * alpha;
  }

  private getMedianFromBuffer(buffer: number[]): number {
    // ✅ ЗАЩИТА: Используем только заполненную часть буфера
    const effectiveSize = this.isBufferFull
      ? this.config.bufferSize
      : this.head;

    if (effectiveSize === 0) {
      console.error(
        "🚨 CRITICAL: getMedianFromBuffer called with empty buffer!",
      );
      return 0;
    }

    const values = buffer.slice(0, effectiveSize);

    values.sort((a, b) => a - b);

    const mid = Math.floor(values.length / 2);
    return values.length % 2
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;
  }

  // ✅ ПУБЛИЧНЫЕ МЕТОДЫ

  updateConfig(newConfig: Partial<SmartFilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log("🎯 CoPSmartFilter v2.3+ config updated:", newConfig);
  }

  reset(): void {
    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Полный сброс состояния
    this.initializeBuffers();
    this.lastX = 0;
    this.lastY = 0;
    this.lastValidX = 0;
    this.lastValidY = 0;
    this.lastTimestamp = 0;
    this.frozenCount = 0;
    this.stats = this.createInitialStats();
    console.log("🔄 CoPSmartFilter v2.3+ reset (buffer cleared)");
  }

  getStats(): FilterStats {
    return { ...this.stats };
  }

  getConfig(): SmartFilterConfig {
    return { ...this.config };
  }

  getCurrentState(): {
    lastPosition: { x: number; y: number };
    lastValidPosition: { x: number; y: number };
    frozenCount: number;
    bufferSize: number;
    isBufferFull: boolean;
    zeroInputsIgnored: number;
  } {
    return {
      lastPosition: { x: this.lastX, y: this.lastY },
      lastValidPosition: { x: this.lastValidX, y: this.lastValidY },
      frozenCount: this.frozenCount,
      bufferSize: this.config.bufferSize,
      isBufferFull: this.isBufferFull,
      zeroInputsIgnored: this.stats.zeroInputsIgnored,
    };
  }

  getPerformanceStats(): {
    filterRate: number;
    zeroInputRate: number;
    averageConfidence: number;
    movementDistribution: {
      gentle: number;
      sharp: number;
      extreme: number;
    };
  } {
    const total = this.stats.totalSamples || 1;

    return {
      filterRate: (this.stats.filteredSamples / total) * 100,
      zeroInputRate: (this.stats.zeroInputsIgnored / total) * 100,
      averageConfidence: this.stats.averageConfidence,
      movementDistribution: {
        gentle: (this.stats.gentleMovements / total) * 100,
        sharp: (this.stats.sharpMovements / total) * 100,
        extreme: (this.stats.extremeOutliers / total) * 100,
      },
    };
  }

  setModeForSharpMovements(): void {
    this.updateConfig({
      gentleJumpMm: 50,
      sharpJumpMm: 200,
      extremeJumpMm: 300,
      gentleSmoothFactor: 0.02,
      sharpSmoothFactor: 0.1,
      extremeSmoothFactor: 0.4,
      ignoreZeroInputs: true,
      adaptiveSmoothing: true,
      velocityAware: true,
    });
    console.log("🎯 CoPSmartFilter v2.3+ optimized for sharp movements");
  }
}

export { CoPSmartFilter as SmartFilter };
