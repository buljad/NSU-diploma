import { WebSocketServer } from "ws";
import { SerialPortManager } from "./serialPort.js";
import { StabilogramParser } from "./dataParser.js";  // Удаляем createTestGenerator
import dotenv from "dotenv";

// Загружаем переменные окружения
dotenv.config();

const WS_PORT = process.env.WS_PORT || 8081;
const serialManager = new SerialPortManager();

// Создаем WebSocket сервер
const wss = new WebSocketServer({
  port: WS_PORT,
  clientTracking: true,
});

console.log("╔════════════════════════════════════════╗");
console.log("║   🚀 Сервер стабилометра запущен     ║");
console.log("║   📏 ИСПРАВЛЕННАЯ СТРУКТУРА ДАННЫХ    ║");
console.log("╚════════════════════════════════════════╝");
console.log(`📡 WebSocket сервер: ws://localhost:${WS_PORT}`);
console.log(`⏰ Время запуска: ${new Date().toLocaleString("ru-RU")}\n`);

/**
 * Создание тестового генератора (простая версия)
 */
function createSimpleTestGenerator() {
  let packetCounter = 0;
  
  return {
    generateTestPacket() {
      // Генерируем движение по кругу
      const angle = (packetCounter / 36) * 2 * Math.PI;
      const centerX = 0; // Центрированные значения 
      const centerY = 0;
      const radius = 50000; // 50мм в микрометрах
      
      const x = Math.round(centerX + radius * Math.cos(angle));
      const y = Math.round(centerY + radius * Math.sin(angle));
      const z = Math.round(1000 + 500 * Math.sin(angle * 2));
      const f = 500;
      
      packetCounter = (packetCounter + 1) % 36;
      
      return {
        raw: { x: x + 8388608, y: y + 8388608, z: z, f: f }, // Добавляем offset для сырых
        centered_raw: { x, y, z, f },
        mm: { 
          x: x / 1000, 
          y: y / 1000, 
          z: z / 1000, 
          f: f / 1000 
        },
        status: 1,
        deviceTime: packetCounter * 10,
        packetNumber: packetCounter,
        timestamp: Date.now(),
        _raw_packet: `fake_test_packet_${packetCounter}&`
      };
    }
  };
}

/**
 * Отправка сообщения всем подключенным клиентам
 */
function broadcastToClients(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

/**
 * Отправка сообщения клиенту
 */
function sendMessage(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

/**
 * Подключение нового клиента
 */
wss.on("connection", (ws, request) => {
  const clientIp = request.socket.remoteAddress;
  console.log(`✅ Новый клиент подключился: ${clientIp}`);
  console.log(`   Всего клиентов: ${wss.clients.size}`);

  // Отправляем приветственное сообщение
  sendMessage(ws, "WELCOME", {
    message: "Подключено к серверу стабилометра",
    version: "3.0 (исправленная структура данных)",
    timestamp: Date.now(),
  });

  /**
   * Обработка сообщений от клиента
   */
  ws.on("message", async (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      console.error("❌ Невалидный JSON от клиента");
      sendMessage(ws, "ERROR", { message: "Невалидный формат сообщения" });
      return;
    }

    console.log(`📨 Получено сообщение: ${data.type}`);

    // Обработка разных типов команд
    switch (data.type) {
      // Запрос списка доступных портов
      case "LIST_PORTS":
        try {
          const ports = await serialManager.listPorts();
          console.log(`📋 Найдено портов: ${ports.length}`);
          sendMessage(ws, "PORTS_LIST", { ports });
        } catch (error) {
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Подключение к COM-порту или запуск тестового режима
      case "CONNECT":
        try {
          const config = {
            portPath: data.portPath,
            baudRate: data.baudRate || parseInt(process.env.BAUD_RATE) || 9600,
            dataBits: data.dataBits || parseInt(process.env.DATA_BITS) || 8,
            stopBits: data.stopBits || parseInt(process.env.STOP_BITS) || 1,
            parity: data.parity || process.env.PARITY || "none",
            testMode: data.testMode || false,
            scaleFactor: data.scaleFactor || 1000, 
          };

          // ✅ ТЕСТОВЫЙ РЕЖИМ
          if (config.testMode) {
            console.log("\n🧪 ЗАПУСК ТЕСТОВОГО РЕЖИМА\n");

            // Создаем простой генератор
            const generator = createSimpleTestGenerator();

            // Запускаем генерацию тестовых данных
            const testInterval = setInterval(() => {
              try {
                // Генерируем тестовый пакет
                const parsed = generator.generateTestPacket();

                // ✅ ИСПРАВЛЕННАЯ структура сообщения для клиента
                const messageForClient = {
                  type: "DATA",
                  raw: parsed._raw_packet,
                  parsed: {
                    raw: parsed._raw_packet,
                    timestamp: parsed.timestamp,
                    coordinates: {
                      coord1: parsed.raw.x,     // ✅ Правильные поля
                      coord2: parsed.raw.y,
                      coord3: parsed.raw.z,     // ✅ Было force
                      coord4: parsed.raw.f,     // ✅ Было extra
                    },
                    deviceTime: parsed.deviceTime,
                    interpretation: {
                      variant1: {
                        x: parsed.raw.x,
                        y: parsed.raw.y,
                        force: parsed.raw.z,    // ✅ Маппим z -> force для совместимости
                        extra: parsed.raw.f,    // ✅ Маппим f -> extra
                        time: parsed.deviceTime,
                      },
                      variant2: {
                        x: parsed.centered_raw.x,
                        y: parsed.centered_raw.y,
                        force: parsed.centered_raw.z, // ✅ Маппим z -> force
                        extra: parsed.centered_raw.f, // ✅ Маппим f -> extra 
                        time: parsed.deviceTime,
                      },
                      variant3: {
                        x: parsed.mm.x * 1000, // мм → микрометры
                        y: parsed.mm.y * 1000,
                        force: parsed.mm.z * 1000, // ✅ Маппим z -> force
                        extra: parsed.mm.f * 1000,  // ✅ Маппим f -> extra
                        time: parsed.deviceTime,
                      },
                      mm: {
                        x: parsed.mm.x,
                        y: parsed.mm.y,
                        force: parsed.mm.z,  // ✅ Маппим z -> force
                        extra: parsed.mm.f,  // ✅ Маппим f -> extra
                        time: parsed.deviceTime,
                      },
                    },
                  },
                  timestamp: parsed.timestamp,
                };

                broadcastToClients(messageForClient);

                console.log(
                  `✅ Тестовые данные: X=${parsed.mm.x.toFixed(2)}мм, Y=${parsed.mm.y.toFixed(2)}мм`
                );
              } catch (error) {
                console.error("❌ Ошибка в тестовом режиме:", error);
              }
            }, 200); // 200мс = 5Hz

            // Сохраняем ссылки для управления
            ws.testInterval = testInterval;
            ws.isTestMode = true;

            // Отправляем подтверждение подключения
            sendMessage(ws, "CONNECTED", {
              portInfo: {
                port: "TEST_MODE",
                baudRate: "Симуляция 5Hz",
                testMode: true,
                description: "Генерация тестовых данных (круг радиус 50мм)"
              },
            });

            console.log("✅ Тестовый режим активен - генерация данных запущена (5Hz)\n");
            return;
          }

          // ===== РЕАЛЬНЫЙ РЕЖИМ =====
          console.log("📡 Подключение к реальному COM-порту...\n");

          // ✅ Создаем парсер для реального режима
          const realParser = new StabilogramParser();
          realParser.setMode("normal");
          realParser.setLogLevel("minimal");
          realParser.setScaleFactor(config.scaleFactor);
          ws.realParser = realParser;

          // ✅ Устанавливаем обработчик данных COM-порта
          serialManager.onData((rawData) => {
            const parsedPackets = realParser.addData(rawData);

            parsedPackets.forEach((parsed) => {
              // ✅ ИСПРАВЛЕННАЯ структура для реальных данных
              const messageForClient = {
                type: "DATA",
                raw: parsed._raw_packet,
                parsed: {
                  raw: parsed._raw_packet,
                  timestamp: parsed.timestamp,
                  coordinates: {
                    coord1: parsed.raw.x,
                    coord2: parsed.raw.y,
                    coord3: parsed.raw.z,    // ✅ Правильное поле
                    coord4: parsed.raw.f,    // ✅ Правильное поле
                  },
                  deviceTime: parsed.deviceTime,
                  interpretation: {
                    variant1: {
                      x: parsed.raw.x,
                      y: parsed.raw.y,
                      force: parsed.raw.z,    // ✅ Маппим для совместимости
                      extra: parsed.raw.f,
                      time: parsed.deviceTime,
                    },
                    variant2: {
                      x: parsed.centered_raw.x,
                      y: parsed.centered_raw.y,
                      force: parsed.centered_raw.z, // ✅ Маппим для совместимости
                      extra: parsed.centered_raw.f,
                      time: parsed.deviceTime,
                    },
                    variant3: {
                      x: parsed.mm.x * 1000,
                      y: parsed.mm.y * 1000,
                      force: parsed.mm.z * 1000,  // ✅ Маппим для совместимости
                      extra: parsed.mm.f * 1000,
                      time: parsed.deviceTime,
                    },
                    mm: {
                      x: parsed.mm.x,
                      y: parsed.mm.y,
                      force: parsed.mm.z,  // ✅ Маппим для совместимости
                      extra: parsed.mm.f,
                      time: parsed.deviceTime,
                    },
                  },
                },
                timestamp: parsed.timestamp,
              };

              broadcastToClients(messageForClient);

              console.log(
                `📤 X=${parsed.mm.x.toFixed(2)}мм, Y=${parsed.mm.y.toFixed(2)}мм`
              );
            });
          });

          // Обработчик ошибок COM-порта
          serialManager.onError((error) => {
            console.error("❌ Ошибка COM-порта:", error);
            broadcastToClients({
              type: "SERIAL_ERROR",
              message: error.message || error,
            });
          });

          // Подключаемся к реальному порту
          const portInfo = await serialManager.connect(config);

          sendMessage(ws, "CONNECTED", { portInfo });
          console.log("✅ Реальный COM-порт подключен и готов к передаче данных\n");
        } catch (error) {
          console.error("❌ Ошибка подключения:", error.message);
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Отключение от COM-порта или остановка тестового режима
      case "DISCONNECT":
        try {
          if (ws.isTestMode && ws.testInterval) {
            clearInterval(ws.testInterval);
            ws.testInterval = null;
            ws.isTestMode = false;
            console.log("🧪 Тестовый режим остановлен по команде пользователя\n");

            sendMessage(ws, "DISCONNECTED", {
              message: "Тестовый режим отключен",
              testMode: true,
            });
          } else {
            await serialManager.disconnect();
            ws.realParser = null;
            console.log("✅ COM-порт отключен по команде пользователя\n");

            sendMessage(ws, "DISCONNECTED", {
              message: "Отключено от COM-порта",
              testMode: false,
            });
          }
        } catch (error) {
          console.error("❌ Ошибка отключения:", error.message);
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Выполнить калибровку нуля (только для реального режима)
      case "CALIBRATE_ZERO":
        try {
          if (ws.realParser) {
            console.log("🎯 Калибровка нуля запрошена клиентом...");
            const result = ws.realParser.performZeroCalibration();

            sendMessage(ws, "CALIBRATION_RESULT", {
              success: result.success,
              message: result.message,
              calibration: result.success ? result.calibration : null,
              stability: result.stability,
            });
          } else {
            sendMessage(ws, "ERROR", {
              message: "Калибровка доступна только в режиме реального устройства",
            });
          }
        } catch (error) {
          console.error("❌ Ошибка калибровки:", error.message);
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Проверка статуса подключения
      case "CHECK_STATUS":
        const isConnected = ws.isTestMode || serialManager.isConnected();
        const stats = ws.realParser?.getStats() || null;

        sendMessage(ws, "STATUS", {
          connected: isConnected,
          testMode: ws.isTestMode || false,
          stats,
        });
        break;

      // Получить полный анализ
      case "GET_ANALYSIS":
        try {
          const parser = ws.realParser;
          if (parser) {
            const analysis = parser.getFullAnalysis();
            sendMessage(ws, "FULL_ANALYSIS", {
              summary: analysis.statistics,
              calibration: analysis.calibration,
              stability: analysis.stability,
              sampleCount: analysis.samples.length,
            });
          } else {
            sendMessage(ws, "ERROR", {
              message: "Парсер не инициализирован",
            });
          }
        } catch (error) {
          console.error("❌ Ошибка анализа:", error.message);
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Сброс анализатора
      case "RESET_ANALYZER":
        try {
          const parser = ws.realParser;
          if (parser) {
            parser.resetAnalyzer();
            sendMessage(ws, "ANALYZER_RESET", {
              message: "Анализатор сброшен",
            });
          }
        } catch (error) {
          console.error("❌ Ошибка сброса:", error.message);
          sendMessage(ws, "ERROR", { message: error.message });
        }
        break;

      // Неизвестная команда
      default:
        console.warn(`⚠️  Неизвестная команда: ${data.type}`);
        sendMessage(ws, "ERROR", {
          message: `Неизвестная команда: ${data.type}`,
        });
    }
  });

  /**
   * Обработка ошибок WebSocket
   */
  ws.on("error", (error) => {
    console.error("❌ WebSocket ошибка:", error.message);
  });

  /**
   * Отключение клиента
   */
  ws.on("close", async () => {
    console.log(`❌ Клиент отключился: ${clientIp}`);
    console.log(`   Осталось клиентов: ${wss.clients.size}`);

    if (ws.testInterval) {
      clearInterval(ws.testInterval);
      ws.testInterval = null;
      console.log("🧪 Тестовый режим остановлен при отключении клиента");
    }

    if (wss.clients.size === 0 && serialManager.isConnected()) {
      console.log("ℹ️  Последний клиент отключился, закрываем COM-порт...");
      await serialManager.disconnect();
    }
  });
});

/**
 * Обработка ошибок сервера
 */
wss.on("error", (error) => {
  console.error("❌ Ошибка WebSocket сервера:", error);
});

/**
 * Корректное завершение работы
 */
process.on("SIGINT", async () => {
  console.log("\n\n⚠️  Получен сигнал SIGINT, завершаем работу...");

  wss.clients.forEach((client) => {
    if (client.testInterval) {
      clearInterval(client.testInterval);
      console.log("🧪 Остановлен тестовый режим клиента");
    }
  });

  if (serialManager.isConnected()) {
    await serialManager.disconnect();
  }

  wss.close(() => {
    console.log("✅ WebSocket сервер остановлен");
    process.exit(0);
  });
});

// Обработка необработанных исключений
process.on("uncaughtException", (error) => {
  console.error("❌ Необработанное исключение:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Необработанный reject Promise:", reason);
});

console.log("🎯 Сервер готов к подключениям!");
console.log("💡 Поддерживаемые команды:");
console.log("   - LIST_PORTS: Получить список доступных портов");
console.log("   - CONNECT: Подключиться к порту или тесту");
console.log("   - DISCONNECT: Отключиться");
console.log("   - CALIBRATE_ZERO: Выполнить калибровку нуля");
console.log("   - CHECK_STATUS: Проверить статус");
console.log("   - GET_ANALYSIS: Получить полный анализ");
console.log("   - RESET_ANALYZER: Сбросить анализатор");
console.log("");