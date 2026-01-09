import { SerialPort } from "serialport";

/**
 * Менеджер для работы с COM-портом стабилометра
 */
export class SerialPortManager {
  constructor() {
    this.port = null;
    this.dataCallback = null;
    this.errorCallback = null;

    this.stats = {
      rawBytesReceived: 0,
      packetsReceived: 0,   // здесь считаем "сырые пакеты", если хочешь
      errorsCount: 0,
      startTime: null,
    };
  }

  /**
   * Получить список всех доступных COM-портов
   */
  async listPorts() {
    try {
      const ports = await SerialPort.list();
      console.log(`\n📋 Найдено COM-портов: ${ports.length}`);

      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer || "Неизвестно",
        serialNumber: p.serialNumber || "N/A",
        productId: p.productId,
        vendorId: p.vendorId,
        description: p.friendlyName || p.pnpId || "Без описания",
      }));
    } catch (error) {
      console.error("❌ Ошибка получения списка портов:", error);
      throw error;
    }
  }

  /**
   * Подключиться к COM-порту
   * @param {Object} config - Конфигурация порта
   */
  async connect(config = {}) {
    const {
      portPath = null,
      baudRate = 9600,
      dataBits = 8,
      stopBits = 1,
      parity = "none",
    } = config;

    if (this.port?.isOpen) {
      throw new Error("Порт уже открыт. Сначала отключитесь.");
    }

    // Если путь не указан, берем первый доступный порт
    let selectedPort = portPath;
    if (!selectedPort) {
      const ports = await this.listPorts();
      if (ports.length === 0) {
        throw new Error("COM-порты не найдены. Проверьте подключение устройства.");
      }
      selectedPort = ports[0].path;
      console.log(`\n🔌 Автоматически выбран порт: ${selectedPort}`);
    }

    return new Promise((resolve, reject) => {
      // Сброс статистики
      this.stats = {
        rawBytesReceived: 0,
        packetsReceived: 0,
        errorsCount: 0,
        startTime: Date.now(),
      };

      this.port = new SerialPort({
        path: selectedPort,
        baudRate,
        dataBits,
        stopBits,
        parity,
        autoOpen: false,
      });

      this.port.open((err) => {
        if (err) {
          console.error("❌ Ошибка открытия порта:", err.message);
          reject(new Error(`Не удалось открыть порт: ${err.message}`));
          return;
        }

        console.log("\n✅ COM-ПОРТ ОТКРЫТ УСПЕШНО");
        console.log("┌─────────────────────────────────────────┐");
        console.log(`│ 📍 Порт: ${selectedPort}`);
        console.log(`│ ⚡ Скорость: ${baudRate} бод`);
        console.log(`│ 📊 Формат: ${dataBits}${parity[0].toUpperCase()}${stopBits}`);
        console.log("│ 📦 Ожидаемый формат: #1111222233334444555#&");
        console.log("└─────────────────────────────────────────┘");
        console.log("⏳ Ожидаю данные от стабилометра...\n");

        let firstDataReceived = false;
        let debugCounter = 0;

        // ============================================================================
        // ОБРАБОТКА СЫРЫХ ДАННЫХ: мы НЕ парсим здесь, только читаем строки
        // ============================================================================
        this.port.on("data", (rawData) => {
          if (!firstDataReceived) {
            firstDataReceived = true;
            console.log("\n🎉 ПЕРВЫЙ КОНТАКТ С УСТРОЙСТВОМ!\n");
          }

          this.stats.rawBytesReceived += rawData.length;

          const showDetailedLog = debugCounter % 5 === 0;
          debugCounter++;

          if (showDetailedLog) {
            console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log("📥 ПОЛУЧЕНЫ СЫРЫЕ ДАННЫЕ:");
            console.log(`   HEX: ${rawData.toString("hex")}`);
            console.log(`   ASCII: ${rawData.toString("ascii")}`);
            console.log(`   Длина: ${rawData.length} байт`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          }

          // Преобразуем в строку и передаем вверх
          const dataString = rawData.toString("utf8");

          // Считаем "пакетов" условно по количеству вызовов data
          this.stats.packetsReceived++;

          // Передаем сырые данные наверх — в server.js, где уже работает StabilogramParser
          if (this.dataCallback) {
            this.dataCallback(dataString);
          }

          if (this.stats.packetsReceived > 0 && this.stats.packetsReceived % 50 === 0) {
            this.printStatistics();
          }
        });

        // ============================================================================
        // ОБРАБОТЧИКИ СОБЫТИЙ ПОРТА
        // ============================================================================
        this.port.on("error", (err) => {
          console.error("\n❌ ОШИБКА ПОРТА:", err.message);
          this.stats.errorsCount++;

          if (this.errorCallback) {
            this.errorCallback(err.message);
          }
        });

        this.port.on("close", () => {
          console.log("\n📴 ПОРТ ЗАКРЫТ");
          this.printStatistics();
        });

        this.port.on("drain", () => {
          console.log("💧 Буфер отправки очищен");
        });

        resolve({
          port: selectedPort,
          baudRate,
          dataBits,
          stopBits,
          parity,
          description: `Стабилометр на ${selectedPort}`,
        });
      });
    });
  }

  /**
   * Отправить данные в порт (если нужно что‑то посылать устройству)
   */
  async send(data) {
    if (!this.port?.isOpen) {
      throw new Error("Порт не открыт");
    }

    return new Promise((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) {
          console.error("❌ Ошибка отправки:", err);
          reject(err);
        } else {
          console.log(`📤 Отправлено: ${data}`);
          resolve();
        }
      });
    });
  }

  /**
   * Отключиться от COM-порта
   */
  async disconnect() {
    if (!this.port) {
      return;
    }

    return new Promise((resolve) => {
      if (this.port.isOpen) {
        this.port.close((err) => {
          if (err) {
            console.error("⚠️  Ошибка при закрытии порта:", err.message);
          } else {
            console.log("✅ Порт закрыт успешно");
          }

          this.port = null;
          this.dataCallback = null;
          resolve();
        });
      } else {
        this.port = null;
        this.dataCallback = null;
        resolve();
      }
    });
  }

  /**
   * Установить коллбэк для получения данных (сырые строки)
   */
  onData(callback) {
    console.log("🔧 Установлен callback для данных");
    this.dataCallback = callback;
  }

  /**
   * Установить коллбэк для ошибок
   */
  onError(callback) {
    console.log("🔧 Установлен callback для ошибок");
    this.errorCallback = callback;
  }

  /**
   * Проверить, открыт ли порт
   */
  isConnected() {
    return this.port?.isOpen || false;
  }

  /**
   * Получить текущую статистику
   */
  getStatistics() {
    const runtime = this.stats.startTime
      ? Math.floor((Date.now() - this.stats.startTime) / 1000)
      : 0;

    const packetsPerSecond =
      runtime > 0 ? (this.stats.packetsReceived / runtime).toFixed(2) : 0;

    return {
      ...this.stats,
      runtime,
      packetsPerSecond,
    };
  }

  /**
   * Вывести статистику в консоль
   */
  printStatistics() {
    const stats = this.getStatistics();

    console.log("\n📊 СТАТИСТИКА РАБОТЫ:");
    console.log("┌─────────────────────────────────────────┐");
    console.log(`│ ⏱️  Время работы: ${stats.runtime} сек`);
    console.log(`│ 📥 Байт получено: ${stats.rawBytesReceived}`);
    console.log(`│ 📦 Чтений data-события: ${stats.packetsReceived}`);
    console.log(`│ 📈 Чтений/сек: ${stats.packetsPerSecond}`);
    console.log(`│ ❌ Ошибок: ${stats.errorsCount}`);
    console.log("└─────────────────────────────────────────┘\n");
  }

  /**
   * Сбросить статистику
   */
  resetStatistics() {
    this.stats = {
      rawBytesReceived: 0,
      packetsReceived: 0,
      errorsCount: 0,
      startTime: Date.now(),
    };
    console.log("📊 Статистика сброшена");
  }
}

// ============================================================================
// УТИЛИТЫ ДЛЯ ОТЛАДКИ (если хочешь симулировать без реального порта)
// ============================================================================

/**
 * Создать фейковый генератор данных для тестирования (на уровне SerialPortManager)
 * Здесь мы имитируем, что устройство шлёт строки, а дальше их парсит сервер.
 */
export function createMockDataGenerator(manager) {
  let counter = 0;

  return {
    start(interval = 100) {
      console.log("🎮 Запуск генератора тестовых данных (mock SerialPort)");

      const timer = setInterval(() => {
        // Очень простая заглушка: одно "правильное" сырое сообщение
        const packet = "#ABCDABCDABCDABCDABC#&";

        if (manager.dataCallback) {
          manager.dataCallback(packet);
        }

        counter++;

        if (counter >= 360) {
          clearInterval(timer);
          console.log("🏁 Генератор завершил работу");
        }
      }, interval);

      return timer;
    },
  };
}
