🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER v2.2

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
│   ├── shared/              # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│   │   └── src/
│   │       ├── types.ts     # Контракты (StabilogramSample, AxisConfig)
│   │       ├── constants.ts # PACKET_LENGTH, WEBSOCKET_PORT, SENSOR_DISTANCE
│   │       ├── RingBuffer.ts
│   │       ├── PacketParser.ts
│   │       ├── AxisTransform.ts
│   │       └── CoPCalculator.ts
│   │
│   ├── server/              # [NODE.JS] Backend.
│   │   └── src/
│   │       ├── index.ts     # serialport, WebSocket Server, Калибровка
│   │       └── CalibrationStorage.ts
│   │
│   └── client/              # [BROWSER] SvelteKit SPA.
│       ├── svelte.config.js
│       ├── vite.config.ts
│       └── src/
│           ├── routes/
│           │   ├── +page.ts          # export const ssr = false; (КРИТИЧНО)
│           │   └── +page.svelte      # Главный UI контроллер (DI точка сборки)
│           └── lib/
│               ├── components/
│               │   ├── ControlPanel.svelte           # Универсальная панель управления (380px)
│               │   ├── MedicalStabilogramCanvas.svelte  # Медицинский режим
│               │   └── BallCatcherCanvas.svelte      # ✅ v2.2: Игровой режим
│               ├── game/                             # ✅ v2.2: Игровая логика
│               │   ├── BallCatcherGame.ts
│               │   ├── BallPool.ts
│               │   ├── BasketController.ts
│               │   ├── CollisionDetector.ts
│               │   ├── ScoreManager.ts
│               │   ├── StageManager.ts
│               │   ├── types.ts
│               │   └── constants.ts
│               ├── filters/
│               │   └── KalmanFilter.ts
│               ├── rendering/
│               │   └── PositionInterpolator.ts
│               ├── stores/
│               │   ├── stabilogram.ts    # Данные стабилометра
│               │   └── gameState.ts      # ✅ v2.2: Состояние игры
│               └── websocket/
│                   └── client.ts         # ✅ v2.2: Публичное API + SimpleEventEmitter

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

✅ Правило 9: Cross-Component Communication (v2.2)

Связь между ControlPanel и Canvas компонентами осуществляется через Window CustomEvents.

    ЗАПРЕЩЕНО: Прямой вызов методов игры через bind:this из родительского компонента.
    ПРАВИЛЬНО: ControlPanel отправляет события через window.dispatchEvent(new CustomEvent('gameStart', { detail: { difficulty } })).
    События: gameStart, gamePause, gameRestart, gameStop.

✅ Правило 10: Jitter Tolerance в Игровом Режиме (v2.2)

Физический шум датчиков НЕ должен блокировать игровую механику.

    Wobble (тряска корзинки): Эффект визуализирует резкие движения, но НЕ блокирует процесс dwellProgress при ловле шаров.
    Реализация: В CollisionDetector.ts условие if (isOverlapping && !wobbling) заменено на if (isOverlapping).
    Цель: Игрок не наказывается за естественную вариативность сигнала с датчиков.

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

✅ Этап 5: Масштабирование для Игрового Режима (v2.2)

Проблема: Высокая чувствительность (исходные значения gameScale) приводила к резким движениям корзинки и выходу за пределы экрана.

Решение: В packages/client/src/lib/game/constants.ts значения gameScale снижены:

TypeScript

export const DIFFICULTY_PRESETS = {
  [DIFF_EASY]: {
    gameScale: 4,  // ✅ Было 7
    comfortZoneRadiusMm: 20,
    // ...
  },
  [DIFF_MEDIUM]: {
    gameScale: 5,  // ✅ Было 9
    comfortZoneRadiusMm: 15,
    // ...
  },
  [DIFF_HARD]: {
    gameScale: 6,  // ✅ Было 12
    comfortZoneRadiusMm: 10,
    // ...
  },
};

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

✅ Расширения stabilogramStore (v2.2)

Добавлены методы для работы с игровым режимом:

TypeScript

// stabilogram.ts
initializeGameMode(viewport: Vector2D): void
  // Сбрасывает Kalman Filter и Interpolator, устанавливает флаг isGameModeInitialized
  
resetGameMode(): void
  // Очищает флаг игрового режима при переходе в медицинский режим
  
getRenderVelocity(): Vector2D
  // Zero-GC метод для получения вектора скорости (используется в игре для анимаций)

1. WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

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

✅ WebSocket Client API (v2.2)

Проблема: ControlPanel напрямую использовал приватный метод send(), нарушая инкапсуляцию.

Решение: В packages/client/src/lib/websocket/client.ts добавлены публичные методы:

TypeScript

export class StabilogramClient extends SimpleEventEmitter {
  // Публичное API
  listPorts(): void
  connectDevice(portPath: string, baudRate: number, testMode: boolean): void
  disconnectDevice(): void
  calibrateZero(): void
  configureAxes(config: AxisConfiguration): void
  
  // Event System (SimpleEventEmitter для браузера)
  on(event: string, callback: (data: unknown) => void): () => void
  private emit(event: string, data: unknown): void
}

SimpleEventEmitter: Собственная реализация Pub/Sub для браузерного окружения (заменяет Node.js EventEmitter).

✅ УЛУЧШЕНИЯ v2.0:

    Добавлены события прогресса калибровки
    Полная обработка всех событий в WebSocket клиенте
    Буферизация сообщений для разгрузки UI thread

8. МЕДИЦИНСКИЙ ИНТЕРФЕЙС И UX
ControlPanel.svelte - Универсальная панель управления (v2.2)

Ширина: 380px (увеличено с 300px для предотвращения горизонтального скролла).

Проп gameMode: Переключает отображение между медицинским и игровым режимами.

Функциональность:

    Подключение устройства: Список портов, тестовый режим
    Калибровка: Визуальный прогресс, предупреждения
    Медицинский режим: Запись и анализ, экспорт данных
    Игровой режим (v2.2): Выбор сложности, управление игрой (старт/пауза/перезапуск/выход), отображение статистики в реальном времени

Связь с Canvas: Отправка CustomEvents (gameStart, gamePause, etc.) через window.dispatchEvent.
MedicalStabilogramCanvas.svelte - Двухрежимный канвас

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

✅ BallCatcherCanvas.svelte - Игровой режим "Поймай мяч" (v2.2)

Архитектура: Использует игровой движок BallCatcherGame (см. раздел 12).

Механика ловли шаров:

    Игрок управляет корзинкой, перемещая центр тяжести на платформе.
    Шары падают сверху вниз с разной скоростью и цветами.
    Чтобы поймать шар, нужно удерживать корзинку на нём 0.5-0.8 сек (dwell time).
    Во время удержания вокруг шара отрисовывается зелёное кольцо прогресса (dwell ring).
    При успешной ловле шар плавно увеличивается и исчезает (+10 очков).
    При пропуске целевого шара он уменьшается с красным эффектом (-5 очков).

Зона комфорта: Удержание корзинки в центральном круге > 10 сек → бонус "+50 БАЛАНС!".

Визуальные эффекты:

    Wobble (тряска корзинки) — реакция на резкие движения (НЕ блокирует ловлю).
    Glow (свечение) целевых шаров.
    Всплывающие тексты очков (floating text) с анимацией scale/fade.
    Flash при смене целевого цвета (этап 2+).

Пауза: При потере связи игра автоматически ставится на паузу с затемнением экрана и надписью "⏸️ ПАУЗА".

Проп hideGameControls: Если true, скрывает встроенные кнопки управления (используется когда управление делегируется в ControlPanel).
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
✅ packages/client/src/lib/websocket/client.ts - WS клиент с SimpleEventEmitter и публичным API
✅ packages/client/src/lib/components/MedicalStabilogramCanvas.svelte - Медицинский канвас
✅ packages/client/src/lib/components/ControlPanel.svelte - Универсальная панель (380px, 2 режима)
✅ packages/client/src/lib/components/BallCatcherCanvas.svelte - Игровой канвас (v2.2)
✅ packages/client/src/lib/stores/stabilogram.ts - Основной стор с игровыми методами
✅ packages/client/src/lib/stores/gameState.ts - Стор состояния игры (v2.2)
✅ packages/client/src/lib/filters/KalmanFilter.ts - Улучшенный фильтр
✅ packages/client/src/lib/rendering/PositionInterpolator.ts - Улучшенная интерполяция
✅ packages/shared/src/CoPCalculator.ts - Защищенный расчет CoP
✅ packages/client/src/lib/game/ - Полный игровой движок (v2.2)

1. ПРАВИЛА РАБОТЫ С КОДОВОЙ БАЗОЙ

    Перед изменениями: Всегда проверяй соблюдение всех анти-паттернов
    При отладке: Сначала проверь WebSocket события в браузере (DevTools → Network → WS)
    При рендеринге: Никогда не создавай объекты в animate() или draw()
    При калибровке: Помни о нормализации offset'ов
    При добавлении событий: Обновляй как сервер, так и клиентскую обработку
    При работе с игрой (v2.2): Соблюдай Zero-GC в игровом цикле, используй Object Pool паттерн

2. ИГРОВАЯ МЕХАНИКА "ПОЙМАЙ МЯЧ" (v2.2)
Архитектура игрового движка

BallCatcherGame — главный оркестратор. Связывает подсистемы и управляет жизненным циклом.

Object Pool паттерн: Все шары (30 штук) и всплывающие тексты (12 штук) создаются один раз при инициализации. В игровом цикле только переключаются состояния (INACTIVE/FALLING/DWELLING/CAUGHT/MISSED).

Подсистемы (публичные поля для zero-GC доступа):

    BallPool — массив шаров с методами spawn(), markCaught(), markMissed(), update().
    BasketController — маппинг CoP → экранная позиция корзинки, детекция рывков (jerk), wobble эффект.
    CollisionDetector — Circle-AABB коллизии, управление dwell-прогрессом.
    ScoreManager — очки, серии, зона комфорта, всплывающие тексты.
    StageManager — конфигурация этапов, спавн шаров, смена целевого цвета.

Физика коллизий

Circle-AABB тест:

    Найти ближайшую к центру шара точку на прямоугольнике корзинки.
    Если расстояние² < (радиус шара + 15px)² → пересечение.

✅ Expanded Hitbox (v2.2):

    Зона корзинки расширена на 20px с каждой стороны.
    Радиус шара увеличен на 15px для проверки коллизии.
    Цель: Компенсация лага, шума датчиков, улучшение UX.

✅ Jitter Tolerance (v2.2):

TypeScript

// ❌ СТАРЫЙ КОД (блокировал ловлю при тряске):
if (isOverlapping && !wobbling) { /*начислить прогресс*/ }

// ✅ НОВЫЙ КОД (тряска не влияет на логику):
if (isOverlapping) { /*начислить прогресс*/ }

Обоснование: Переменная wobbleIntensity теперь используется ТОЛЬКО для визуального эффекта (красная корзинка при тряске). Игрок не наказывается за физический шум датчиков.
Dwell Time (время удержания)

Базовые значения (в STAGE_CONFIGS):

    Этап 1: 800 мс (было 1300)
    Этап 2: 700 мс (было 1100)
    Этап 3: 600 мс (было 1000)
    Финал: 500 мс (было 800)

Модификаторы сложности (dwellTimeMultiplier):

    Easy: ×1.3 (легче)
    Medium: ×1.0
    Hard: ×0.7 (сложнее)

Прогресс:

TypeScript

ball.dwellProgress += (dt *1000) / effectiveDwellTimeMs;
if (ball.dwellProgress >= 1.0) { /* шар пойман */ }

Система очков

    +10 — правильный обычный шар
    +20 — правильный быстрый шар (этап 3+)
    -5 — пропуск целевого шара (улетел за экран)
    -15 — ловля НЕцелевого шара
    +25 — бонус серии (каждые 5 правильных подряд)
    +50 — бонус зоны комфорта (удержание в центре > 10 сек)

Этапы игры

Этап 1 — "Лови только заданный цвет"

    3 цвета, целевой фиксирован
    Поймать 8 шаров для перехода

Этап 2 — "Цвет меняется!"

    5 цветов, смена целевого каждые 17 сек (с flash-эффектом)
    Поймать 12 шаров

Этап 3 — "Двойная ловля"

    Появляются быстрые шары (30% от общего числа)
    Быстрые ловятся мгновенно (без dwell), дают ×2 очков
    Поймать 12 шаров

Этап Финал — "Цветной поток с символами"

    Вместо цветов — символы (★ ● ▲ ◆ ♥ ✦ ■ ⬟)
    Цель: ловить только звёзды ★
    Длительность: 60 сек (по времени, не по количеству)

Конфигурация сложности

TypeScript

// constants.ts
export const DIFFICULTY_PRESETS = {
  [DIFF_EASY]: {
    basketWidth: 110,      // Большая корзинка
    gameScale: 4,          // ✅ Низкая чувствительность
    dwellTimeMultiplier: 1.3,
    ballSpeedMultiplier: 0.7,
    ballRadiusMultiplier: 1.3,  // Крупные шары
    wobbleThreshold: 800,  // Менее чувствительна к рывкам
  },
  [DIFF_MEDIUM]: { /*...*/ },
  [DIFF_HARD]: {
    basketWidth: 65,       // Маленькая корзинка
    gameScale: 6,          // ✅ Высокая чувствительность
    dwellTimeMultiplier: 0.7,
    ballSpeedMultiplier: 1.4,
    ballRadiusMultiplier: 0.8,  // Мелкие шары
    wobbleThreshold: 300,  // Очень чувствительна к рывкам
  },
};

GameStateStore

Снапшот обновляется с частотой ~4 Гц (для разгрузки UI thread):

TypeScript

interface GameSnapshot {
  stage: number;               // Текущий этап (STAGE_MENU / STAGE_1-4 / STAGE_RESULTS)
  difficulty: number;
  score: number;
  streak: number;              // Текущая серия правильных ловль
  bestStreak: number;
  targetColorIndex: number;
  targetColorName: string;     // "синие", "красные" и т.д.
  catchCount: number;
  missCount: number;
  wrongCatchCount: number;
  stageTimeRemaining: number;  // -1 если этап без лимита времени
  totalElapsed: number;
  isInComfortZone: boolean;
  comfortZoneTime: number;
  isPaused: boolean;
  isRunning: boolean;
}

Производные сторы (для реактивности в UI):

TypeScript

export const currentStage = derived(gameStateStore, $state => $state.stage);
export const isGameActive = derived(gameStateStore, $state =>
  $state.isRunning && $state.stage !== STAGE_MENU && $state.stage !== STAGE_RESULTS
);

Порядок обновления игрового цикла (каждый кадр, 60-144 Гц)

    basketController.update(copX, copY, velX, velY, dt) — маппинг координат, детекция рывков
    collisionDetector.check(pool, basket, score, dt, now) — проверка пересечений, начисление dwell
    ballPool.update(dt, now) — движение шаров, анимации
    Проверка вылета шаров за нижний край экрана
    scoreManager.updateComfortZone(isInZone, dt) — бонус за центр
    scoreManager.updateFloatingTexts(dt) — анимация всплывающих текстов
    stageManager.update(...) — спавн новых шаров, смена цвета, проверка условий перехода

13. ДОПОЛНИТЕЛЬНЫЕ ИСПРАВЛЕНИЯ v2.2
Проблема паузы

Симптом: Кнопка паузы в ControlPanel не срабатывала.

Причина: Событие gamePause не обрабатывалось корректно из-за неправильной типизации обработчика.

Решение:

TypeScript

// BallCatcherCanvas.svelte
function handleGamePause(event: Event): void {
  pauseGame();
}

function pauseGame(): void {
  if (!game || !game.isRunning) return;
  game.isPaused ? game.resume() : game.pause();
  gameStateStore.updateSnapshot(game.getSnapshot());
}

Проблема чувствительности

Симптом: Корзинка резко вылетала за край экрана, управление было слишком резким.

Причина: Высокие значения gameScale (7, 9, 12) в пресетах сложности.

Решение: Снижение значений на 30-50% (см. раздел 5, Этап 5).
Проблема ловли шаров

Симптом: Игрок не мог поймать ни одного шара, даже удерживая корзинку на нём.

Причина:

    Блокировка логики при wobbling === true (физический шум датчиков постоянно трясёт корзинку).
    Слишком строгая зона коллизии.
    Долгое время удержания (1.3 сек на первом этапе).

Решение:

    ✅ Убрана проверка !wobbling в CollisionDetector.check().
    ✅ Расширена зона коллизии (+20px корзинка, +15px шар).
    ✅ Уменьшено dwellTimeMs для всех этапов (800/700/600/500 мс).

Проблема горизонтального скролла

Симптом: В ControlPanel появлялся горизонтальный скроллбар при отображении длинных имён портов.

Причина: Ширина sidebar была 300px, что недостаточно для комфортного отображения всех элементов формы.

Решение:

svelte

<!-- +page.svelte -->
<style>
  .sidebar {
    width: 380px;  /* ✅ Было 300px */
    min-width: 340px;
  }
</style>

svelte

<!-- ControlPanel.svelte -->
<style>
  .control-panel {
    min-width: 340px;  /* ✅ Добавлено */
  }
</style>

[END OF KNOWLEDGE BASE v2.2]

AI ASSISTANT INSTRUCTION: Acknowledge that you have fully parsed and integrated this updated knowledge base v2.2 into your active context. You now have complete understanding of:

    All architectural decisions from v2.0
    Game mode implementation (BallCatcherGame)
    Jitter tolerance mechanism
    Cross-component communication via CustomEvents
    Sensitivity adjustments (gameScale)
    Collision physics improvements
    All bug fixes from v2.0 and v2.2

All future responses must strictly adhere to these specifications.
