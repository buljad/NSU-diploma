# 🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER

[CRITICAL INSTRUCTION FOR ALL LLMs]

You are an expert Senior Fullstack & Real-Time Systems Developer. This document is your Absolute Single Source of Truth (SSoT) for the "Stabilometer" project. You MUST read, understand, and strictly follow every rule, architecture pattern, and anti-pattern described here before generating any code or analyzing any bug. Do NOT hallucinate standard SvelteKit, Vite, or Node.js patterns if they contradict the rules established in this document.

1. ДОМЕННАЯ ОБЛАСТЬ И ФИЗИКА СИСТЕМЫ

Проект — аппаратно-программный комплекс класса "Soft Real-Time" для медицинской диагностики и реабилитации (оценка баланса человека).

    Оборудование: Платформа с 4 тензодатчиками.
    Топология: [Hardware (COM-port, 50-100Hz)] ===> [Node.js Server] ===(WebSocket)===> [SvelteKit SPA Client (60-144Hz)].
    Метрики: X, Y (координаты Центра Давления - CoP), Z (резерв, 0), F (общая сила/вес пациента).
    Главный инженерный вызов: Разрыв частот. Оборудование шлет пакеты каждые 10-20 мс (с физическим шумом и дрейфом датчиков). Браузер клиента (Canvas) отрисовывает кадры каждые 6.9 - 16.6 мс. Задача ПО — обеспечить строгую математическую фильтрацию шума и идеально плавную визуализацию (экстраполяцию) без разрывов и "телепортаций" маркера на экране.

2. АРХИТЕКТУРА MONOREPO И СБОРКА

Проект использует pnpm workspaces. Пересечение зон ответственности между пакетами СТРОГО ЗАПРЕЩЕНО.

text

stabilometer/
├── pnpm-workspace.yaml
├── packages/
│   ├── shared/                 # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│   │   └── src/
│   │       ├── types.ts        # Контракты (StabilogramSample, AxisConfig)
│   │       ├── constants.ts    # PACKET_LENGTH, TERMINATOR, WEBSOCKET_PORT
│   │       ├── RingBuffer.ts   # Memory-safe буферы
│   │       ├── PacketParser.ts # Распаковка 6-bit ASCII
│   │       └── AxisTransform.ts# Вращение и инверсия координат
│   │
│   ├── server/                 # [NODE.JS] Backend.
│   │   └── src/
│   │       └── index.ts        # serialport, WebSocket Server, Калибровка, Масштаб
│   │
│   └── client/                 # [BROWSER] SvelteKit SPA.
│       ├── svelte.config.js    # Обязательно: preprocess: vitePreprocess()
│       ├── vite.config.ts      # Обязательно: Alias на shared/src
│       └── src/
│           ├── routes/
│           │   ├── +page.ts        # export const ssr = false; (КРИТИЧНО)
│           │   └── +page.svelte    # Главный UI контроллер (DI точка сборки)
│           └── lib/
│               ├── components/
│               │   └── StabilogramCanvas.svelte # Рендеринг (requestAnimationFrame)
│               ├── filters/
│               │   └── KalmanFilter.ts          # Сглаживание шума датчиков
│               ├── rendering/
│               │   └── PositionInterpolator.ts  # Экстраполяция 50Hz -> 144Hz
│               ├── stores/
│               │   └── stabilogram.ts           # Svelte Store (Бизнес-логика)
│               └── websocket/
│                   └── client.ts                # WS Клиент

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
В client/vite.config.ts жестко прописан alias. Используйте только: import { X } from '@stabilometer/shared';

TypeScript

resolve: { alias: { '@stabilometer/shared': path.resolve(__dirname, '../shared/src') } }

🚫 Правило 4: Синхронный onMount

Svelte строго проверяет возвращаемый тип функции onMount (ожидается void или () => void для cleanup).
ЗАПРЕЩЕНО: onMount(async () => { await ws.connect(); }).
ПРАВИЛЬНО: onMount(() => { ws.connect().catch(console.error); });
🚫 Правило 5: Dependency Injection (Разорванный цикл импортов)

Стор (stabilogram.ts) и WS Клиент (client.ts) логически зависят друг от друга, но ЗАПРЕЩЕНО импортировать их друг в друга статически в шапке файлов (вызовет ошибку Vite doesn't provide an export named X).

    Решение: В client.ts реализован метод setStore(store: any). Связывание происходит в +page.svelte при старте приложения: wsClient.setStore(stabilogramStore);.

🚫 Правило 6: Spread оператор для unknown в WebSocket

При отправке JSON через wsClient.send(type, payload), параметр payload должен быть типизирован как any или Record<string, unknown>.
ЗАПРЕЩЕНО: Использовать тип unknown в связке со spread-оператором: JSON.stringify({ type, ...payload }) — TypeScript скомпилирует это так, что данные потеряются.
🚫 Правило 7: Garbage Collection (GC) в Render Loop

Внутри функции animate() и draw() в StabilogramCanvas.svelte (вызывается 60-144 раза в секунду) ЗАПРЕЩЕНО выделять новую память: не создавать новые массивы [], новые объекты {}, не использовать методы .map(), .filter().
Все вычисления должны мутировать существующие переменные (Object Pool), иначе возникнут GC-паузы (микрофризы на экране).
4. БАЗОВЫЕ ИНТЕРФЕЙСЫ (DATA DICTIONARY)

TypeScript

interface Coordinates { x: number; y: number; z: number; f: number; }
interface Vector2D { x: number; y: number; }

interface StabilogramSample {
  raw: Coordinates;       // 1. Сырые данные 24-bit от датчиков
  centered: Coordinates;  // 2. После трансформации осей и вычитания нуля
  filtered: Coordinates;  // 3. Заглушка (реальная фильтрация идет на клиенте)
  mm: Vector2D;           // 4. Физические миллиметры (centered * 0.01)
  deviceTime: number;     // 5. Таймстемп с устройства
  clientTime: number;     // 6. performance.now() при получении в браузере
  packetNumber: number;   // 7. Порядковый номер пакета
}

interface CalibrationData {
  center: Coordinates;    // Медиана 100 пакетов состояния покоя
  scale: Vector2D;        // Масштаб ({x: 0.01, y: 0.01})
  bounds: { minX: number; maxX: number; minY: number; maxY: number; };
  timestamp: number;
  sampleCount: number;
  isValid: boolean;
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

    AxisTransform: Корректировка физической сборки. Строгий порядок: swapXY -> Матричный поворот (sin/cos) -> invertX / invertY.
    Калибровка Нуля (CALIBRATE_ZERO): Сервер копит 100 пакетов и вычисляет Медиану (отсекает физические выбросы от случайных рывков пациента). Сохраняет как center.
    Масштабирование: mm.x = (transformed.x - center.x) * 0.01. (Константа MM_PER_UNIT).

Этап 3: Фильтрация (KalmanFilter2D.ts)

    Модель: Дискретная модель постоянной скорости. Состояние [x, y, vx, vy].
    Обновление: dt вычисляется динамически между приходом WS-пакетов. Убирает высокочастотный тремор датчиков, сохраняя реакцию на движения тела.

Этап 4: Интерполяция и Canvas (PositionInterpolator.ts)

    Экстраполяция: Если кадр рендерится, а новый пакет (50 Гц) еще не пришел, позиция предсказывается: target.x = last.x + last.vx * dt.
    Экранные координаты (КРИТИЧЕСКИ ВАЖНО): Физический ноль — центр платформы. В Canvas ноль — левый верхний угол. Ось Y в Canvas инвертирована относительно декартовой физики.

    JavaScript

    const screenX = canvasWidth / 2 + pos.x * scale;
    const screenY = canvasHeight / 2 - pos.y * scale; // МИНУС ОБЯЗАТЕЛЕН

6. УПРАВЛЕНИЕ СОСТОЯНИЕМ (CONNECTION STATE MACHINE)

Строгая иерархия флагов в stabilogramStore:

    isWsConnected (Транспортный уровень):
        Связь: Browser <-> Node.js.
        Следствие: Если false -> UI полностью блокируется.
    isDeviceConnected (Аппаратный уровень):
        Связь: Node.js <-> Arduino (COM-порт).
        Управляется: Событиями от сервера SERIAL_CONNECTED / SERIAL_DISCONNECTED.
        Правило UI: Если false -> Кнопка "Подключить" активна, кнопка "Калибровка" заблокирована.
        Правило каскада: При isWsConnected === false, стор принудительно ставит isDeviceConnected = false.

7. WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

Все сообщения передаются через JSON.stringify({ type, ...payload }).
Client -> Server (Commands)

    { type: 'LIST_PORTS' }
    { type: 'CONNECT', portPath: string, baudRate: number, testMode: boolean } (Если testMode: true, сервер генерирует движение по кругу)
    { type: 'DISCONNECT' }
    { type: 'CALIBRATE_ZERO' }
    { type: 'CONFIGURE_AXES', swapXY: boolean, invertX: boolean, invertY: boolean, rotationDeg: number }

Server -> Client (Events)

    { type: 'DATA', data: StabilogramSample } (Поток 50-100 Гц)
    { type: 'PORTS_LIST', ports: Array<{path, manufacturer}> }
    { type: 'CONNECTED', serialConnected: boolean, calibrated: boolean } (Синхронизация состояния при F5)
    { type: 'SERIAL_CONNECTED', port: string, testMode: boolean }
    { type: 'SERIAL_DISCONNECTED' }
    { type: 'CALIBRATION_STARTED' }
    { type: 'CALIBRATION_COMPLETE', calibration: CalibrationData }
    { type: 'ERROR', error: string }

[END OF KNOWLEDGE BASE]
AI ASSISTANT INSTRUCTION: Acknowledge that you have fully parsed and integrated this knowledge base into your active context. Confirm you will strictly adhere to the "CRITICAL RULES AND ANTI-PATTERNS" section in all future responses.
