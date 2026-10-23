export interface DiagnosticSample {
  timestamp: number;
  stage:
    | 'parser'
    | 'server'
    | 'websocket'
    | 'kalman'
    | 'interpolator'
    | 'render';
  type: 'data' | 'error' | 'warning' | 'info';
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface DiagnosticStats {
  // Парсер
  totalPackets: number;
  validPackets: number;
  invalidPackets: number;
  outlierPackets: number;
  lastParserError?: string;

  // Датчики
  sensorRanges: {
    d1: { min: number; max: number; current: number };
    d2: { min: number; max: number; current: number };
    d3: { min: number; max: number; current: number };
    d4: { min: number; max: number; current: number };
  };

  // Kalman фильтр
  kalmanResets: number;
  kalmanOutliers: number;
  filterUncertainty: number;
  lastKalmanReset?: string;

  // Производительность
  packetRate: number;
  renderRate: number;
  latencyMs: number;

  // Качество сигнала
  signalToNoise: number;
  stabilityIndex: number;

  // Координаты
  positionJumps: number;
  maxJumpDistance: number;
  currentPosition: { x: number; y: number };
  currentVelocity: { x: number; y: number };

  // Состояние
  isPlatformEmpty: boolean;
  isCalibrated: boolean;
  connectionState: string;
}

export class DiagnosticsCollector {
  private samples: DiagnosticSample[] = [];
  private stats: DiagnosticStats;
  private readonly maxSamples = 1000;

  // Zero-GC переменные для hot path
  private tempSample: DiagnosticSample;

  // Для вычисления статистик
  private lastPositions: Array<{ x: number; y: number; t: number }> = [];
  private readonly maxPositionHistory = 50;

  constructor() {
    this.stats = this.createInitialStats();

    // Предаллоцируем объект для hot path
    this.tempSample = {
      timestamp: 0,
      stage: 'parser',
      type: 'data',
      data: {},
      metadata: {},
    };
  }

  private createInitialStats(): DiagnosticStats {
    return {
      totalPackets: 0,
      validPackets: 0,
      invalidPackets: 0,
      outlierPackets: 0,
      sensorRanges: {
        d1: { min: Infinity, max: -Infinity, current: 0 },
        d2: { min: Infinity, max: -Infinity, current: 0 },
        d3: { min: Infinity, max: -Infinity, current: 0 },
        d4: { min: Infinity, max: -Infinity, current: 0 },
      },
      kalmanResets: 0,
      kalmanOutliers: 0,
      filterUncertainty: 0,
      packetRate: 0,
      renderRate: 0,
      latencyMs: 0,
      signalToNoise: 0,
      stabilityIndex: 0,
      positionJumps: 0,
      maxJumpDistance: 0,
      currentPosition: { x: 0, y: 0 },
      currentVelocity: { x: 0, y: 0 },
      isPlatformEmpty: false,
      isCalibrated: false,
      connectionState: 'disconnected',
    };
  }

  // ✅ ZERO-GC метод для hot path (вызывается каждый пакет/кадр)
  logDataPoint(
    stage: DiagnosticSample['stage'],
    key: string,
    value: number,
    metadata?: string,
  ): void {
    // Обновляем статистики без аллокаций
    this.updateStats(stage, key, value, metadata);
  }

  // ✅ Обычный метод для редких событий (ошибки, предупреждения)
  log(
    stage: DiagnosticSample['stage'],
    type: DiagnosticSample['type'],
    data: Record<string, any>,
    metadata?: Record<string, any>,
  ): void {
    const sample: DiagnosticSample = {
      timestamp: performance.now(),
      stage,
      type,
      data: { ...data },
      metadata: metadata ? { ...metadata } : undefined,
    };

    this.samples.push(sample);

    // Ограничиваем размер массива
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Выводим критичные события в консоль
    if (type === 'error') {
      console.error(`🔥 [${stage.toUpperCase()}]`, data);
    } else if (type === 'warning') {
      console.warn(`⚠️ [${stage.toUpperCase()}]`, data);
    }
  }

  private updateStats(
    stage: string,
    key: string,
    value: number,
    metadata?: string,
  ): void {
    const now = performance.now();

    switch (stage) {
      case 'parser':
        if (key === 'valid_packet') {
          this.stats.validPackets++;
          this.stats.totalPackets++;
        } else if (key === 'invalid_packet') {
          this.stats.invalidPackets++;
          this.stats.totalPackets++;
        } else if (key === 'outlier_packet') {
          this.stats.outlierPackets++;
        }
        break;

      case 'server':
        if (key.startsWith('sensor_')) {
          const sensorKey = key.split('_')[1] as 'd1' | 'd2' | 'd3' | 'd4';
          if (this.stats.sensorRanges[sensorKey]) {
            this.stats.sensorRanges[sensorKey].current = value;
            this.stats.sensorRanges[sensorKey].min = Math.min(
              this.stats.sensorRanges[sensorKey].min,
              value,
            );
            this.stats.sensorRanges[sensorKey].max = Math.max(
              this.stats.sensorRanges[sensorKey].max,
              value,
            );
          }
        } else if (key === 'platform_empty') {
          this.stats.isPlatformEmpty = value === 1;
        }
        break;

      case 'kalman':
        if (key === 'reset') {
          this.stats.kalmanResets++;
          this.stats.lastKalmanReset = metadata || 'Unknown reason';
        } else if (key === 'outlier_rejected') {
          this.stats.kalmanOutliers++;
        } else if (key === 'uncertainty') {
          this.stats.filterUncertainty = value;
        } else if (key === 'position_x') {
          this.stats.currentPosition.x = value;
          this.updatePositionHistory(value, this.stats.currentPosition.y, now);
        } else if (key === 'position_y') {
          this.stats.currentPosition.y = value;
          this.updatePositionHistory(this.stats.currentPosition.x, value, now);
        } else if (key === 'velocity_x') {
          this.stats.currentVelocity.x = value;
        } else if (key === 'velocity_y') {
          this.stats.currentVelocity.y = value;
        }
        break;

      case 'render':
        if (key === 'fps') {
          this.stats.renderRate = value;
        } else if (key === 'latency') {
          this.stats.latencyMs = value;
        }
        break;
    }
  }

  private updatePositionHistory(x: number, y: number, timestamp: number): void {
    this.lastPositions.push({ x, y, t: timestamp });

    if (this.lastPositions.length > this.maxPositionHistory) {
      this.lastPositions.shift();
    }

    // Вычисляем скачки позиции
    if (this.lastPositions.length > 1) {
      const prev = this.lastPositions[this.lastPositions.length - 2];
      const curr = this.lastPositions[this.lastPositions.length - 1];

      const jumpDistance = Math.sqrt(
        (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2,
      );

      if (jumpDistance > 20) {
        // Порог для "скачка"
        this.stats.positionJumps++;
        this.stats.maxJumpDistance = Math.max(
          this.stats.maxJumpDistance,
          jumpDistance,
        );
      }
    }

    // Вычисляем индекс стабильности (дисперсия последних 10 позиций)
    if (this.lastPositions.length >= 10) {
      const recent = this.lastPositions.slice(-10);
      const avgX = recent.reduce((sum, p) => sum + p.x, 0) / recent.length;
      const avgY = recent.reduce((sum, p) => sum + p.y, 0) / recent.length;

      const variance =
        recent.reduce((sum, p) => {
          return sum + (p.x - avgX) ** 2 + (p.y - avgY) ** 2;
        }, 0) / recent.length;

      this.stats.stabilityIndex = 1000 / (1 + Math.sqrt(variance)); // Чем больше - тем стабильнее
    }
  }

  // Обновление состояния соединения
  updateConnectionState(
    ws: boolean,
    device: boolean,
    calibrated: boolean,
  ): void {
    this.stats.isCalibrated = calibrated;

    if (!ws) {
      this.stats.connectionState = 'ws_disconnected';
    } else if (!device) {
      this.stats.connectionState = 'device_disconnected';
    } else if (!calibrated) {
      this.stats.connectionState = 'not_calibrated';
    } else {
      this.stats.connectionState = 'connected';
    }
  }

  // Обновление частоты пакетов
  updatePacketRate(packetsPerSecond: number): void {
    this.stats.packetRate = packetsPerSecond;
  }

  getStats(): DiagnosticStats {
    return { ...this.stats };
  }

  getRecentSamples(count: number = 50): DiagnosticSample[] {
    return this.samples.slice(-count);
  }

  getErrorSamples(maxCount: number = 20): DiagnosticSample[] {
    return this.samples.filter((s) => s.type === 'error').slice(-maxCount);
  }

  exportData(): {
    stats: DiagnosticStats;
    samples: DiagnosticSample[];
    timestamp: string;
  } {
    return {
      stats: this.getStats(),
      samples: [...this.samples],
      timestamp: new Date().toISOString(),
    };
  }

  clear(): void {
    this.samples = [];
    this.stats = this.createInitialStats();
    this.lastPositions = [];
  }

  // Генерация отчета о проблемах
  generateDiagnosticReport(): string[] {
    const issues: string[] = [];
    const stats = this.stats;

    // Проверяем качество соединения
    if (stats.packetRate < 30) {
      issues.push(
        `🔴 Низкая частота пакетов: ${stats.packetRate.toFixed(1)} Гц (норма > 30)`,
      );
    }

    if (stats.invalidPackets / Math.max(1, stats.totalPackets) > 0.05) {
      issues.push(
        `🔴 Много поврежденных пакетов: ${((100 * stats.invalidPackets) / Math.max(1, stats.totalPackets)).toFixed(1)}% (норма < 5%)`,
      );
    }

    if (stats.outlierPackets > 50) {
      issues.push(
        `🟡 Много выбросов датчиков: ${stats.outlierPackets} (возможен шум или неисправность)`,
      );
    }

    if (stats.kalmanResets > 10) {
      issues.push(
        `🟡 Частые сбросы фильтра: ${stats.kalmanResets} (нестабильный сигнал)`,
      );
    }

    if (stats.positionJumps > 20) {
      issues.push(
        `🔴 Телепортация точки: ${stats.positionJumps} скачков, макс. ${stats.maxJumpDistance.toFixed(1)}мм`,
      );
    }

    if (stats.stabilityIndex < 10 && !stats.isPlatformEmpty) {
      issues.push(
        `🟡 Нестабильное позиционирование: индекс ${stats.stabilityIndex.toFixed(1)} (норма > 50)`,
      );
    }

    if (stats.renderRate < 30) {
      issues.push(
        `🟡 Низкий FPS рендеринга: ${stats.renderRate.toFixed(1)} (норма > 30)`,
      );
    }

    if (stats.latencyMs > 100) {
      issues.push(
        `🟡 Высокая задержка: ${stats.latencyMs.toFixed(1)}мс (норма < 50)`,
      );
    }

    // Проверяем баланс датчиков
    const sensors = [
      stats.sensorRanges.d1,
      stats.sensorRanges.d2,
      stats.sensorRanges.d3,
      stats.sensorRanges.d4,
    ];
    const avgRange = sensors.reduce((sum, s) => sum + (s.max - s.min), 0) / 4;
    const unbalanced = sensors.some(
      (s) => Math.abs(s.max - s.min - avgRange) > avgRange * 0.5,
    );

    if (unbalanced && avgRange > 1000) {
      issues.push(`🟡 Дисбаланс датчиков (разброс диапазонов > 50%)`);
    }

    if (issues.length === 0) {
      issues.push(`✅ Система работает стабильно`);
    }

    return issues;
  }
}

// Глобальный экземпляр
export const diagnostics = new DiagnosticsCollector();
