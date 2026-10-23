import { WebSocketServer, WebSocket } from 'ws';
import { SerialPort } from 'serialport';
import {
  PacketParser,
  AxisTransform,
  CoPCalculator,
  CoPSmartFilter,
  WEBSOCKET_PORT,
  DEFAULT_BAUD_RATE,
  PLATFORM_SIZE,
  SENSOR_DISTANCE,
  type SensorData,
  type StabilogramSample,
  type AxisConfiguration,
  type CalibrationData,
  type ParsedPacket,
} from '@stabilometer/shared';
import {
  CalibrationStorage,
  type StoredCalibration,
} from './CalibrationStorage.js';

interface PerformanceSettings {
  enableBatchSending: boolean;
  batchSize: number;
  batchTimeoutMs: number;
  enableOptimizedBuffers: boolean;
  enableFastParsing: boolean;
}

const defaultAxes: AxisConfiguration = {
  swapXY: true,
  invertX: false,
  invertY: false,
  rotationDeg: 0,
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class StabilogramServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, boolean>();
  private serialPort: SerialPort | null = null;
  private parser = new PacketParser({ filterOutliers: false });
  private copCalculator = new CoPCalculator();
  private copFilter = new CoPSmartFilter();
  private axisConfig = { ...defaultAxes };
  private axisTransform = new AxisTransform(this.axisConfig);
  private platformSize = { ...PLATFORM_SIZE };
  private sensorDistance = { ...SENSOR_DISTANCE };
  private calibration: StoredCalibration | null = null;
  private isCalibrated = false;
  private isCalibrating = false;
  private calibrationSamples: SensorData[] = [];
  private readonly calibrationSampleCount = 200;
  private calibrationTimer: ReturnType<typeof setTimeout> | null = null;
  private testMode = false;
  private testInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval>;
  private performanceSettings: PerformanceSettings = {
    enableBatchSending: true,
    batchSize: 5,
    batchTimeoutMs: 10,
    enableOptimizedBuffers: true,
    enableFastParsing: true,
  };
  private packetBatch: StabilogramSample[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSample: StabilogramSample | null = null;
  private deviceOperations = Promise.resolve();
  private stopped = false;

  constructor(options: { port?: number } = {}) {
    this.calibration = CalibrationStorage.load();
    if (this.calibration) this.applyCalibration(this.calibration);
    this.wss = new WebSocketServer({
      port: options.port ?? WEBSOCKET_PORT,
      host: '127.0.0.1',
      maxPayload: 16 * 1024,
      verifyClient: ({ origin }: { origin: string }) => {
        if (!origin) return true; // Native local client.
        try {
          const url = new URL(origin);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
          );
        } catch {
          return false;
        }
      },
    });
    this.wss.on('error', (error) => console.error('Ошибка WebSocket:', error));
    this.wss.on('connection', (ws) => this.acceptClient(ws));
    this.heartbeat = setInterval(() => {
      for (const [ws, alive] of this.clients) {
        if (!alive) {
          ws.terminate();
          this.clients.delete(ws);
        } else if (ws.readyState === WebSocket.OPEN) {
          this.clients.set(ws, false);
          ws.ping();
        }
      }
    }, 30000);
  }

  /** Actual port, including an ephemeral port used by integration tests. */
  get port(): number {
    const address = this.wss.address();
    return address && typeof address === 'object' ? address.port : 0;
  }

  private applyCalibration(stored: StoredCalibration): void {
    this.copCalculator.configure({
      sensorDistanceX: stored.sensorDistance.x,
      sensorDistanceY: stored.sensorDistance.y,
    });
    this.copCalculator.setOffsets(stored.sensorOffsets);
    this.platformSize = { ...stored.platformSize };
    this.sensorDistance = { ...stored.sensorDistance };
    this.isCalibrated = true;
    if (stored.axisConfig) {
      this.axisConfig = { ...stored.axisConfig };
      this.axisTransform.updateConfig(this.axisConfig);
    }
  }

  private calibrationData(): CalibrationData | null {
    if (!this.calibration || !this.isCalibrated || this.testMode) return null;
    return {
      sensorOffsets: this.copCalculator.getOffsets(),
      platformSize: this.platformSize,
      sensorDistance: this.sensorDistance,
      timestamp: Date.parse(this.calibration.createdAt),
      sampleCount: this.calibration.sampleCount ?? 0,
      isValid: true,
    };
  }

  private acceptClient(ws: WebSocket): void {
    this.clients.set(ws, true);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    ws.on('pong', () => this.clients.set(ws, true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.send(ws, {
          type: 'ERROR',
          error: 'Ожидается текстовая команда JSON',
        });
        return;
      }
      try {
        this.handleCommand(ws, JSON.parse(data.toString()));
      } catch (error) {
        this.send(ws, { type: 'ERROR', error: errorText(error) });
      }
    });
    this.send(ws, {
      type: 'CONNECTED',
      serialConnected: this.testMode || !!this.serialPort?.isOpen,
      testMode: this.testMode,
      port: this.testMode ? 'Демонстрация' : this.serialPort?.path,
      calibrated: this.testMode || this.isCalibrated,
      calibration: this.calibrationData(),
      isCalibrating: this.isCalibrating,
      calibrationProgress: this.calibrationSamples.length,
      axisConfig: this.axisConfig,
      platformSize: this.platformSize,
      sensorDistance: this.sensorDistance,
      performanceSettings: this.performanceSettings,
    });
  }

  private handleCommand(ws: WebSocket, data: unknown): void {
    if (!isObject(data) || typeof data.type !== 'string')
      throw new Error('Некорректная команда');
    switch (data.type) {
      case 'CONNECT': {
        if (data.testMode !== undefined && typeof data.testMode !== 'boolean')
          throw new Error('Некорректный режим');
        const test = data.testMode === true;
        const rate = data.baudRate ?? DEFAULT_BAUD_RATE;
        if (
          !test &&
          (typeof data.portPath !== 'string' ||
            !data.portPath.trim() ||
            data.portPath.length > 256)
        )
          throw new Error('Укажите COM-порт');
        if (
          typeof rate !== 'number' ||
          !Number.isInteger(rate) ||
          rate < 300 ||
          rate > 4000000
        )
          throw new Error('Некорректная скорость порта');
        this.queueDeviceOperation(ws, () =>
          this.connectDevice(test ? '' : (data.portPath as string), rate, test),
        );
        break;
      }
      case 'DISCONNECT':
        this.queueDeviceOperation(ws, () => this.disconnectDevice());
        break;
      case 'CALIBRATE_ZERO':
        this.startCalibration();
        break;
      case 'CONFIGURE_AXES': {
        if (this.isCalibrating)
          throw new Error('Дождитесь завершения калибровки');
        const config = isObject(data.config) ? data.config : data;
        if (
          !['swapXY', 'invertX', 'invertY'].every(
            (key) => typeof config[key] === 'boolean',
          ) ||
          typeof config.rotationDeg !== 'number' ||
          !Number.isFinite(config.rotationDeg) ||
          Math.abs(config.rotationDeg) > 3600
        )
          throw new Error('Некорректная конфигурация осей');
        this.flushBatch();
        const axes = {
          swapXY: config.swapXY as boolean,
          invertX: config.invertX as boolean,
          invertY: config.invertY as boolean,
          rotationDeg: config.rotationDeg,
        };
        if (this.calibration) {
          const stored = { ...this.calibration, axisConfig: axes };
          if (!CalibrationStorage.save(stored))
            throw new Error('Не удалось сохранить конфигурацию осей');
          this.calibration = stored;
        }
        this.axisConfig = axes;
        this.axisTransform.updateConfig(this.axisConfig);
        this.copFilter.reset();
        this.broadcast({ type: 'AXES_CONFIGURED', config: this.axisConfig });
        break;
      }
      case 'LIST_PORTS':
        void SerialPort.list()
          .then((ports) => this.send(ws, { type: 'PORTS_LIST', ports }))
          .catch(() =>
            this.send(ws, {
              type: 'ERROR',
              error: 'Не удалось получить список портов',
            }),
          );
        break;
      case 'PING':
        this.send(ws, { type: 'PONG', timestamp: Date.now() });
        break;
      case 'SET_PERFORMANCE':
        this.updatePerformance(data.settings);
        break;
      case 'DIAGNOSE_SENSORS':
        if (!this.lastSample || !this.serialPort?.isOpen)
          throw new Error('Нет измерений с подключённой платформы');
        this.send(ws, {
          type: 'SENSOR_DIAGNOSIS',
          sensors: this.lastSample.sensors,
          diagnosis: this.lastSample.raw,
          offsets: this.copCalculator.getOffsets(),
          parserStats: this.parser.getStats(),
        });
        break;
      default:
        throw new Error(`Неизвестная команда: ${data.type}`);
    }
  }

  private queueDeviceOperation(
    ws: WebSocket,
    operation: () => Promise<void>,
  ): void {
    this.deviceOperations = this.deviceOperations
      .then(async () => {
        if (!this.stopped) await operation();
      })
      .catch((error) =>
        this.send(ws, { type: 'ERROR', error: errorText(error) }),
      );
  }

  private updatePerformance(value: unknown): void {
    if (!isObject(value))
      throw new Error('Некорректные настройки производительности');
    const next = { ...this.performanceSettings };
    for (const [key, input] of Object.entries(value)) {
      if (!(key in next)) throw new Error(`Неизвестная настройка: ${key}`);
      if (key === 'batchSize' || key === 'batchTimeoutMs') {
        if (
          typeof input !== 'number' ||
          !Number.isInteger(input) ||
          input < 1 ||
          input > (key === 'batchSize' ? 100 : 1000)
        )
          throw new Error(`Некорректная настройка: ${key}`);
        next[key] = input;
      } else {
        if (typeof input !== 'boolean')
          throw new Error(`Некорректная настройка: ${key}`);
        (next as unknown as Record<string, unknown>)[key] = input;
      }
    }
    this.flushBatch();
    this.performanceSettings = next;
    this.parser.setFastMode(next.enableFastParsing);
    this.broadcast({ type: 'PERFORMANCE_UPDATED', settings: next });
  }

  private async connectDevice(
    path: string,
    baudRate: number,
    test: boolean,
  ): Promise<void> {
    await this.disconnectDevice();
    if (this.stopped) return;
    if (test) {
      this.testMode = true;
      this.startTestMode();
      this.broadcast({
        type: 'SERIAL_CONNECTED',
        testMode: true,
        calibrated: true,
        port: 'Демонстрация',
      });
      return;
    }
    if (
      this.calibration &&
      (!this.calibration.deviceId || this.calibration.deviceId === path)
    ) {
      this.applyCalibration(this.calibration);
    } else {
      this.isCalibrated = false;
      this.copCalculator.reset();
    }
    const port = new SerialPort({
      path,
      baudRate,
      autoOpen: false,
      highWaterMark: this.performanceSettings.enableOptimizedBuffers
        ? 8192
        : 65536,
    });
    this.serialPort = port;
    port.on('data', (data: Buffer) => {
      if (this.serialPort === port && port.isOpen) this.handleSerialData(data);
    });
    port.on('error', (error) => {
      if (this.serialPort === port)
        this.broadcast({ type: 'ERROR', error: error.message });
    });
    port.on('close', () => {
      if (this.serialPort !== port) return;
      this.serialPort = null;
      this.resetStream();
      this.broadcast({ type: 'SERIAL_DISCONNECTED', reason: 'Порт закрыт' });
    });
    try {
      await new Promise<void>((resolve, reject) =>
        port.open((error) => (error ? reject(error) : resolve())),
      );
      if (this.stopped) {
        await this.disconnectDevice();
        return;
      }
      this.broadcast({
        type: 'SERIAL_CONNECTED',
        port: path,
        testMode: false,
        calibrated: this.isCalibrated,
        calibration: this.calibrationData(),
      });
    } catch (error) {
      if (this.serialPort === port) this.serialPort = null;
      this.resetStream();
      this.broadcast({ type: 'SERIAL_DISCONNECTED' });
      throw new Error(`Не удалось открыть ${path}: ${errorText(error)}`);
    }
  }

  private async disconnectDevice(): Promise<void> {
    if (this.testInterval) clearInterval(this.testInterval);
    this.testInterval = null;
    this.testMode = false;
    const previous = this.serialPort;
    this.serialPort = null;
    this.resetStream();
    this.broadcast({ type: 'SERIAL_DISCONNECTED' });
    if (previous?.isOpen)
      await new Promise<void>((resolve) => previous.close(() => resolve()));
  }

  private resetStream(): void {
    this.cancelCalibration('Калибровка прервана: устройство отключено');
    this.flushBatch();
    this.parser.clear();
    this.copFilter.reset();
    this.lastSample = null;
  }

  private startTestMode(): void {
    let packetNumber = 0;
    this.testInterval = setInterval(() => {
      const now = Date.now();
      const angle = packetNumber * 0.05;
      const x = Math.cos(angle) * 50;
      const y = Math.sin(angle) * 50;
      const coordinates = { x, y, z: 0, f: 4000 };
      this.sendSample({
        sensors: {
          d1: 1e6 * (1 - x / 130) * (1 + y / 130),
          d2: 1e6 * (1 + x / 130) * (1 + y / 130),
          d3: 1e6 * (1 + x / 130) * (1 - y / 130),
          d4: 1e6 * (1 - x / 130) * (1 - y / 130),
        },
        raw: coordinates,
        centered: coordinates,
        filtered: coordinates,
        mm: { x, y },
        deviceTime: packetNumber * 20,
        serverTime: now,
        clientTime: now,
        packetNumber: packetNumber++,
        isValid: true,
      });
    }, 20);
  }

  private handleSerialData(data: Buffer): void {
    this.parser.addData(data);
    for (const packet of this.parser.parseAll()) {
      if (!packet.isValid) {
        this.broadcast({
          type: 'SIGNAL_QUALITY',
          parserStats: this.parser.getStats(),
          error: packet.error,
        });
        continue;
      }
      this.sendSample(this.processPacket(packet));
    }
  }

  private processPacket(packet: ParsedPacket): StabilogramSample {
    const now = Date.now();
    const raw = this.copCalculator.calculate(packet.sensors);
    const centered = this.axisTransform.transform(raw);
    const saturated = Object.values(packet.sensors).some(
      (value) => value <= -0x800000 || value >= 0x7fffff,
    );
    const invalidReason = this.isCalibrating
      ? 'calibrating'
      : !this.isCalibrated
        ? 'not-calibrated'
        : saturated
          ? 'sensor-saturation'
          : !Number.isFinite(centered.f) || centered.f < 0.1
            ? 'insufficient-load'
            : undefined;
    const isValid = invalidReason === undefined;
    const result = this.copFilter.filter({ ...centered, isValid }, now);
    const sample: StabilogramSample = {
      sensors: packet.sensors,
      raw,
      centered,
      filtered: { x: result.x, y: result.y, z: 0, f: centered.f },
      mm: { x: result.x, y: result.y },
      deviceTime: packet.deviceTime,
      serverTime: now,
      clientTime: now,
      packetNumber: packet.packetNumber,
      isValid,
      invalidReason,
    };
    this.lastSample = sample;
    if (this.isCalibrating) {
      this.calibrationSamples.push({ ...packet.sensors });
      this.broadcast({
        type: 'CALIBRATION_PROGRESS',
        progress: this.calibrationSamples.length,
        total: this.calibrationSampleCount,
      });
      if (this.calibrationSamples.length === this.calibrationSampleCount)
        this.finishCalibration();
    }
    return sample;
  }

  private startCalibration(): void {
    if (this.testMode)
      throw new Error('Калибровка недоступна в демонстрационном режиме');
    if (!this.serialPort?.isOpen)
      throw new Error('Подключите платформу перед калибровкой');
    if (this.isCalibrating) throw new Error('Калибровка уже выполняется');
    this.isCalibrating = true;
    this.calibrationSamples = [];
    this.calibrationTimer = setTimeout(
      () =>
        this.cancelCalibration(
          'Недостаточно данных: проверьте подключение и повторите калибровку',
        ),
      15000,
    );
    this.broadcast({
      type: 'CALIBRATION_STARTED',
      total: this.calibrationSampleCount,
      instruction:
        'Освободите платформу. Калибровка нуля проводится без нагрузки.',
    });
  }

  private cancelCalibration(reason: string): void {
    if (this.calibrationTimer) clearTimeout(this.calibrationTimer);
    this.calibrationTimer = null;
    if (this.isCalibrating)
      this.broadcast({ type: 'CALIBRATION_CANCELLED', error: reason });
    this.isCalibrating = false;
    this.calibrationSamples = [];
  }

  private finishCalibration(): void {
    if (this.calibrationTimer) clearTimeout(this.calibrationTimer);
    this.calibrationTimer = null;
    this.isCalibrating = false;
    const median = (key: keyof SensorData): number => {
      const values = this.calibrationSamples
        .map((sample) => sample[key])
        .sort((a, b) => a - b);
      const middle = values.length / 2;
      return (values[middle - 1] + values[middle]) / 2;
    };
    const stored: StoredCalibration = {
      sensorOffsets: {
        d1: median('d1'),
        d2: median('d2'),
        d3: median('d3'),
        d4: median('d4'),
      },
      platformSize: this.platformSize,
      sensorDistance: this.sensorDistance,
      createdAt: new Date().toISOString(),
      deviceId: this.serialPort?.path,
      sampleCount: this.calibrationSamples.length,
      axisConfig: this.axisConfig,
    };
    this.calibrationSamples = [];
    if (!CalibrationStorage.save(stored)) {
      this.broadcast({
        type: 'CALIBRATION_CANCELLED',
        error:
          'Не удалось сохранить калибровку. Проверьте доступ к каталогу данных.',
      });
      return;
    }
    this.flushBatch();
    this.calibration = stored;
    this.applyCalibration(stored);
    this.copFilter.reset();
    this.broadcast({
      type: 'CALIBRATION_COMPLETE',
      calibration: this.calibrationData(),
    });
  }

  private sendSample(sample: StabilogramSample): void {
    if (!this.performanceSettings.enableBatchSending) {
      this.broadcast({ type: 'DATA', data: sample });
      return;
    }
    this.packetBatch.push(sample);
    if (this.packetBatch.length >= this.performanceSettings.batchSize)
      this.flushBatch();
    else if (!this.batchTimer)
      this.batchTimer = setTimeout(
        () => this.flushBatch(),
        this.performanceSettings.batchTimeoutMs,
      );
  }

  private flushBatch(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (!this.packetBatch.length) return;
    this.broadcast({
      type: 'DATA_BATCH',
      data: this.packetBatch,
      count: this.packetBatch.length,
    });
    this.packetBatch = [];
  }

  private send(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.bufferedAmount > 2 * 1024 * 1024) {
      ws.close(1013, 'Клиент не успевает получать данные');
      return;
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }
  private broadcast(data: Record<string, unknown>): void {
    const message = JSON.stringify(data);
    for (const ws of this.clients.keys()) {
      if (ws.bufferedAmount > 2 * 1024 * 1024)
        ws.close(1013, 'Клиент не успевает получать данные');
      else if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.heartbeat);
    await this.deviceOperations;
    await this.disconnectDevice();
    for (const ws of this.clients.keys()) ws.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
