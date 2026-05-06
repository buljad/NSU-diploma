# 🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER v2.0

[CRITICAL INSTRUCTION FOR ALL LLMs]

You are an expert Senior Fullstack & Real-Time Systems Developer. This document is your Absolute Single Source of Truth (SSoT) for the "Stabilometer" project. You MUST read, understand, and strictly follow every rule, architecture pattern, and anti-pattern described here before generating any code or analyzing any bug.

1. ДОМЕННАЯ ОБЛАСТЬ И ФИЗИКА СИСТЕМЫ

Проект — аппаратно-программный комплекс класса "Soft Real-Time" для медицинской диагностики и реабилитации (оценка баланса человека).

    Оборудование: Платформа с 4 тензодатчиками (d1, d2, d3, d4).
    Топология: [Hardware (COM-port, 50-100Hz)] ===> [Node.js Server] ===(WebSocket)===> [SvelteKit SPA Client (60-144Hz)].
    Метрики: X, Y (координаты Центра Давления - CoP), Z (резерв, 0), F (общая сила/вес пациента).
    Главный инженерный вызов: Разрыв частот. Оборудование шлет пакеты каждые 10-20 мс (с физическим шумом и дрейфом датчиков). Браузер клиента (Canvas) отрисовывает кадры каждые 6.9 - 16.6 мс. Задача ПО — обеспечить строгую математическую фильтрацию шума и идеально плавную визуализацию (экстраполяцию) без разрывов и "телепортаций" маркера на экране.

Схема расположения датчиков:

text

       Y+ (вперёд)
         ↑
    ┌────┴────┐
    │ D1   D2 │
    │    ●    │  ← Центр платформы (0, 0)
    │ D4   D3 │
    └────┬────┘
         ↓
       Y- (назад)

   X- ←───────→ X+
 (лево)      (право)

1. АРХИТЕКТУРА MONOREPO И СБОРКА

Проект использует pnpm workspaces. Пересечение зон ответственности между пакетами СТРОГО ЗАПРЕЩЕНО.

text

stabilometer/
├── pnpm-workspace.yaml
├── packages/
│ ├── shared/ # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│ │ └── src/
│ │ ├── types.ts # Контракты (StabilogramSample, AxisConfig)
│ │ ├── constants.ts # PACKET_LENGTH, WEBSOCKET_PORT, SENSOR_DISTANCE
│ │ ├── RingBuffer.ts # Memory-safe буферы
│ │ ├── PacketParser.ts # Распаковка 6-bit ASCII
│ │ ├── AxisTransform.ts # Вращение и инверсия координат
│ │ └── CoPCalculator.ts # Вычисление центра давления с защитой от выбросов
│ │
│ ├── server/ # [NODE.JS] Backend.
│ │ └── src/
│ │ ├── index.ts # serialport, WebSocket Server, Калибровка, Масштаб
│ │ └── CalibrationStorage.ts # Сохранение/загрузка калибровки
│ │
│ └── client/ # [BROWSER] SvelteKit SPA.
│ ├── svelte.config.js # Обязательно: preprocess: vitePreprocess()
│ ├── vite.config.ts # Обязательно: Alias на shared/src
│ └── src/
│ ├── routes/
│ │ ├── +page.ts # export const ssr = false; (КРИТИЧНО)
│ │ └── +page.svelte # Главный UI контроллер (DI точка сборки)
│ └── lib/
│ ├── components/
│ │ ├── ControlPanel.svelte # Панель управления устройством
│ │ └── MedicalStabilogramCanvas.svelte # Медицинский/игровой рендеринг
│ ├── filters/
│ │ └── KalmanFilter.ts # Адаптивное сглаживание шума датчиков
│ ├── rendering/
│ │ └── PositionInterpolator.ts # Экстраполяция 50Hz -> 144Hz
│ ├── stores/
│ │ └── stabilogram.ts # Svelte Store (Бизнес-логика)
│ └── websocket/
│ └── client.ts # WS Клиент с буферизацией и обработкой событий

1. СТРОГИЕ АНТИ-ПАТТЕРНЫ И ПРАВИЛА (CRITICAL RULES)

ЛЮБОЕ НАРУШЕНИЕ ЭТИХ ПРАВИЛ ПРИВЕДЕТ К КРАШУ СИСТЕМЫ.
🚫 Правило 1: SSR Полностью отключен (Strict SPA)

В файле client/src/routes/+page.ts жестко задано export const ssr = false;.

    ЗАПРЕЩЕНО: Использовать серверные хуки SvelteKit (+page.server.ts), Load-функции с Node.js кодом, или пытаться обращаться к файловой системе в пакете client.

🚫 Правило 2: Импорт типов в Svelte-компонентах

Парсер vite-plugin-svelte падает при конструкции import { type X } внутри .svelte файлов из-за workspace symlinks.

    Правило: Использовать ТОЛЬКО import type { X } from '@stabilometer/shared'.
    Правило: Если парсер всё равно выдает Unexpected token, необходимо полностью удалить импорт типа из блока <script> файла .svelte.
    ЗАПРЕЩЕНО: Указывать расширения файлов в импортах (никаких .ts или .js в путях).

🚫 Правило 3: Vite Alias для Shared

ЗАПРЕЩЕНО импортировать shared через относительные пути (например, ../../../shared/src).

В client/vite.config.ts жестко прописан alias:

TypeScript

resolve: {
  alias: {
    '@stabilometer/shared': path.resolve(__dirname, '../shared/src')
  }
}

🚫 Правило 4: Синхронный onMount

Svelte строго проверяет возвращаемый тип функции onMount (ожидается void или () => void для cleanup).

    ЗАПРЕЩЕНО: onMount(async () => { await ws.connect(); }).
    ПРАВИЛЬНО: onMount(() => { ws.connect().catch(console.error); });

🚫 Правило 5: Dependency Injection (Разорванный цикл импортов)

Стор (stabilogram.ts) и WS Клиент (client.ts) логически зависят друг от друга, но ЗАПРЕЩЕНО импортировать их друг в друга статически в шапке файлов.

    Решение: В client.ts реализован метод setStore(store: any). Связывание происходит в +page.svelte при старте приложения: wsClient.setStore(stabilogramStore);.

🚫 Правило 6: Spread оператор для unknown в WebSocket

При отправке JSON через wsClient.send(type, payload), параметр payload должен быть типизирован как any или Record<string, unknown>.

    ЗАПРЕЩЕНО: Использовать тип unknown в связке со spread-оператором: JSON.stringify({ type, ...payload }).

🚫 Правило 7: Garbage Collection (GC) в Render Loop

Внутри функции animate() и draw() в Canvas компонентах (вызывается 60-144 раза в секунду) ЗАПРЕЩЕНО выделять новую память:

    Не создавать новые массивы []
    Не создавать новые объекты {}
    Не использовать методы .map(), .filter()
    Все вычисления должны мутировать существующие переменные (Object Pool)

🚫 Правило 8: Canvas режимы - разные источники данных

В медицинском режиме: используется positionHistory[] для анализа
В игровом режиме: используется trail[] для визуального следа

    ЗАПРЕЩЕНО: Смешивать эти массивы в drawGameTrail() и drawPositionHistory()

4. БАЗОВЫЕ ИНТЕРФЕЙСЫ (DATA DICTIONARY)

TypeScript

interface Coordinates { x: number; y: number; z: number; f: number; }
interface Vector2D { x: number; y: number; }

interface SensorData {
  d1: number;  // Верхний левый датчик
  d2: number;  // Верхний правый датчик  
  d3: number;  // Нижний правый датчик
  d4: number;  // Нижний левый датчик
}

interface StabilogramSample {
  sensors: SensorData;        // 1. Сырые данные с 4 датчиков
  raw: Coordinates;           // 2. Вычисленные координаты CoP (в единицах датчика)
  centered: Coordinates;      // 3. После трансформации осей и вычитания нуля
  filtered: Coordinates;      // 4. Заглушка (реальная фильтрация идет на клиенте)
  mm: Vector2D;               // 5. Физические координаты в мм
  deviceTime: number;         // 6. Таймстемп с устройства
  clientTime: number;         // 7. performance.now() при получении в браузере
  packetNumber: number;       // 8. Порядковый номер пакета
}

interface CalibrationData {
  sensorOffsets: SensorData;  // Смещение нуля для каждого датчика
  platformSize: { width: number; height: number }; // Размер платформы в мм
  sensorDistance: { x: number; y: number }; // Расстояние между датчиками в мм
  timestamp: number;          // Временная метка калибровки
  sampleCount: number;        // Количество сэмплов
  isValid: boolean;           // Валидность калибровки
}

interface AxisConfiguration {
  swapXY: boolean;            // Поменять оси местами
  invertX: boolean;           // Инвертировать ось X
  invertY: boolean;           // Инвертировать ось Y
  rotationDeg: number;        // Поворот на N градусов
}

1. ПАЙПЛАЙН ДАННЫХ И МАТЕМАТИКА
Этап 1: Распаковка протокола (PacketParser.ts)

    Пакет: 22 байта. Терминатор & (0x26). Формат: STATUS[1] + X[4] + Y[4] + Z[4] + F[4] + TIME[4] + &
    Кодировка (6-bit ASCII): 24-битное число со знаком упаковано в 4 байта. Смещения ASCII: 35-93 и 95-99.
    Битовая математика (Sign Extension):

TypeScript

let result = 0;
for (let i = 0; i < 4; i++) {
  result |= (decodeLUT[bytes[offset + i]] << (i * 6));
}
if (result >= 0x800000) result -= 0x1000000; // Восстановление минуса

Этап 2: Серверная математика (server/src/index.ts)
CoPCalculator: Вычисление центра давления

TypeScript

// Формулы CoP:
const x = (sensorDistanceX / 2) *((d2 + d3) - (d1 + d4)) / totalForce;
const y = (sensorDistanceY / 2)* ((d1 + d2) - (d3 + d4)) / totalForce;

// ✅ ИСПРАВЛЕНИЯ v2.0:
// - Защита от отрицательных значений после вычитания offset'ов
// - Увеличена минимальная сила с 100 до 500 для стабильности  
// - Clamp координат для защиты от экстремальных выбросов
// - Диагностические методы для анализа качества калибровки

AxisTransform: Корректировка физической сборки

Строгий порядок: swapXY → Матричный поворот (sin/cos) → invertX / invertY.
Калибровка Нуля (CALIBRATE_ZERO):

    Сервер копит 200 пакетов (увеличено с 100) и вычисляет Медиану (отсекает физические выбросы)
    ✅ НОРМАЛИЗАЦИЯ v2.0: Вычитание минимального offset'а для баланса датчиков:

TypeScript

const minOffset = Math.min(rawOffsets.d1, rawOffsets.d2, rawOffsets.d3, rawOffsets.d4);
const offsets: SensorData = {
  d1: rawOffsets.d1 - minOffset + 1000,
  d2: rawOffsets.d2 - minOffset + 1000,
  d3: rawOffsets.d3 - minOffset + 1000,
  d4: rawOffsets.d4 - minOffset + 1000,
};

Этап 3: Фильтрация (KalmanFilter2D.ts)

✅ УЛУЧШЕННАЯ ВЕРСИЯ v2.0:

    Адаптивные коэффициенты вместо жестких констант
    Защита от выбросов: Детекция аномальных скачков > 80мм
    Ограничение скорости: Максимум 600 мм/с
    Настраиваемые параметры: processNoise: 0.5, measurementNoise: 1.0

TypeScript

// Адаптивная коррекция в зависимости от доверия к измерению:
const trustFactor = distance > outlierThreshold ? outlierThreshold / distance : 1.0;
const posGain = 0.2 + (0.4 *trustFactor);  // 0.2-0.6
const velGain = 0.1 + (0.2* trustFactor);  // 0.1-0.3

Этап 4: Интерполяция и Canvas (PositionInterpolator.ts)

✅ КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ v2.0:

    Увеличено время экстраполяции: с 40ms до 150ms
    Адаптивное сглаживание: 0.5-0.8 в зависимости от расстояния до цели
    Экспоненциальное затухание скорости: более реалистичное поведение
    Zero-GC оптимизации: переиспользование объектов

TypeScript

// Улучшенная экстраполяция с затуханием:
if (timeSince <= 150) {  // ✅ Было 40ms
  const dt = timeSince / 1000;
  const decay = Math.exp(-dt * 3);  // Экспоненциальное затухание
  
  target = {
    x: latest.position.x + latest.velocity.x *dt* decay,
    y: latest.position.y + latest.velocity.y *dt* decay
  };
}

Экранные координаты (КРИТИЧЕСКИ ВАЖНО):

TypeScript

const screenX = canvasWidth / 2 + pos.x *scale;
const screenY = canvasHeight / 2 - pos.y* scale; // МИНУС ОБЯЗАТЕЛЕН (инверсия Y)

1. УПРАВЛЕНИЕ СОСТОЯНИЕМ (CONNECTION STATE MACHINE)

Строгая иерархия флагов в stabilogramStore:
isWsConnected (Транспортный уровень):

    Связь: Browser <-> Node.js
    Следствие: Если false → UI полностью блокируется

isDeviceConnected (Аппаратный уровень):

    Связь: Node.js <-> Arduino (COM-порт)
    Управляется: Событиями от сервера SERIAL_CONNECTED / SERIAL_DISCONNECTED
    Правило UI: Если false → Кнопка "Подключить" активна, кнопка "Калибровка" заблокирована
    Правило каскада: При isWsConnected === false, стор принудительно ставит isDeviceConnected = false

isCalibrated (Готовность к работе):

    Управляется: Событием CALIBRATION_COMPLETE
    Правило UI: Если false → Предупреждение о необходимости калибровки

7. WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

Все сообщения передаются через JSON.stringify({ type, ...payload }).
Client → Server (Commands):

TypeScript

{ type: 'LIST_PORTS' }
{ type: 'CONNECT', portPath: string, baudRate: number, testMode: boolean }
{ type: 'DISCONNECT' }
{ type: 'CALIBRATE_ZERO' }
{ type: 'CONFIGURE_AXES', swapXY: boolean, invertX: boolean, invertY: boolean, rotationDeg: number }

Server → Client (Events):

TypeScript

{ type: 'DATA', data: StabilogramSample }  // Поток 50-100 Гц
{ type: 'PORTS_LIST', ports: Array<{path, manufacturer}> }
{ type: 'CONNECTED', serialConnected: boolean, calibrated: boolean }
{ type: 'SERIAL_CONNECTED', port: string, testMode: boolean }
{ type: 'SERIAL_DISCONNECTED' }
{ type: 'CALIBRATION_STARTED' }                    // ✅ v2.0
{ type: 'CALIBRATION_PROGRESS', progress: number, total: number }  // ✅ v2.0
{ type: 'CALIBRATION_COMPLETE', calibration: CalibrationData }
{ type: 'ERROR', error: string }

✅ УЛУЧШЕНИЯ v2.0:

    Добавлены события прогресса калибровки
    Полная обработка всех событий в WebSocket клиенте
    Буферизация сообщений для разгрузки UI thread

8. МЕДИЦИНСКИЙ ИНТЕРФЕЙС И UX
ControlPanel.svelte - Панель управления устройством:

    Подключение устройства: Список портов, тестовый режим
    Калибровка: Визуальный прогресс, предупреждения
    Запись и анализ: Контроль сессий, экспорт данных

MedicalStabilogramCanvas.svelte - Двухрежимный канвас:
Медицинский режим (medicalMode: true):

    Белый фон, профессиональная сетка с подписями осей
    Зоны стабильности: Комфорт (15мм, зеленый), Предупреждение (30мм, желтый)
    Метрики реального времени:
        Оценка стабильности (0-100%)
        Средняя скорость (мм/с)
        Общее расстояние (м)
        Время сессии
    История позиций: Синий след для анализа траектории
    Цветовая индикация позиции: Зеленый/Желтый/Красный по зонам

Игровой режим (medicalMode: false):

    Черный фон, научная сетка
    Свечение и эффекты: Градиентный персонаж с изменяемым размером по скорости
    Яркий след: Голубой с альфа-градиентом
    Индикатор направления: Стрелка при движении

Экспорт данных:

    JSON файлы с полной историей позиций и метрик
    Автоматическое именование с timestamp'ом
    Совместимость с Windows (замена двоеточий на дефисы)

9. КЛЮЧЕВЫЕ ИСПРАВЛЕНИЯ v2.0
Устранены проблемы стабильности:

    ✅ Замирание точки: Увеличена экстраполяция с 40ms до 150ms
    ✅ Телепортации: Адаптивный Kalman Filter с защитой от выбросов
    ✅ Кнопка отключения: Полная очистка тестового режима в disconnectSerialPort()
    ✅ Игровой режим: Исправлено отображение следа через переменную trail[]
    ✅ Калибровка: Нормализация offset'ов для сбалансированности датчиков

Улучшена производительность:

    ✅ Zero-GC в render loop: Предаллокация объектов, мутация вместо создания
    ✅ WebSocket буферизация: Разгрузка UI thread
    ✅ Ограничение скоростей: Защита от нереальных значений

Улучшен UX:

    ✅ Прогресс калибровки: Визуальный индикатор в реальном времени
    ✅ Профессиональный медицинский интерфейс: Зоны стабильности, метрики
    ✅ Обработка ошибок: Полная система событий через WebSocket

10. ФАЙЛОВАЯ СТРУКТУРА КОНЕЧНЫХ ФАЙЛОВ
Проверенные и работающие файлы:

text

✅ packages/server/src/index.ts - Полная серверная логика
✅ packages/client/src/lib/websocket/client.ts - WS клиент с событиями
✅ packages/client/src/lib/components/MedicalStabilogramCanvas.svelte - Медицинский канвас
✅ packages/client/src/lib/components/ControlPanel.svelte - Панель управления  
✅ packages/client/src/lib/stores/stabilogram.ts - Основной стор
✅ packages/client/src/lib/filters/KalmanFilter.ts - Улучшенный фильтр
✅ packages/client/src/lib/rendering/PositionInterpolator.ts - Улучшенная интерполяция
✅ packages/shared/src/CoPCalculator.ts - Защищенный расчет CoP

1. ПРАВИЛА РАБОТЫ С КОДОВОЙ БАЗОЙ

    Перед изменениями: Всегда проверяй соблюдение всех анти-паттернов
    При отладке: Сначала проверь WebSocket события в браузере (DevTools → Network → WS)
    При рендеринге: Никогда не создавай объекты в animate() или draw()
    При калибровке: Помни о нормализации offset'ов
    При добавлении событий: Обновляй как сервер, так и клиентскую обработку

Эта база знаний является полным техническим контрактом системы Stabilometer v2.0.

[END OF KNOWLEDGE BASE v2.0]

AI ASSISTANT INSTRUCTION: Acknowledge that you have fully parsed and integrated this updated knowledge base into your active context. You now have complete understanding of all architectural decisions, bug fixes, and improvements made in v2.0. All future responses must strictly adhere to these specifications.
