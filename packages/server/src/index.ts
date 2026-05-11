// packages/server/src/index.ts

import { WebSocketServer, WebSocket } from "ws";
import { SerialPort } from "serialport";
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
  type PortInfo,
} from "@stabilometer/shared";
import {
  CalibrationStorage,
  type StoredCalibration,
} from "./CalibrationStorage.js";

interface ClientState {
  ws: WebSocket;
  isAlive: boolean;
}

class StabilogramServer {
  private wss: WebSocketServer;
  private clients: Set<ClientState> = new Set();
  private serialPort: SerialPort | null = null;

  // Обработка данных
  private parser: PacketParser;
  private copCalculator: CoPCalculator;  // ✅ ИСПРАВЛЕНО: CoPCalculator для расчета CoP
  private copFilter: CoPSmartFilter;      // ✅ ИСПРАВЛЕНО: CoPSmartFilter для фильтрации
  private axisTransform: AxisTransform;

  // Конфигурация
  private platformSize = { ...PLATFORM_SIZE };
  private sensorDistance = { ...SENSOR_DISTANCE };
  private axisConfig: AxisConfiguration;

  // Калибровка
  private isCalibrated: boolean = false;
  private isCalibrating: boolean = false;
  private calibrationSamples: SensorData[] = [];
  private readonly calibrationSampleCount = 200;

  // Тестовый режим
  private testMode: boolean = false;
  private testInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.parser = new PacketParser({
      filterOutliers: false,
    });

    // ✅ ИСПРАВЛЕНО: CoPCalculator для расчета координат
    this.copCalculator = new CoPCalculator({
      sensorDistanceX: this.sensorDistance.x,
      sensorDistanceY: this.sensorDistance.y,
    });

    // ✅ ИСПРАВЛЕНО: CoPSmartFilter для фильтрации (без параметров)
    this.copFilter = new CoPSmartFilter();

    this.axisConfig = {
      swapXY: true,
      invertX: false,
      invertY: false,
      rotationDeg: 0,
    };

    this.axisTransform = new AxisTransform(this.axisConfig);

    this.loadStoredCalibration();

    this.wss = new WebSocketServer({ port: WEBSOCKET_PORT });
    this.setupWebSocket();

    console.log(
      `🚀 WebSocket сервер запущен на ws://localhost:${WEBSOCKET_PORT}`,
    );
  }

  private loadStoredCalibration(): void {
    const stored = CalibrationStorage.load();
    if (stored) {
      this.copCalculator.setOffsets(stored.sensorOffsets);
      this.platformSize = stored.platformSize;
      this.sensorDistance = stored.sensorDistance;
      this.copCalculator.configure({
        sensorDistanceX: stored.sensorDistance.x,
        sensorDistanceY: stored.sensorDistance.y,
      });
      this.isCalibrated = true;
      console.log("📐 Калибровка применена из файла");

      console.log(
        "🔍 Анализ загруженных offset'ов:",
        this.analyzeOffsets(stored.sensorOffsets),
      );
    } else {
      console.log(
        "⚠️ Калибровка не найдена. Выполните калибровку на пустой платформе!",
      );
    }
  }

  private analyzeOffsets(offsets: SensorData): {
    min: number;
    max: number;
    range: number;
    average: number;
    isBalanced: boolean;
  } {
    const values = [offsets.d1, offsets.d2, offsets.d3, offsets.d4];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const average = values.reduce((a, b) => a + b, 0) / 4;

    const isBalanced = range < average * 0.5;

    return { min, max, range, average, isBalanced };
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      const clientState: ClientState = { ws, isAlive: true };
      this.clients.add(clientState);

      ws.on("message", (data: Buffer) => {
        this.handleClientMessage(clientState, data.toString());
      });

      ws.on("close", () => {
        this.clients.delete(clientState);
      });

      ws.on("pong", () => {
        clientState.isAlive = true;
      });

      this.sendToClient(ws, {
        type: "CONNECTED",
        serialConnected: this.serialPort !== null && this.serialPort.isOpen,
        calibrated: this.isCalibrated,
        axisConfig: this.axisConfig,
        platformSize: this.platformSize,
        sensorDistance: this.sensorDistance,
      });
    });

    setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ws.ping();
      });
    }, 30000);
  }

  private handleClientMessage(client: ClientState, message: string): void {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case "CONNECT":
          this.connectToSerialPort(data.portPath, data.baudRate, data.testMode);
          break;
        case "DISCONNECT":
          this.disconnectSerialPort();
          break;
        case "CALIBRATE_ZERO":
          this.startCalibration();
          break;
        case "CONFIGURE_AXES":
          this.configureAxes(data);
          break;
        case "LIST_PORTS":
          this.listPorts(client.ws);
          break;
        case "PING":
          this.sendToClient(client.ws, { type: "PONG", timestamp: Date.now() });
          break;
        case "DIAGNOSE_SENSORS":
          this.diagnoseSensors(client.ws);
          break;
      }
    } catch (error) {
      console.error("Ошибка обработки сообщения:", error);
    }
  }

  private diagnoseSensors(ws: WebSocket): void {
    if (!this.serialPort?.isOpen) {
      this.sendToClient(ws, {
        type: "ERROR",
        error: "Устройство не подключено",
      });
      return;
    }

    const testSensors: SensorData = {
      d1: 50000,
      d2: 60000,
      d3: 55000,
      d4: 52000,
    };
    const diagnosis = this.copCalculator.calculate(testSensors);

    this.sendToClient(ws, {
      type: "SENSOR_DIAGNOSIS",
      diagnosis: diagnosis,
      offsets: this.copCalculator.getOffsets(),
      analysis: this.analyzeOffsets(this.copCalculator.getOffsets()),
    });
  }

  private async listPorts(ws: WebSocket): Promise<void> {
    try {
      const ports = await SerialPort.list();
      const portList: PortInfo[] = ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        vendorId: p.vendorId,
        productId: p.productId,
      }));
      this.sendToClient(ws, { type: "PORTS_LIST", ports: portList });
    } catch (error) {
      this.sendToClient(ws, {
        type: "ERROR",
        error: "Не удалось получить список портов",
      });
    }
  }

  private connectToSerialPort(
    portPath: string,
    baudRate: number = DEFAULT_BAUD_RATE,
    testMode: boolean = false,
  ): void {
    this.testMode = testMode;

    if (testMode) {
      this.startTestMode();
      this.broadcast({ type: "SERIAL_CONNECTED", testMode: true });
      return;
    }

    if (!portPath) return;

    if (this.serialPort?.isOpen) {
      this.serialPort.close();
    }

    try {
      this.serialPort = new SerialPort({ path: portPath, baudRate });

      this.serialPort.on("open", () => {
        console.log(`✅ Порт ${portPath} открыт`);
        this.broadcast({ type: "SERIAL_CONNECTED", port: portPath });
      });

      this.serialPort.on("data", (data: Buffer) => {
        this.handleSerialData(data);
      });

      this.serialPort.on("close", () => {
        this.broadcast({ type: "SERIAL_DISCONNECTED" });
      });
    } catch (error) {
      console.error("❌ Не удалось открыть порт:", error);
    }
  }

  private disconnectSerialPort(): void {
    if (this.testInterval) {
      clearInterval(this.testInterval);
      this.testInterval = null;
      console.log("🔄 Тестовый режим остановлен");
    }

    if (this.serialPort?.isOpen) {
      this.serialPort.close();
    }

    this.serialPort = null;
    this.testMode = false;

    this.broadcast({ type: "SERIAL_DISCONNECTED" });
    console.log("❌ Устройство отключено");
  }

  private startTestMode(): void {
    let angle = 0;
    let packetNumber = 0;

    this.testInterval = setInterval(() => {
      const radius = 50;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      const mm = { x, y };

      const sample: StabilogramSample = {
        sensors: { d1: 1000, d2: 1000, d3: 1000, d4: 1000 },
        raw: { x, y, z: 0, f: 4000 },
        centered: { x, y, z: 0, f: 4000 },
        filtered: { x, y, z: 0, f: 4000 },
        mm: mm,
        deviceTime: Date.now(),
        clientTime: Date.now(),
        packetNumber: packetNumber++,
      };

      this.broadcast({ type: "DATA", data: sample });

      angle += 0.05;
      if (angle > Math.PI * 2) angle = 0;
    }, 20);
  }

  private handleSerialData(data: Buffer): void {
    this.parser.addData(new Uint8Array(data));
    const packets = this.parser.parseAll();

    for (const packet of packets) {
      if (!packet.isValid) continue;

      // ✅ ШАГ 1: Вычисляем сырые координаты CoP
      const rawCoP = this.copCalculator.calculate(packet.sensors);

      // ✅ ШАГ 2: Трансформируем оси
      const centered = this.axisTransform.transform(rawCoP);

      // ✅ ШАГ 3: Фильтруем выбросы медианным фильтром
      const filteredCoP = this.copFilter.filter(centered, Date.now());

      // ✅ ШАГ 4: Формируем финальные координаты
      const mm = {
        x: filteredCoP.x,
        y: filteredCoP.y,
      };

      const sample: StabilogramSample = {
        sensors: packet.sensors,
        raw: rawCoP,
        centered: centered,
        filtered: { x: filteredCoP.x, y: filteredCoP.y, z: 0, f: centered.f },
        mm: mm,
        deviceTime: packet.deviceTime,
        clientTime: Date.now(),
        packetNumber: packet.packetNumber,
      };

      if (this.isCalibrating) {
        this.calibrationSamples.push(packet.sensors);

        this.broadcast({
          type: "CALIBRATION_PROGRESS",
          progress: this.calibrationSamples.length,
          total: this.calibrationSampleCount,
        });

        if (this.calibrationSamples.length >= this.calibrationSampleCount) {
          this.finishCalibration();
        }
      }

      this.broadcast({ type: "DATA", data: sample });
    }
  }

  private startCalibration(): void {
    if (this.testMode) {
      this.broadcast({
        type: "ERROR",
        error: "Калибровка недоступна в тестовом режиме",
      });
      return;
    }

    this.isCalibrating = true;
    this.calibrationSamples = [];

    console.log("🔧 Начинаем калибровку... Убедитесь, что платформа пуста!");
    this.broadcast({ type: "CALIBRATION_STARTED" });
  }

  private finishCalibration(): void {
    this.isCalibrating = false;

    if (this.calibrationSamples.length < 10) {
      console.error("❌ Недостаточно сэмплов для калибровки");
      this.broadcast({
        type: "ERROR",
        error: "Недостаточно данных для калибровки",
      });
      return;
    }

    const median = (arr: number[]): number => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const rawOffsets: SensorData = {
      d1: median(this.calibrationSamples.map((s) => s.d1)),
      d2: median(this.calibrationSamples.map((s) => s.d2)),
      d3: median(this.calibrationSamples.map((s) => s.d3)),
      d4: median(this.calibrationSamples.map((s) => s.d4)),
    };

    console.log("📊 Сырые offset'ы:", rawOffsets);

    const minOffset = Math.min(
      rawOffsets.d1,
      rawOffsets.d2,
      rawOffsets.d3,
      rawOffsets.d4,
    );

    const offsets: SensorData = {
      d1: rawOffsets.d1 - minOffset + 1000,
      d2: rawOffsets.d2 - minOffset + 1000,
      d3: rawOffsets.d3 - minOffset + 1000,
      d4: rawOffsets.d4 - minOffset + 1000,
    };

    console.log("✅ Нормализованные offset'ы:", offsets);

    const analysis = this.analyzeOffsets(offsets);
    console.log("📈 Анализ калибровки:", analysis);

    if (!analysis.isBalanced) {
      console.warn("⚠️ ПРЕДУПРЕЖДЕНИЕ: Калибровка не сбалансирована!");
      console.warn(
        "💡 Рекомендация: Повторите калибровку на полностью пустой платформе",
      );
    }

    this.copCalculator.setOffsets(offsets);
    this.isCalibrated = true;

    const storedCalibration: StoredCalibration = {
      sensorOffsets: offsets,
      platformSize: this.platformSize,
      sensorDistance: this.sensorDistance,
      createdAt: new Date().toISOString(),
    };

    CalibrationStorage.save(storedCalibration);

    this.broadcast({
      type: "CALIBRATION_COMPLETE",
      calibration: {
        sensorOffsets: offsets,
        platformSize: this.platformSize,
        sensorDistance: this.sensorDistance,
        timestamp: Date.now(),
        sampleCount: this.calibrationSamples.length,
        isValid: true,
      },
      analysis: analysis,
      rawOffsets: rawOffsets,
    });

    console.log("✅ Калибровка завершена успешно!");
  }

  private configureAxes(config: AxisConfiguration): void {
    this.axisConfig = { ...config };
    this.axisTransform.updateConfig(this.axisConfig);
    this.broadcast({ type: "AXES_CONFIGURED", config: this.axisConfig });
    console.log("⚙️ Конфигурация осей обновлена:", this.axisConfig);
  }

  private broadcast(message: Record<string, any>): void {
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
    });
  }

  private sendToClient(ws: WebSocket, message: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  shutdown(): void {
    if (this.testInterval) clearInterval(this.testInterval);
    if (this.serialPort?.isOpen) this.serialPort.close();
    this.wss.close();
    console.log("🛑 Сервер остановлен");
  }
}

const server = new StabilogramServer();

process.on("SIGINT", () => {
  server.shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.shutdown();
  process.exit(0);
});