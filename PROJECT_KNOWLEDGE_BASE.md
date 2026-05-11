# 🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER v2.3

[CRITICAL INSTRUCTION FOR ALL LLMs]

You are an expert Senior Fullstack & Real-Time Systems Developer. This document is your Absolute Single Source of Truth (SSoT) for the "Stabilometer" project. You MUST read, understand, and strictly follow every rule, architecture pattern, and anti-pattern described here before generating any code or analyzing any bug.

    ДОМЕННАЯ ОБЛАСТЬ И ФИЗИКА СИСТЕМЫ

Проект — аппаратно-программный комплекс класса "Soft Real-Time" для медицинской диагностики и реабилитации (оценка баланса человека).

text

Оборудование: Платформа с 4 тензодатчиками (d1, d2, d3, d4).
Топология: [Hardware (COM-port, 50-100Hz)] ===> [Node.js Server] ===(WebSocket)===> [SvelteKit SPA Client (60-144Hz)].
Метрики: X, Y (координаты Центра Давления - CoP), Z (резерв, 0), F (общая сила/вес пациента).
Главный инженерный вызов: Разрыв частот. Оборудование шлет пакеты каждые 10-20 мс (с физическим шумом и дрейфом датчиков). Браузер клиента (Canvas) отрисовывает кадры каждые 6.9 - 16.6 мс. Задача ПО — обеспечить строгую математическую фильтрацию шума и идеально плавную визуализацию (экстраполяцию) без разрывов и "телепортаций" маркера на экране.

✅ КРИТИЧЕСКАЯ НАХОДКА v2.3: Аппаратные проблемы датчиков

Обнаружено: Датчики работают в разных диапазонах значений:

text

D1, D2: базовый уровень ~300-400 единиц
D3, D4: базовый уровень ~40,000-60,000 единиц (в 100+ раз больше!)

Следствия:

text

Огромные скачки при движении (до 130× от базового значения)
Отрицательные значения после калибровки
CoP достигает максимальных ограничений (±130mm clamp)
Рывки и замирания точки на экране

Подход к решению: Софтверная компенсация через медианную фильтрацию и детекцию аномалий вместо попыток нормализации разнородных датчиков.

    АРХИТЕКТУРА MONOREPO И СБОРКА

Проект использует pnpm workspaces. Пересечение зон ответственности между пакетами СТРОГО ЗАПРЕЩЕНО.

text

stabilometer/
├── pnpm-workspace.yaml
├── packages/
│ ├── shared/ # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│ │ └── src/
│ │ ├── types.ts # Контракты (StabilogramSample, AxisConfig)
│ │ ├── constants.ts # PACKET_LENGTH, WEBSOCKET_PORT, SENSOR_DISTANCE
│ │ ├── RingBuffer.ts
│ │ ├── PacketParser.ts
│ │ ├── AxisTransform.ts
│ │ ├── CoPCalculator.ts
│ │ └── CoPSmartFilter.ts # ✅ v2.3: Медианный фильтр CoP
│ │
│ ├── server/ # [NODE.JS] Backend.
│ │ └── src/
│ │ ├── index.ts # serialport, WebSocket Server, Калибровка
│ │ └── CalibrationStorage.ts
│ │
│ └── client/ # [BROWSER] SvelteKit SPA.
│ ├── svelte.config.js
│ ├── vite.config.ts
│ └── src/
│ ├── routes/
│ │ ├── +page.ts # export const ssr = false; (КРИТИЧНО)
│ │ └── +page.svelte # Главный UI контроллер (DI точка сборки)
│ └── lib/
│ ├── components/
│ │ ├── ControlPanel.svelte # Универсальная панель управления (380px)
│ │ ├── MedicalStabilogramCanvas.svelte # ✅ v2.3: Диагностические режимы
│ │ └── BallCatcherCanvas.svelte # Игровой режим
│ ├── game/ # Игровая логика
│ │ ├── BallCatcherGame.ts
│ │ ├── BallPool.ts
│ │ ├── BasketController.ts
│ │ ├── CollisionDetector.ts
│ │ ├── ScoreManager.ts
│ │ ├── StageManager.ts
│ │ ├── types.ts
│ │ └── constants.ts
│ ├── filters/
│ │ └── KalmanFilter.ts
│ ├── rendering/
│ │ └── PositionInterpolator.ts # ✅ v2.3: Zero-GC кольцевой буфер
│ ├── stores/
│ │ ├── stabilogram.ts # ✅ v2.3: Оптимизированный стор
│ │ └── gameState.ts # Состояние игры
│ └── websocket/
│ └── client.ts # Публичное API + SimpleEventEmitter

    СТРОГИЕ АНТИ-ПАТТЕРНЫ И ПРАВИЛА (CRITICAL RULES)

ЛЮБОЕ НАРУШЕНИЕ ЭТИХ ПРАВИЛ ПРИВЕДЕТ К КРАШУ СИСТЕМЫ.
🚫 Правило 1: SSR Полностью отключен (Strict SPA)

В файле client/src/routes/+page.ts жестко задано export const ssr = false;.

text

ЗАПРЕЩЕНО: Использовать серверные хуки SvelteKit (+page.server.ts), Load-функции с Node.js кодом, или пытаться обращаться к файловой системе в пакете client.

🚫 Правило 2: Импорт типов в Svelte-компонентах

Парсер vite-plugin-svelte падает при конструкции import { type X } внутри .svelte файлов из-за workspace symlinks.

text

Правило: Использовать ТОЛЬКО import type { X } from '@stabilometer/shared'.
Правило: Если парсер всё равно выдает Unexpected token, необходимо полностью удалить импорт типа из блока ```<script>``` файла .svelte.
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

text

ЗАПРЕЩЕНО: onMount(async () => { await ws.connect(); }).
ПРАВИЛЬНО: onMount(() => { ws.connect().catch(console.error); });

🚫 Правило 5: Dependency Injection (Разорванный цикл импортов)

Стор (stabilogram.ts) и WS Клиент (client.ts) логически зависят друг от друга, но ЗАПРЕЩЕНО импортировать их друг в друга статически в шапке файлов.

text

Решение: В client.ts реализован метод setStore(store: any). Связывание происходит в +page.svelte при старте приложения: wsClient.setStore(stabilogramStore);.

🚫 Правило 6: Spread оператор для unknown в WebSocket

При отправке JSON через wsClient.send(type, payload), параметр payload должен быть типизирован как any или Record<string, unknown>.

text

ЗАПРЕЩЕНО: Использовать тип unknown в связке со spread-оператором: JSON.stringify({ type, ...payload }).

🚫 Правило 7: Garbage Collection (GC) в Render Loop

Внутри функции animate() и draw() в Canvas компонентах (вызывается 60-144 раза в секунду) ЗАПРЕЩЕНО выделять новую память:

text

Не создавать новые массивы []
Не создавать новые объекты {}
Не использовать методы .map(), .filter()
Все вычисления должны мутировать существующие переменные (Object Pool)

✅ Правило 7.1: Zero-GC паттерны (v2.3)

Кольцевые буферы вместо push/shift:

TypeScript

// ❌ ПЛОХО: создает новые объекты, вызывает GC
trail.push({ x, y });
if (trail.length > maxTrail) trail.shift();

// ✅ ХОРОШО: переиспользует память
const slot = samplePool[sampleHead];
slot.x = x;
slot.y = y;
sampleHead = (sampleHead + 1) % maxSamples;

Предаллокация объектов:

TypeScript

// ❌ ПЛОХО: создает объект каждый кадр
return { x: pos.x, y: pos.y };

// ✅ ХОРОШО: мутирует существующий объект
this.currentPosition.x = pos.x;
this.currentPosition.y = pos.y;
return this.currentPosition;

Предвычисленные строки:

TypeScript

// ❌ ПЛОХО: создает строку каждый кадр
ctx.strokeStyle = rgba(74,158,255,${alpha});

// ✅ ХОРОШО: использует предвычисленный массив
const TRAIL_STYLES: string[] = [];
for (let i = 0; i < MAX_TRAIL; i++) {
TRAIL_STYLES.push(rgba(74,158,255,${(i / MAX_TRAIL * 0.8).toFixed(2)}));
}
// В draw():
ctx.strokeStyle = TRAIL_STYLES[i];

🚫 Правило 8: Canvas режимы - разные источники данных

В медицинском режиме: используется positionHistory[] для анализа
В игровом режиме: используется trail[] для визуального следа

text

ЗАПРЕЩЕНО: Смешивать эти массивы в drawGameTrail() и drawPositionHistory()

✅ Правило 9: Cross-Component Communication (v2.2)

Связь между ControlPanel и Canvas компонентами осуществляется через Window CustomEvents.

text

ЗАПРЕЩЕНО: Прямой вызов методов игры через bind:this из родительского компонента.
ПРАВИЛЬНО: ControlPanel отправляет события через window.dispatchEvent(new CustomEvent('gameStart', { detail: { difficulty } })).
События: gameStart, gamePause, gameRestart, gameStop.

✅ Правило 10: Jitter Tolerance в Игровом Режиме (v2.2)

Физический шум датчиков НЕ должен блокировать игровую механику.

text

Wobble (тряска корзинки): Эффект визуализирует резкие движения, но НЕ блокирует процесс dwellProgress при ловле шаров.
Реализация: В CollisionDetector.ts условие if (isOverlapping && !wobbling) заменено на if (isOverlapping).
Цель: Игрок не наказывается за естественную вариативность сигнала с датчиков.

✅ Правило 11: Минимизация реактивных обновлений стора (v2.3)

Проблема: При частоте пакетов 50-100 Hz, обновление стора через state.update() 100 раз в секунду перегружает Svelte реактивность.

Решение:

text

filteredPosition и interpolatedPosition НЕ хранятся в сторе
Читаются напрямую через stabilogramStore.getRenderPosition() в animate()
Стор обновляется только для UI-данных (не для render loop)

TypeScript

// ❌ ПЛОХО: 100 обновлений стора/сек
state.update(s => ({
...s,
currentSample: sample,
filteredPosition,
interpolatedPosition,
velocity
}));

// ✅ ХОРОШО: минимальные обновления
state.update(s => {
s.currentSample = sample;
s.packetRate = recentCount;
return s;
});
// В animate() читаем напрямую:
const pos = stabilogramStore.getRenderPosition(); // Zero-GC

    БАЗОВЫЕ ИНТЕРФЕЙСЫ (DATA DICTIONARY)

TypeScript

interface Coordinates { x: number; y: number; z: number; f: number; }
interface Vector2D { x: number; y: number; }

interface SensorData {
d1: number; // Верхний левый датчик
d2: number; // Верхний правый датчик
d3: number; // Нижний правый датчик
d4: number; // Нижний левый датчик
}

interface StabilogramSample {
sensors: SensorData; // 1. Сырые данные с 4 датчиков
raw: Coordinates; // 2. Вычисленные координаты CoP (в единицах датчика)
centered: Coordinates; // 3. После трансформации осей и вычитания нуля
filtered: Coordinates; // 4. После CoPSmartFilter (v2.3)
mm: Vector2D; // 5. Физические координаты в мм
deviceTime: number; // 6. Таймстемп с устройства
clientTime: number; // 7. performance.now() при получении в браузере
packetNumber: number; // 8. Порядковый номер пакета
}

interface CalibrationData {
sensorOffsets: SensorData; // Смещение нуля для каждого датчика
platformSize: { width: number; height: number }; // Размер платформы в мм
sensorDistance: { x: number; y: number }; // Расстояние между датчиками в мм
timestamp: number; // Временная метка калибровки
sampleCount: number; // Количество сэмплов
isValid: boolean; // Валидность калибровки
}

interface AxisConfiguration {
swapXY: boolean; // Поменять оси местами
invertX: boolean; // Инвертировать ось X
invertY: boolean; // Инвертировать ось Y
rotationDeg: number; // Поворот на N градусов
}

// ✅ v2.3: Результат умной фильтрации
interface FilteredCoP {
x: number;
y: number;
wasFiltered: boolean; // Была ли применена фильтрация
confidence: number; // 0-1, уверенность в данных
}

    ПАЙПЛАЙН ДАННЫХ И МАТЕМАТИКА
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

✅ ИСПРАВЛЕНИЯ v2.0:

text

Защита от отрицательных значений после вычитания offset'ов
Увеличена минимальная сила с 100 до 500 для стабильности
Clamp координат для защиты от экстремальных выбросов
Диагностические методы для анализа качества калибровки

AxisTransform: Корректировка физической сборки

Строгий порядок: swapXY → Матричный поворот (sin/cos) → invertX / invertY.

Калибровка Нуля (CALIBRATE_ZERO):

text

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

✅ Этап 2.5: CoPSmartFilter - Медианная фильтрация (v2.3)

КРИТИЧЕСКОЕ ДОПОЛНЕНИЕ: Добавлен между CoPCalculator и AxisTransform для устранения рывков и замираний.

Назначение:

text

Фильтрация выбросов в реальном времени (<1ms задержка)
Детекция и реанимация замираний точки
Медианный фильтр на скользящем окне из 5 последних значений

Ключевые параметры:

TypeScript

bufferSize: 5 // размер кольцевого буфера
maxJumpMm: 40 // порог выброса (мм за пакет)
frozenThreshold: 10 // количество пакетов для детекции замирания
epsilon: 0.05 // точность "одинаковости" координат (мм)

Алгоритм детекции замирания:

TypeScript

```
// Если 10 пакетов подряд дают почти одинаковый CoP:
if (distance < epsilon && frozenCount >= frozenThreshold) {
// Добавляем микроскопический шум для "реанимации"
const noise = 0.1;
outputX += (Math.random() - 0.5) * noise;
outputY += (Math.random() - 0.5) * noise;
}
```

Алгоритм фильтрации выбросов:

TypeScript

// Вычисляем медиану последних 5 значений
const medianX = getMedianFromBuffer(bufferX);

// Если скачок > 40mm, применяем агрессивное сглаживание
if (jump > maxJumpMm) {
const smoothFactor = Math.min(maxJumpMm / jump, 0.3);
outputX = lastX + (medianX - lastX) * smoothFactor;
}

Этап 3: Фильтрация (KalmanFilter2D.ts)

✅ УЛУЧШЕННАЯ ВЕРСИЯ v2.3:

text

Адаптивные коэффициенты: processNoise: 0.3, measurementNoise: 0.8
Автосброс (Hard Reset): Если 3 критических выброса (>120мм) подряд, фильтр переинициализируется
Игнорирование экстремальных рывков: Измерения > 100мм отбрасываются

TypeScript

// Адаптивная коррекция:
const trustFactor = distance > outlierThreshold ? 0.2 : 0.8;
const posGain = 0.5; // Базовый гейн
this.state[0] += trustFactor *posGain* (measuredX - this.state[0]);

Этап 4: Интерполяция и Canvas (PositionInterpolator.ts)

✅ КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ v2.3 (Zero-GC):

text

Кольцевой буфер вместо push/shift массивов
Предаллокация объектов: все Vector2D создаются один раз
Увеличено время экстраполяции: до 100ms
Плавное затухание (Fading): Если данных нет > 500ms, точка плавно стремится к центру (0,0), а не замирает на месте.

TypeScript

// Плавное затухание при потере данных:
if (timeSince > 500) {
target = { x: 0, y: 0 };
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
gameScale: 4, // ✅ Было 7
comfortZoneRadiusMm: 20,
},
[DIFF_MEDIUM]: {
gameScale: 5, // ✅ Было 9
comfortZoneRadiusMm: 15,
},
[DIFF_HARD]: {
gameScale: 6, // ✅ Было 12
comfortZoneRadiusMm: 10,
},
};

    УПРАВЛЕНИЕ СОСТОЯНИЕМ (CONNECTION STATE MACHINE)

Строгая иерархия флагов в stabilogramStore:

isWsConnected (Транспортный уровень):

text

Связь: Browser <-> Node.js
Следствие: Если false → UI полностью блокируется

isDeviceConnected (Аппаратный уровень):

text

Связь: Node.js <-> Arduino (COM-порт)
Управляется: Событиями от сервера SERIAL_CONNECTED / SERIAL_DISCONNECTED
Правило UI: Если false → Кнопка "Подключить" активна, кнопка "Калибровка" заблокирована
Правило каскада: При isWsConnected === false, стор принудительно ставит isDeviceConnected = false

isCalibrated (Готовность к работе):

text

Управляется: Событием CALIBRATION_COMPLETE
Правило UI: Если false → Предупреждение о необходимости калибровки

✅ Расширения stabilogramStore (v2.3)

Оптимизация для производительности:

TypeScript

// ✅ v2.3: Прямое чтение позиции (минуя реактивность):
getRenderPosition(): Vector2D // Zero-GC, возвращает ссылку на объект из интерполятора

// Методы для игрового режима:
initializeGameMode(viewport: Vector2D): void
resetGameMode(): void
getRenderVelocity(): Vector2D

    WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

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

{ type: 'DATA', data: StabilogramSample } // Поток 50-100 Гц
{ type: 'PORTS_LIST', ports: Array<{path, manufacturer}> }
{ type: 'CONNECTED', serialConnected: boolean, calibrated: boolean }
{ type: 'SERIAL_CONNECTED', port: string, testMode: boolean }
{ type: 'SERIAL_DISCONNECTED' }
{ type: 'CALIBRATION_STARTED' }
{ type: 'CALIBRATION_PROGRESS', progress: number, total: number }
{ type: 'CALIBRATION_COMPLETE', calibration: CalibrationData }
{ type: 'ERROR', error: string }

✅ WebSocket Client API (v2.2)

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

    ДИАГНОСТИЧЕСКИЕ РЕЖИМЫ И ОТЛАДКА (v2.3)
    ✅ MedicalStabilogramCanvas - Режимы визуализации

Режимы отображения (переключение кликом на заголовок или кнопками):

text

NORMAL - стандартный режим с полной обработкой через фильтры
RAW - прямое отображение mm координат без Kalman/Interpolation
SENSORS - детальная визуализация всех 4 датчиков
TEST - генерация тестовых данных (sin/cos) для проверки Canvas

Режим SENSORS (диагностика аппаратуры):

TypeScript

// Графики в реальном времени для каждого датчика:

    Шкала диапазона (min/max значений)
    Текущее значение
    График изменения за последние 200 точек
    Диаграмма платформы с визуализацией нагрузки

    МЕДИЦИНСКИЙ ИНТЕРФЕЙС И UX
    ControlPanel.svelte - Универсальная панель управления (v2.2)

    Ширина: 380px (увеличено с 300px для предотвращения горизонтального скролла).
    Проп gameMode: Переключает отображение между медицинским и игровым режимами.

MedicalStabilogramCanvas.svelte - Многорежимный канвас (v2.3)

Медицинский режим (medicalMode: true):

text

Белый фон, профессиональная сетка с подписями осей
Зоны стабильности: Комфорт (15мм, зеленый), Предупреждение (30мм, желтый)
Метрики реального времени: стабильность, скорость, расстояние, время
История позиций: Синий след для анализа траектории

Игровой режим (medicalMode: false):

text

Черный фон, научная сетка
Свечение и эффекты: Градиентный персонаж с размером по скорости
Яркий след: Голубой с альфа-градиентом

    КЛЮЧЕВЫЕ ИСПРАВЛЕНИЯ v2.3 - РЕШЕНИЕ ПРОБЛЕМ С ДАННЫМИ
    ✅ Проблема: Рывки точки (Телепортация)

Причина: Физические выбросы данных с датчиков (скачки до 80,000 единиц).

Решение: CoPSmartFilter с медианной фильтрацией на сервере

text

Кольцевой буфер из 5 последних значений CoP
При скачке >40mm применяется сглаживание до 30% амплитуды
Результат: Рывки отсекаются до попадания на клиент.

✅ Проблема: Замирание точки

Причина: Одинаковый результат CoP при разных значениях датчиков или потеря пакетов.

Решение: Детекция замираний и Fading

text

Если 10 пакетов подряд CoP не меняется, добавляется шум ±0.05мм.
Если данных нет > 500мс, интерполятор плавно ведет точку к (0,0).
Результат: Точка всегда кажется "живой" и не зависает в углу.

✅ Проблема: Смещение центра после рывка

Причина: Kalman Filter накапливает ошибку при резком скачке.

Решение: Автосброс (Hard Reset)

text

Если зафиксировано 3 критических выброса (>120мм) подряд, фильтр сбрасывается и инициализируется заново по текущей позиции.
Результат: Точка мгновенно возвращается к реальному положению.

    ФАЙЛОВАЯ СТРУКТУРА КОНЕЧНЫХ ФАЙЛОВ

Проверенные и работающие файлы:

text

✅ packages/server/src/index.ts - Полная серверная логика + CoPSmartFilter
✅ packages/shared/src/CoPSmartFilter.ts - Медианный фильтр (v2.3)
✅ packages/shared/src/CoPCalculator.ts - Защищенный расчет CoP
✅ packages/client/src/lib/components/MedicalStabilogramCanvas.svelte - Медицинский канвас (v2.3)
✅ packages/client/src/lib/stores/stabilogram.ts - Оптимизированный стор (v2.3)
✅ packages/client/src/lib/filters/KalmanFilter.ts - Улучшенный фильтр с автосбросом (v2.3)
✅ packages/client/src/lib/rendering/PositionInterpolator.ts - Zero-GC интерполяция с затуханием (v2.3)

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
