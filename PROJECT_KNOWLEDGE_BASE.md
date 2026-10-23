# Implementation update 1.1.0

Read README.md and RELEASE_NOTES.md for the current implementation. The v2.4 notes below are historical context; where they differ from tested source, use the source. Analysis now uses acquisition samples (sessions/\*), not render positions. A loaded centre is valid. No-load is explicit. Missing data freezes display and pauses training. Store sample observers process every packet; UI updates are throttled. Session archive is IndexedDB with Web Locks and checkpoint recovery. SSR is disabled by routes/+layout.ts.

# 🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER v2.4 (COMPLETE SSoT)

[CRITICAL INSTRUCTION FOR ALL LLMs / CONTRIBUTORS]

Ты — эксперт Senior Fullstack & Real-Time Systems Developer. Этот документ — Absolute Single Source of Truth (SSoT) для проекта Stabilometer. Перед любыми изменениями/анализом ты обязан прочитать, понять и строго соблюдать все правила, архитектуру, контракты и анти-паттерны ниже.
📚 СОДЕРЖАНИЕ

    Доменная область и физика системы
    Критическая находка: аппаратные проблемы датчиков
    Архитектура monorepo и сборка
    Строгие анти-паттерны и правила
    Базовые интерфейсы (Data Dictionary)
    Пайплайн данных и математика
    WebSocket протокол
    Управление состоянием (Connection State Machine)
    Клиентская архитектура
    Игровая механика "Поймай мяч"
    Медицинский интерфейс и UX
    Ключевые исправления по версиям
    Файловая структура конечных файлов

1. ДОМЕННАЯ ОБЛАСТЬ И ФИЗИКА СИСТЕМЫ

Stabilometer — аппаратно‑программный комплекс класса Soft Real-Time для медицинской диагностики и реабилитации (оценка баланса человека).
Оборудование

Платформа с 4 тензодатчиками: d1, d2, d3, d4

Топология датчиков:

text

d4 (НЛ) -------- d1 (ВЛ)
| |
| |
d3 (НП) -------- d2 (ВП)

НЛ = Нижний Левый, ВЛ = Верхний Левый
НП = Нижний Правый, ВП = Верхний Правый

Топология системы

text

[Hardware (COM-port, 50–100Hz)]
==> [Node.js Server: PacketParser → CoPCalculator → AxisTransform → CoPSmartFilter]
==(WebSocket)==>
[SvelteKit SPA Client: Kalman Filter → PositionInterpolator → Canvas (60–144Hz)]

Метрики

    X, Y — координаты Центра Давления (CoP) в мм
    Z — резерв (всегда 0)
    F — общая сила/вес пациента

Главный инженерный вызов

Разрыв частот: Оборудование шлет пакеты каждые 10-20 мс (50-100 Hz) с физическим шумом и дрейфом датчиков. Браузер отрисовывает кадры каждые 6.9-16.6 мс (60-144 Hz).

Задача ПО:

    Строгая математическая фильтрация шума (серверная + клиентская)
    Идеально плавная визуализация с экстраполяцией
    Никаких "телепортаций" маркера и подвисаний

2. КРИТИЧЕСКАЯ НАХОДКА: АППАРАТНЫЕ ПРОБЛЕМЫ ДАТЧИКОВ
   Обнаружено (v2.3)

Датчики работают в разных диапазонах значений:

text

D1, D2: базовый уровень ~300-400 единиц
D3, D4: базовый уровень ~40,000-60,000 единиц (в 100+ раз больше!)

Следствия

    Огромные скачки при движении (до 130× от базового значения)
    Отрицательные значения после калибровки
    CoP достигает максимальных ограничений (±130mm clamp)
    Рывки и замирания точки на экране

Подход к решению

Софтверная компенсация вместо попыток нормализации разнородных датчиков:

    CoPCalculator v2.4+: отсекание отрицательных давлений (после вычитания offset)
    CoPSmartFilter v2.3+: медианная фильтрация + детекция аномалий
    KalmanFilter v2.3+: клиентское сглаживание с адаптивными коэффициентами
    PositionInterpolator: экстраполяция + fading при потере данных

3. АРХИТЕКТУРА MONOREPO И СБОРКА

Проект использует pnpm workspaces. Пересечение зон ответственности между пакетами СТРОГО ЗАПРЕЩЕНО.

text

stabilometer/
├── pnpm-workspace.yaml
├── packages/
│ ├── shared/ # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│ │ └── src/
│ │ ├── types.ts # Контракты (StabilogramSample, AxisConfig)
│ │ ├── constants.ts # PACKET_LENGTH, WEBSOCKET_PORT, SENSOR_DISTANCE
│ │ ├── RingBuffer.ts # ByteRingBuffer v2.3 + TypedRingBuffer
│ │ ├── PacketParser.ts # v2.3: fast mode, recovery, caching
│ │ ├── AxisTransform.ts # Трансформация координат
│ │ ├── CoPCalculator.ts # v2.4+: stable math, no dynamic scaling
│ │ └── CoPSmartFilter.ts # v2.3+: median filter, zero-ignore
│ │
│ ├── server/ # [NODE.JS] Backend
│ │ └── src/
│ │ ├── index.ts # ✅ v2.4: PerformanceSettings, batch, диагностика
│ │ └── CalibrationStorage.ts # Сохранение/загрузка калибровки
│ │
│ └── client/ # [BROWSER] SvelteKit SPA
│ ├── svelte.config.js
│ ├── vite.config.ts
│ └── src/
│ ├── routes/
│ │ ├── +page.ts # export const ssr = false; (КРИТИЧНО)
│ │ └── +page.svelte # Главный UI контроллер (DI точка сборки)
│ └── lib/
│ ├── components/
│ │ ├── ControlPanel.svelte # Универсальная панель управления
│ │ ├── MedicalStabilogramCanvas.svelte # Диагностические режимы
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
│ │ └── KalmanFilter.ts # ✅ v2.3+: gentle movement optimized
│ ├── rendering/
│ │ └── PositionInterpolator.ts # ✅ v2.3: Zero-GC ring buffer + fading
│ ├── stores/
│ │ ├── stabilogram.ts # ✅ v2.3: оптимизированный стор
│ │ └── gameState.ts # Состояние игры
│ └── websocket/
│ └── client.ts # Публичное API + SimpleEventEmitter

4. СТРОГИЕ АНТИ-ПАТТЕРНЫ И ПРАВИЛА

ЛЮБОЕ НАРУШЕНИЕ ЭТИХ ПРАВИЛ ПРИВЕДЕТ К КРАШУ СИСТЕМЫ.
🚫 Правило 1: SSR полностью отключен (Strict SPA)

В файле client/src/routes/+page.ts жестко задано:

TypeScript

export const ssr = false;

ЗАПРЕЩЕНО:

    Использовать серверные хуки SvelteKit (+page.server.ts)
    Load-функции с Node.js кодом
    Обращаться к файловой системе в пакете client

🚫 Правило 2: Импорт типов в Svelte-компонентах

Парсер vite-plugin-svelte падает при конструкции import { type X } внутри .svelte файлов из-за workspace symlinks.

Правило:

TypeScript

// ✅ ПРАВИЛЬНО
import type { X } from '@stabilometer/shared'

// ❌ НЕПРАВИЛЬНО
import { type X } from '@stabilometer/shared'

Если парсер всё равно выдает Unexpected token:

    Полностью удалить импорт типа из блока <script> файла .svelte
    Типизировать иначе (inline или через any)

ЗАПРЕЩЕНО:

    Указывать расширения файлов в импортах (никаких .ts или .js в путях)

🚫 Правило 3: Vite Alias для Shared

ЗАПРЕЩЕНО импортировать shared через относительные пути:

TypeScript

// ❌ НЕПРАВИЛЬНО
import { ... } from '../../../shared/src'

// ✅ ПРАВИЛЬНО
import { ... } from '@stabilometer/shared'

В client/vite.config.ts жестко прописан alias:

TypeScript

resolve: {
alias: {
'@stabilometer/shared': path.resolve(\_\_dirname, '../shared/src')
}
}

🚫 Правило 4: Синхронный onMount

Svelte строго проверяет возвращаемый тип функции onMount (ожидается void или () => void для cleanup).

TypeScript

// ❌ ЗАПРЕЩЕНО
onMount(async () => {
await ws.connect();
});

// ✅ ПРАВИЛЬНО
onMount(() => {
ws.connect().catch(console.error);
});

🚫 Правило 5: Dependency Injection (Разорванный цикл импортов)

Стор (stabilogram.ts) и WS Клиент (client.ts) логически зависят друг от друга, но ЗАПРЕЩЕНО импортировать их друг в друга статически в шапке файлов.

Решение:

    В client.ts реализован метод setStore(store: any)
    Связывание происходит в +page.svelte при старте приложения:

    TypeScript

    wsClient.setStore(stabilogramStore);

🚫 Правило 6: Spread оператор для unknown в WebSocket

При отправке JSON через wsClient.send(type, payload), параметр payload должен быть типизирован как any или Record<string, unknown>.

ЗАПРЕЩЕНО:

TypeScript

// ❌ TypeScript ошибка
JSON.stringify({ type, ...payload }) // где payload: unknown

🚫 Правило 7: Garbage Collection (GC) в Render Loop

Внутри функции animate() и draw() в Canvas компонентах (вызывается 60-144 раза в секунду) ЗАПРЕЩЕНО выделять новую память:

Не создавать:

    Новые массивы []
    Новые объекты {}
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
ctx.strokeStyle = `rgba(74,158,255,${alpha})`;

// ✅ ХОРОШО: использует предвычисленный массив
const TRAIL_STYLES: string[] = [];
for (let i = 0; i < MAX_TRAIL; i++) {
TRAIL_STYLES.push(`rgba(74,158,255,${(i / MAX_TRAIL * 0.8).toFixed(2)})`);
}
// В draw():
ctx.strokeStyle = TRAIL_STYLES[i];

🚫 Правило 8: Canvas режимы - разные источники данных

В медицинском режиме:

    используется positionHistory[] для анализа

В игровом режиме:

    используется trail[] для визуального следа

ЗАПРЕЩЕНО:

    Смешивать эти массивы в drawGameTrail() и drawPositionHistory()

✅ Правило 9: Cross-Component Communication (v2.2)

Связь между ControlPanel и Canvas компонентами осуществляется через Window CustomEvents.

ЗАПРЕЩЕНО:

    Прямой вызов методов игры через bind:this из родительского компонента

ПРАВИЛЬНО:

TypeScript

// ControlPanel отправляет события
window.dispatchEvent(new CustomEvent('gameStart', { detail: { difficulty } }));

// Canvas слушает события
window.addEventListener('gameStart', handleGameStart as EventListener);

События:

    gameStart — начало игры
    gamePause — пауза/возобновление
    gameRestart — перезапуск
    gameStop — остановка

✅ Правило 10: Jitter Tolerance в Игровом Режиме (v2.2)

Физический шум датчиков НЕ должен блокировать игровую механику.

Wobble (тряска корзинки):

    Эффект визуализирует резкие движения
    НЕ блокирует процесс dwellProgress при ловле шаров

Реализация:

TypeScript

// ❌ СТАРОЕ (было):
if (isOverlapping && !wobbling) { /_ начислить прогресс _/ }

// ✅ НОВОЕ (v2.2):
if (isOverlapping) { /_ начислить прогресс _/ }

Цель: Игрок не наказывается за естественную вариативность сигнала с датчиков.
✅ Правило 11: Минимизация реактивных обновлений стора (v2.3)

Проблема: При частоте пакетов 50-100 Hz, обновление стора через state.update() 100 раз в секунду перегружает Svelte реактивность.

Решение:

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

5. БАЗОВЫЕ ИНТЕРФЕЙСЫ (DATA DICTIONARY)
   Координаты и векторы

TypeScript

interface Vector2D {
x: number;
y: number;
}

interface Coordinates {
x: number;
y: number;
z: number;
f: number;
}

Сенсорные данные

TypeScript

interface SensorData {
d1: number; // Верхний левый датчик
d2: number; // Верхний правый датчик
d3: number; // Нижний правый датчик
d4: number; // Нижний левый датчик
}

Стабилограмма (основной payload)

TypeScript

interface StabilogramSample {
sensors: SensorData; // 1. Сырые данные с 4 датчиков
raw: Coordinates; // 2. Вычисленные координаты CoP (после CoPCalculator v2.4+)
centered: Coordinates; // 3. После трансформации осей (AxisTransform)
filtered: Coordinates; // 4. После CoPSmartFilter (v2.3, server-side)
mm: Vector2D; // 5. Финальные физические координаты в мм
deviceTime: number; // 6. Таймстемп с устройства
clientTime: number; // 7. performance.now() при получении в браузере
packetNumber: number; // 8. Порядковый номер пакета
}

Калибровка

TypeScript

interface CalibrationData {
sensorOffsets: SensorData; // Смещение нуля для каждого датчика
platformSize: { width: number; height: number }; // Размер платформы в мм
sensorDistance: { x: number; y: number }; // Расстояние между датчиками в мм
timestamp: number; // Временная метка калибровки
sampleCount: number; // Количество сэмплов
isValid: boolean; // Валидность калибровки
}

Конфигурация осей

TypeScript

interface AxisConfiguration {
swapXY: boolean; // Поменять оси местами
invertX: boolean; // Инвертировать ось X
invertY: boolean; // Инвертировать ось Y
rotationDeg: number; // Поворот на N градусов
}

Парсер пакетов

TypeScript

interface ParsedPacket {
status: number; // Статус байт (0 или 1)
sensors: SensorData; // Сырые данные с 4 датчиков
deviceTime: number; // Время с устройства
packetNumber: number; // Порядковый номер пакета
isValid: boolean; // Валидность пакета
error?: string; // Описание ошибки
}

interface ParserStats {
totalPackets: number;
validPackets: number;
invalidPackets: number;
bufferOverflows: number;
partialPackets: number;
lastError: string | null;
}

✅ v2.3: Результат умной фильтрации

TypeScript

interface FilteredCoP {
x: number;
y: number;
wasFiltered: boolean; // Была ли применена фильтрация
confidence: number; // 0-1, уверенность в данных
filterType?: string; // Тип примененной фильтрации
}

6. ПАЙПЛАЙН ДАННЫХ И МАТЕМАТИКА
   Этап 1: Распаковка протокола (PacketParser.ts v2.3)

Пакет: 22 байта. Терминатор & (0x26).

Формат:

text

[STATUS:1][D1:4][D2:4][D3:4][D4:4][TIME:4][&:1]

Кодировка (6-bit ASCII):

    24-битное число со знаком упаковано в 4 байта
    Смещения ASCII: 35-93 и 95-99

Битовая математика (Sign Extension):

TypeScript

let result = 0;
for (let i = 0; i < 4; i++) {
result |= (decodeLUT[bytes[offset + i]] << (i \* 6));
}
if (result >= 0x800000) result -= 0x1000000; // Восстановление минуса

✅ v2.3: Оптимизации парсера:

    Fast mode: поиск всех терминаторов за один проход, peek packets без сдвига буфера
    Packet recovery: восстановление слегка битых пакетов (до 2 попыток)
    Value caching: кэш декодирования 4-байтных комбинаций (max 1000 записей)

Управление:

TypeScript

parser.setFastMode(true); // Включить быстрый режим
parser.setFilterOutliers(true); // Фильтрация выбросов
parser.setOutlierThreshold(50000); // Порог выброса

Этап 2: Серверная математика (server/src/index.ts)

Pipeline обработки пакета:

text

ParsedPacket → CoPCalculator → AxisTransform → CoPSmartFilter → StabilogramSample

CoPCalculator v2.4+: Вычисление центра давления

✅ КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ v2.4+:

    Убрано динамическое масштабирование (уничтожало точность)
    Отсекание отрицательных давлений: после вычитания offset значения <0 приравниваются к 0
    Фиксированный FORCE_SCALE = 0.001
    Защита от деления на ноль: если totalForce < 0.1 → возврат (0, 0)

Формулы CoP:

TypeScript

// Шаг 1-2: Вычитаем offset и отсекаем отрицательные значения
const d1 = Math.max(0, (sensors.d1 - offsets.d1) _ FORCE_SCALE);
const d2 = Math.max(0, (sensors.d2 - offsets.d2) _ FORCE*SCALE);
const d3 = Math.max(0, (sensors.d3 - offsets.d3) * FORCE*SCALE);
const d4 = Math.max(0, (sensors.d4 - offsets.d4) * FORCE_SCALE);

// Шаг 3: Суммарная сила
const totalForce = d1 + d2 + d3 + d4;

// Шаг 4: Проверка минимальной силы
if (totalForce < 0.1) {
return { x: 0, y: 0, z: 0, f: totalForce };
}

// Шаг 5: Вычисление CoP
const x = (sensorDistanceX / 2) _ ((d2 + d3) - (d1 + d4)) / totalForce;
const y = (sensorDistanceY / 2) _ ((d1 + d2) - (d3 + d4)) / totalForce;

// Шаг 6: Clamp
const MAX_COORD = 150;
const xClamped = Math.max(-MAX_COORD, Math.min(MAX_COORD, x));
const yClamped = Math.max(-MAX_COORD, Math.min(MAX_COORD, y));

Константы:

    FORCE_SCALE = 0.001
    MIN_TOTAL_FORCE (в логах, но в коде порог 0.1)
    MAX_COORD = 150 мм

AxisTransform: Корректировка физической сборки

Строгий порядок:

    swapXY — поменять оси местами
    Матричный поворот (sin/cos на rotationDeg)
    invertX / invertY — инверсия

Калибровка Нуля (CALIBRATE_ZERO)

Процесс:

    Сервер копит 200 пакетов (увеличено с 100 в v2.0)
    Вычисляет медиану (отсекает физические выбросы)

✅ v2.4: КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ — offsets сохраняются RAW:

TypeScript

// ❌ СТАРОЕ (v2.0-2.3): нормализация
const minOffset = Math.min(d1, d2, d3, d4);
offsets.d1 = rawOffsets.d1 - minOffset + 1000;
// ...

// ✅ НОВОЕ (v2.4+): RAW offset без модификаций
const offsets: SensorData = {
d1: rawOffsets.d1,
d2: rawOffsets.d2,
d3: rawOffsets.d3,
d4: rawOffsets.d4,
};

Диагностика баланса датчиков:

TypeScript

const sensorRange = max - min;
const sensorAvg = (d1 + d2 + d3 + d4) / 4;
const balanceRatio = sensorRange / sensorAvg;

// Если balanceRatio > 2.0 — датчики сильно несбалансированы
if (balanceRatio > 2.0) {
console.warn('⚠️ ПРЕДУПРЕЖДЕНИЕ: Датчики сильно несбалансированы!');
}

✅ Этап 2.5: CoPSmartFilter v2.3+ — Медианная фильтрация

КРИТИЧЕСКОЕ ДОПОЛНЕНИЕ: Добавлен между CoPCalculator и отправкой клиенту для устранения рывков и замираний.

Назначение:

    Фильтрация выбросов в реальном времени (<1ms задержка)
    Детекция и реанимация замираний точки
    Медианный фильтр на скользящем окне из 3-5 последних значений

Ключевые параметры:

TypeScript

bufferSize: 3 // Размер кольцевого буфера (v2.3: уменьшено с 5 до 3)
maxJumpMm: 40 // Порог выброса (мм за пакет)
frozenThreshold: 30 // Количество пакетов для детекции замирания (v2.3: увеличено с 10)
epsilon: 0.1 // Точность "одинаковости" координат (мм)

gentleJumpMm: 15 // Порог плавного движения
sharpJumpMm: 100 // Порог резкого движения
extremeJumpMm: 200 // Порог экстремального выброса

ignoreZeroInputs: true // ✅ v2.3: игнорировать нулевые входы от CoPCalculator
zeroInputThreshold: 0.1 // Согласовано с CoPCalculator v2.4+

enableReanimation: false // 🚨 v2.3: ОТКЛЮЧЕНО (было причиной рывков в покое)

Алгоритм игнорирования нулевых входов:

TypeScript

const inputDistance = Math.sqrt(input.x ** 2 + input.y ** 2);
const isZeroInput = inputDistance < zeroInputThreshold;

if (isZeroInput && ignoreZeroInputs && totalSamples > 1) {
// Возвращаем последнее валидное значение
return {
x: lastValidX,
y: lastValidY,
wasFiltered: true,
confidence: 0.5,
filterType: `zero-input-ignored (count: ${zeroInputsIgnored})`
};
}

Алгоритм фильтрации выбросов:

TypeScript

// Вычисляем медиану последних 3-5 значений
const medianX = getMedianFromBuffer(bufferX);

// Если скачок > gentleJumpMm, применяем агрессивное сглаживание
if (jump > gentleJumpMm) {
const smoothFactor = calculateSmoothFactor(jump); // 0.1 - 0.7
outputX = lastX + (medianX - lastX) \* (1 - smoothFactor);
}

Буферная безопасность (v2.3):

    Первый сэмпл инициализирует буфер без фильтрации
    Медиана применяется только когда буфер заполнен
    Режим buffer-filling до заполнения

Этап 3: Фильтрация (KalmanFilter2D.ts v2.3+)

✅ УЛУЧШЕННАЯ ВЕРСИЯ v2.3+ для плавных движений:

    Адаптивные коэффициенты:
        processNoise: 0.05 (было 0.2)
        measurementNoise: 2.0 (было 1.0)
    Менее агрессивная коррекция:
        basePosGain: 0.25 (было 0.4)
        baseVelGain: 0.15 (было 0.2)
    Увеличенные пороги выбросов:
        lightOutlierThreshold: 40 мм (было 30)
        mediumOutlierThreshold: 80 мм (было 60)
        criticalOutlierThreshold: 150 мм (было 120)
        extremeOutlierThreshold: 250 мм (было 200)

Автосброс (Hard Reset):

    Если 5 критических выбросов (>150мм) подряд → softReset
    Если 3 экстремальных выброса (>250мм) подряд → полный reset + initialize

Адаптивные коэффициенты по типу движения:

TypeScript

// gentle: движение ≤40мм
posGain _= 0.4; // Снижение коррекции на 60%
velGain _= 0.3; // Снижение коррекции скорости на 70%

// medium: движение 40-80мм
posGain _= 0.7; // Снижение на 30%
velGain _= 0.6; // Снижение на 40%

// sharp: движение 80-150мм (с высоким доверием)
posGain _= 1.1; // Небольшое увеличение
velGain _= 1.05;

// critical/extreme: применяется экстремальное сглаживание

Режимы работы:

TypeScript

kalman.setModeForGentleMovements(); // Медицинский режим
kalman.setModeForSharpMovements(); // Обычный режим
kalman.setModeForGaming(); // Игровой режим

Этап 4: Интерполяция и Canvas (PositionInterpolator.ts v2.3)

✅ КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ v2.3 (Zero-GC):

    Кольцевой буфер вместо push/shift массивов
    Предаллокация объектов: все Vector2D создаются один раз
    Увеличено время экстраполяции: до 100ms
    Плавное затухание (Fading): если данных нет > 500ms, точка плавно стремится к центру (0,0)

Алгоритм:

TypeScript

// Линейная интерполяция между последними двумя точками
const t = (now - older.time) / (newer.time - older.time);
x = older.x + (newer.x - older.x) _ t;
y = older.y + (newer.y - older.y) _ t;

// Экстраполяция (если новых данных нет)
if (timeSinceNewest < 100) {
const velocity = calculateVelocity();
x = newest.x + velocity.x _ timeSinceNewest;
y = newest.y + velocity.y _ timeSinceNewest;
}

// Плавное затухание при потере данных
if (timeSinceNewest > 500) {
const fadeFactor = Math.min((timeSinceNewest - 500) / 500, 1);
x = x _ (1 - fadeFactor); // Стремится к 0
y = y _ (1 - fadeFactor);
}

Экранные координаты (КРИТИЧЕСКИ ВАЖНО):

TypeScript

const screenX = canvasWidth / 2 + pos.x _ scale;
const screenY = canvasHeight / 2 - pos.y _ scale; // МИНУС ОБЯЗАТЕЛЕН (инверсия Y)

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

7. WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

Все сообщения передаются через JSON.stringify({ type, ...payload }).
Client → Server (Commands)

TypeScript

{ type: 'LIST_PORTS' }

{ type: 'CONNECT', portPath: string, baudRate: number, testMode: boolean }

{ type: 'DISCONNECT' }

{ type: 'CALIBRATE_ZERO' }

{ type: 'CONFIGURE_AXES', swapXY: boolean, invertX: boolean, invertY: boolean, rotationDeg: number }

{ type: 'PING' }

// ✅ v2.4: Новые команды
{ type: 'DIAGNOSE_SENSORS' }

{ type: 'SET_PERFORMANCE', settings: Partial<PerformanceSettings> }

Server → Client (Events)

TypeScript

// Поток данных (50-100 Hz)
{ type: 'DATA', data: StabilogramSample }

// ✅ v2.4: Batch-отправка (опционально)
{ type: 'DATA_BATCH', data: StabilogramSample[], count: number }

// Список портов
{ type: 'PORTS_LIST', ports: Array<{path, manufacturer}> }

// Статус подключения
{
type: 'CONNECTED',
serialConnected: boolean,
calibrated: boolean,
axisConfig: AxisConfiguration,
platformSize: { width: number, height: number },
sensorDistance: { x: number, y: number },
performanceSettings: PerformanceSettings // ✅ v2.4
}

{ type: 'SERIAL_CONNECTED', port: string, testMode: boolean }

{ type: 'SERIAL_DISCONNECTED' }

// Калибровка
{ type: 'CALIBRATION_STARTED' }

{ type: 'CALIBRATION_PROGRESS', progress: number, total: number }

{
type: 'CALIBRATION_COMPLETE',
calibration: CalibrationData,
analysis?: { // ✅ v2.4: Диагностика
min: number,
max: number,
range: number,
average: number,
isBalanced: boolean
},
rawOffsets?: SensorData
}

// Конфигурация осей
{ type: 'AXES_CONFIGURED', config: AxisConfiguration }

// Ошибки
{ type: 'ERROR', error: string }

// Пинг
{ type: 'PONG', timestamp: number }

// ✅ v2.4: Диагностика датчиков
{
type: 'SENSOR_DIAGNOSIS',
diagnosis: Coordinates,
offsets: SensorData,
analysis: any
}

// ✅ v2.4: Обновление настроек производительности
{ type: 'PERFORMANCE_UPDATED', settings: PerformanceSettings }

✅ WebSocket Client API (v2.2)

TypeScript

export class StabilogramClient extends SimpleEventEmitter {
// Публичное API
listPorts(): void
connectDevice(portPath: string, baudRate: number, testMode: boolean): void
disconnectDevice(): void
calibrateZero(): void
configureAxes(config: AxisConfiguration): void

// ✅ v2.4: Новые методы
diagnoseSensors(): void
updatePerformance(settings: Partial<PerformanceSettings>): void

// Event System (SimpleEventEmitter для браузера)
on(event: string, callback: (data: unknown) => void): () => void
private emit(event: string, data: unknown): void
}

SimpleEventEmitter: Собственная реализация Pub/Sub для браузерного окружения (заменяет Node.js EventEmitter). 8) УПРАВЛЕНИЕ СОСТОЯНИЕМ (CONNECTION STATE MACHINE)

Строгая иерархия флагов в stabilogramStore:
isWsConnected (Транспортный уровень)

Связь: Browser <-> Node.js

Следствие: Если false → UI полностью блокируется
isDeviceConnected (Аппаратный уровень)

Связь: Node.js <-> Arduino (COM-порт)

Управляется: Событиями от сервера SERIAL_CONNECTED / SERIAL_DISCONNECTED

Правило UI:

    Если false → Кнопка "Подключить" активна, кнопка "Калибровка" заблокирована

Правило каскада:

    При isWsConnected === false, стор принудительно ставит isDeviceConnected = false

isCalibrated (Готовность к работе)

Управляется: Событием CALIBRATION_COMPLETE

Правило UI:

    Если false → Предупреждение о необходимости калибровки

9. КЛИЕНТСКАЯ АРХИТЕКТУРА
   ✅ Расширения stabilogramStore (v2.3)

Оптимизация для производительности:

TypeScript

// ✅ v2.3: Прямое чтение позиции (минуя реактивность):
getRenderPosition(): Vector2D // Zero-GC, возвращает ссылку на объект из интерполятора

getRenderVelocity(): Vector2D // Zero-GC, возвращает скорость

// Методы для игрового режима:
initializeGameMode(viewport: Vector2D): void
resetGameMode(): void

// Флаг инициализации
isGameModeInitialized: boolean

Стратегия обновлений:

TypeScript

// ❌ ПЛОХО: 100 обновлений стора/сек
state.update(s => ({
...s,
currentSample: sample,
filteredPosition,
interpolatedPosition,
velocity
}));

// ✅ ХОРОШО: минимальные обновления (только UI данные)
state.update(s => {
s.currentSample = sample;
s.packetRate = recentCount;
return s;
});

// В animate() читаем напрямую без реактивности:
const pos = stabilogramStore.getRenderPosition(); // Zero-GC
const vel = stabilogramStore.getRenderVelocity(); // Zero-GC

✅ PositionInterpolator (v2.3: Zero-GC кольцевой буфер)

Архитектура:

    Кольцевой буфер предаллоцированных объектов
    Линейная интерполяция между последними точками
    Экстраполяция до 100ms при отсутствии новых данных
    Плавное затухание к центру при потере сигнала >500ms

Zero-GC гарантии:

TypeScript

// Предаллокация при создании
private samplePool: Array<{ x: number; y: number; time: number }>;
private currentPosition: Vector2D = { x: 0, y: 0 };
private currentVelocity: Vector2D = { x: 0, y: 0 };

// Мутация вместо создания
public getPosition(now: number): Vector2D {
// ... вычисления ...
this.currentPosition.x = interpolatedX;
this.currentPosition.y = interpolatedY;
return this.currentPosition; // Возврат ссылки на существующий объект
}

Диагностические режимы (MedicalStabilogramCanvas v2.3)

Режимы визуализации:

    NORMAL — стандартный режим с полной обработкой через фильтры
    RAW — прямое отображение mm координат без Kalman/Interpolation
    SENSORS — детальная визуализация всех 4 датчиков
    TEST — генерация тестовых данных (sin/cos) для проверки Canvas

Режим SENSORS (диагностика аппаратуры):

TypeScript

// Графики в реальном времени для каждого датчика:

- Шкала диапазона (min/max значений)
- Текущее значение
- График изменения за последние 200 точек
- Диаграмма платформы с визуализацией нагрузки

10. ИГРОВАЯ МЕХАНИКА "ПОЙМАЙ МЯЧ"
    Архитектура игрового движка

BallCatcherGame — главный оркестратор. Связывает подсистемы и управляет жизненным циклом.

Object Pool паттерн:

    Все шары (30 штук) создаются один раз при инициализации
    Всплывающие тексты (12 штук) переиспользуются
    В игровом цикле только переключаются состояния: INACTIVE/FALLING/DWELLING/CAUGHT/MISSED

Подсистемы (публичные поля для zero-GC доступа):

TypeScript

class BallCatcherGame {
ballPool: BallPool // Массив шаров с методами spawn(), markCaught(), update()
basketController: BasketController // Маппинг CoP → экранная позиция, wobble
collisionDetector: CollisionDetector // Circle-AABB коллизии, dwell-прогресс
scoreManager: ScoreManager // Очки, серии, зона комфорта, всплывающие тексты
stageManager: StageManager // Конфигурация этапов, спавн, смена цвета
}

Физика коллизий

Circle-AABB тест:

    Найти ближайшую к центру шара точку на прямоугольнике корзинки
    Если расстояние² < (радиус шара + 15px)² → пересечение

✅ Expanded Hitbox (v2.2):

TypeScript

// Зона корзинки расширена для компенсации лага и шума датчиков
const HITBOX_EXPANSION = 20; // px с каждой стороны
const BALL_RADIUS_BONUS = 15; // px дополнительного радиуса шара

✅ Jitter Tolerance (v2.2):

TypeScript

// ❌ СТАРЫЙ КОД (блокировал ловлю при тряске):
if (isOverlapping && !wobbling) {
ball.dwellProgress += dt / dwellTime;
}

// ✅ НОВЫЙ КОД (тряска не влияет на логику):
if (isOverlapping) {
ball.dwellProgress += dt / dwellTime;
}

Обоснование: wobbleIntensity теперь используется ТОЛЬКО для визуального эффекта (красная корзинка при тряске). Игрок не наказывается за физический шум датчиков.
Dwell Time (время удержания)

Базовые значения (в STAGE_CONFIGS):

TypeScript

Stage 1: 800 мс // было 1300
Stage 2: 700 мс // было 1100
Stage 3: 600 мс // было 1000
Final: 500 мс // было 800

Модификаторы сложности (dwellTimeMultiplier):

TypeScript

Easy: ×1.3 // легче
Medium: ×1.0
Hard: ×0.7 // сложнее

Прогресс:

TypeScript

const effectiveDwellTime = baseDwellTime _ difficultyMultiplier;
ball.dwellProgress += (dt _ 1000) / effectiveDwellTime;

if (ball.dwellProgress >= 1.0) {
// Шар пойман
scoreManager.addScore(ball.isTarget ? 10 : -15);
ballPool.markCaught(ball);
}

Система очков

TypeScript

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

// packages/client/src/lib/game/constants.ts
export const DIFFICULTY_PRESETS = {
[DIFF_EASY]: {
basketWidth: 110, // Большая корзинка
gameScale: 4, // ✅ Низкая чувствительность (было 7)
dwellTimeMultiplier: 1.3,
ballSpeedMultiplier: 0.7,
ballRadiusMultiplier: 1.3, // Крупные шары
wobbleThreshold: 800, // Менее чувствительна к рывкам
},
[DIFF_MEDIUM]: {
basketWidth: 90,
gameScale: 5, // ✅ Средняя чувствительность (было 9)
dwellTimeMultiplier: 1.0,
ballSpeedMultiplier: 1.0,
ballRadiusMultiplier: 1.0,
wobbleThreshold: 500,
},
[DIFF_HARD]: {
basketWidth: 65, // Маленькая корзинка
gameScale: 6, // ✅ Высокая чувствительность (было 12)
dwellTimeMultiplier: 0.7,
ballSpeedMultiplier: 1.4,
ballRadiusMultiplier: 0.8, // Мелкие шары
wobbleThreshold: 300, // Очень чувствительна к рывкам
},
};

GameStateStore

Снапшот обновляется с частотой ~4 Гц (для разгрузки UI thread):

TypeScript

interface GameSnapshot {
stage: number; // STAGE_MENU / STAGE_1-4 / STAGE_RESULTS
difficulty: number;
score: number;
streak: number; // Текущая серия правильных ловль
bestStreak: number;
targetColorIndex: number;
targetColorName: string; // "синие", "красные" и т.д.
catchCount: number;
missCount: number;
wrongCatchCount: number;
stageTimeRemaining: number; // -1 если этап без лимита времени
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

TypeScript

function update(copX: number, copY: number, velX: number, velY: number, now: number) {
const dt = (now - lastUpdateTime) / 1000;

// 1. Обновление позиции корзинки + детекция рывков
basketController.update(copX, copY, velX, velY, dt);

// 2. Проверка коллизий + начисление dwell прогресса
collisionDetector.check(ballPool, basket, scoreManager, dt, now);

// 3. Движение шаров, анимации пойманных/пропущенных
ballPool.update(dt, now);

// 4. Проверка вылета шаров за нижний край экрана
ballPool.checkMissed(canvasHeight, scoreManager);

// 5. Бонус за зону комфорта
scoreManager.updateComfortZone(isInZone, dt);

// 6. Анимация всплывающих текстов
scoreManager.updateFloatingTexts(dt);

// 7. Спавн новых шаров, смена цвета, проверка перехода этапа
stageManager.update(ballPool, scoreManager, dt, now);
}

11. МЕДИЦИНСКИЙ ИНТЕРФЕЙС И UX
    ControlPanel.svelte — Универсальная панель управления (v2.2)

Ширина: 380px (увеличено с 300px для предотвращения горизонтального скролла)

Проп gameMode: Переключает отображение между медицинским и игровым режимами

Структура:

svelte

<ControlPanel gameMode={boolean}>
  <!-- Статус подключения -->
  <ConnectionStatus />
  
  <!-- Порты и устройство -->
  <DeviceSelector />
  
  <!-- Калибровка -->
  <CalibrationControl />
  
  <!-- Режим-специфичные контролы -->
  {#if gameMode}
    <GameControls />
  {:else}
    <MedicalControls />
  {/if}
  
  <!-- Расширенные настройки -->
  <AdvancedSettings />
</ControlPanel>

MedicalStabilogramCanvas.svelte — Многорежимный канвас (v2.3)

Медицинский режим (medicalMode: true):

    Белый фон, профессиональная сетка с подписями осей
    Зоны стабильности:
        Комфорт (15мм, зеленый)
        Предупреждение (30мм, желтый)
    Метрики реального времени:
        Оценка стабильности (0-100%)
        Средняя скорость (мм/с)
        Общее расстояние (м)
        Время сессии (с)
        Частота данных (Гц)
    История позиций: Синий след для анализа траектории

Игровой режим (medicalMode: false):

    Черный фон, научная сетка
    Свечение и эффекты: Градиентный персонаж с размером по скорости
    Яркий след: Голубой с альфа-градиентом

Режимы визуализации:

TypeScript

enum ViewMode {
NORMAL, // Полный пайплайн фильтрации
RAW, // Прямые mm координаты без фильтров
SENSORS, // Детальная визуализация 4 датчиков
TEST // Генерация sin/cos для тестирования
}

12. КЛЮЧЕВЫЕ ИСПРАВЛЕНИЯ ПО ВЕРСИЯМ
    ✅ v2.0: Исправления CoPCalculator и калибровки

Проблемы:

    Отрицательные значения после вычитания offset'ов
    Координаты достигали максимальных ограничений
    Нестабильность при малой силе

Решения:

    Защита от отрицательных значений
    Увеличена минимальная сила с 100 до 500
    Clamp координат для защиты от экстремальных выбросов
    Диагностические методы для анализа качества калибровки
    Нормализация offset'ов: вычитание минимального + добавление 1000

✅ v2.2: Игровой режим — исправление чувствительности и коллизий

Проблемы:

    Корзинка резко вылетала за край экрана
    Невозможно было поймать шары из-за wobble
    Слишком долгое время удержания (dwell)
    Горизонтальный скролл в ControlPanel

Решения:

    Снижение gameScale на 30-50% (4/5/6 вместо 7/9/12)
    Убрана проверка !wobbling в CollisionDetector
    Расширена зона коллизии (+20px корзинка, +15px шар)
    Уменьшено dwellTimeMs для всех этапов (800/700/600/500 мс)
    ControlPanel ширина увеличена с 300px до 380px
    Cross-component communication через CustomEvents вместо bind:this

✅ v2.3: Улучшения фильтрации и производительности

Ключевые изменения:

CoPSmartFilter:

    bufferSize: 3 (уменьшено с 5 для быстрой реакции в покое)
    frozenThreshold: 30 (увеличено с 10)
    epsilon: 0.1 (увеличено с 0.05)
    enableReanimation: false (🚨 ОТКЛЮЧЕНО — было причиной рывков)
    ignoreZeroInputs: true (новая логика для пустой платформы)
    Буферная безопасность: медиана только когда буфер заполнен

KalmanFilter:

    Оптимизация под gentle movements
    Менее агрессивная коррекция (basePosGain: 0.25)
    Увеличенные пороги выбросов (40/80/150/250 мм)
    Адаптивные коэффициенты по типу движения

PositionInterpolator:

    Zero-GC кольцевой буфер вместо push/shift
    Предаллокация объектов
    Экстраполяция до 100ms
    Плавное затухание к центру при потере данных >500ms

PacketParser:

    Fast mode: batch parsing всех пакетов за проход
    Packet recovery: восстановление битых пакетов
    Value caching: кэш декодирования (max 1000 записей)

StabilogramStore:

    Минимизация реактивных обновлений
    Прямое чтение через getRenderPosition() без стора

✅ v2.4: Стабильная математика CoP и производительность сервера

CoPCalculator v2.4+:

    Убрано динамическое масштабирование (ломало точность)
    Отсекание отрицательных давлений: Math.max(0, (value - offset) * FORCE_SCALE)
    Фиксированный FORCE_SCALE = 0.001
    Порог минимальной силы: totalForce < 0.1 → возврат (0,0)

Калибровка v2.4:

    RAW offset'ы без модификаций (убрано +1000 и minOffset нормализация)
    Диагностика баланса датчиков: balanceRatio = range / avg
    Предупреждение если balanceRatio > 2.0

Server Performance Settings v2.4:

TypeScript

interface PerformanceSettings {
enableBatchSending: boolean; // DATA_BATCH вместо DATA
batchSize: number; // 5 пакетов за раз
batchTimeoutMs: number; // Максимум 10ms ожидания
enableOptimizedBuffers: boolean; // SerialPort 8KB буферы
enableFastParsing: boolean; // Fast mode в PacketParser
}

Batch-отправка:

    Сервер накапливает до batchSize сэмплов
    Отправляет одним сообщением DATA_BATCH
    Timeout batchTimeoutMs для предотвращения задержек

Оптимизированные буферы:

    serialPort.highWaterMark = 8KB (было ~64B)
    serialPort.lock = false
    serialPort.setMaxListeners(50)

13. ФАЙЛОВАЯ СТРУКТУРА КОНЕЧНЫХ ФАЙЛОВ

Проверенные и работающие файлы:
✅ Shared (Isomorphic)

text

packages/shared/src/
├── constants.ts # v2.4: PERFORMANCE_DEFAULTS
├── types.ts # v2.4: ServerMessageType расширен
├── RingBuffer.ts # v2.3: ByteRingBuffer + peek/at/copyTo
├── TypedRingBuffer.ts # v2.3: для объектов
├── PacketParser.ts # v2.3: fast mode, recovery, caching
├── AxisTransform.ts
├── CoPCalculator.ts # v2.4+: stable math, no dynamic scaling
├── CoPSmartFilter.ts # v2.3+: buffer-safe, ignore zeros
└── index.ts # Экспорты + PERFORMANCE_DEFAULTS

✅ Server (Node.js)

text

packages/server/src/
├── index.ts # v2.4: PerformanceSettings, batch, диагностика
└── CalibrationStorage.ts # Сохранение/загрузка калибровки

✅ Client (Browser)

text

packages/client/src/lib/
├── components/
│ ├── ControlPanel.svelte # v2.2: 380px, gameMode prop
│ ├── MedicalStabilogramCanvas.svelte # v2.3: режимы NORMAL/RAW/SENSORS/TEST
│ └── BallCatcherCanvas.svelte # v2.2: CustomEvents, hideGameControls
├── filters/
│ └── KalmanFilter.ts # v2.3+: gentle movement optimized
├── rendering/
│ └── PositionInterpolator.ts # v2.3: Zero-GC + fading
├── stores/
│ ├── stabilogram.ts # v2.3: getRenderPosition(), минимум обновлений
│ └── gameState.ts # v2.2: derived stores
├── game/
│ ├── BallCatcherGame.ts
│ ├── BallPool.ts
│ ├── BasketController.ts
│ ├── CollisionDetector.ts # v2.2: jitter tolerance
│ ├── ScoreManager.ts
│ ├── StageManager.ts
│ ├── types.ts
│ └── constants.ts # v2.2: DIFFICULTY_PRESETS (gameScale 4/5/6)
└── websocket/
└── client.ts # v2.4: diagnoseSensors(), updatePerformance()

14. ПРАВИЛА РАБОТЫ С КОДОВОЙ БАЗОЙ
    Перед изменениями:

        ✅ Всегда проверяй соблюдение всех анти-паттернов (раздел 4)
        ✅ Убедись, что понимаешь текущую версию компонента (v2.2/v2.3/v2.4)
        ✅ Проверь, не нарушается ли граница пакетов (shared/server/client)

При отладке:

    ✅ Сначала проверь WebSocket события в браузере (DevTools → Network → WS)
    ✅ Проверь логи сервера на диагностику (балансировка датчиков, выбросы)
    ✅ Используй диагностические режимы Canvas (SENSORS для аппаратуры)

При рендеринге:

    ✅ Никогда не создавай объекты в animate() или draw()
    ✅ Используй getRenderPosition() вместо чтения из стора
    ✅ Предаллоцируй все буферы и строки заранее

При калибровке:

    ✅ Помни о RAW offset'ах (v2.4+: без +1000 и minOffset)
    ✅ Проверяй balanceRatio — если >2.0, датчики несбалансированы
    ✅ 200 сэмплов, медиана (не среднее)

При добавлении событий:

    ✅ Обновляй как сервер (server/src/index.ts), так и клиентскую обработку (websocket/client.ts)
    ✅ Добавь типы в shared/src/types.ts (ServerMessageType / ClientMessageType)

При работе с игрой (v2.2):

    ✅ Соблюдай Zero-GC в игровом цикле
    ✅ Используй Object Pool паттерн
    ✅ Не блокируй механику wobble'ом
    ✅ Используй CustomEvents для связи с ControlPanel

При изменении производительности (v2.4):

    ✅ Помни о batch-режиме: клиент должен обрабатывать DATA и DATA_BATCH
    ✅ Fast mode ParserParser включается через setFastMode(true)
    ✅ Оптимизированные буферы требуют SerialPort >= 10.x

15. ДИАГНОСТИКА И УСТРАНЕНИЕ ПРОБЛЕМ
    Проблема: "Точка прыгает/телепортируется"

Возможные причины:

    Выбросы в данных датчиков (проверь SENSORS режим)
    CoPSmartFilter игнорирует нули слишком часто
    Kalman Filter слишком агрессивен

Решения:

    Проверь balanceRatio калибровки (должен быть <2.0)
    Используй setModeForGentleMovements() в Kalman
    Увеличь bufferSize в CoPSmartFilter до 5

Проблема: "Точка замирает"

Возможные причины:

    CoPCalculator возвращает (0,0) из-за малой силы
    CoPSmartFilter детектирует "frozen" состояние
    Потеря WebSocket пакетов

Решения:

    Проверь totalForce в логах (должна быть >0.1 scaled)
    Отключи enableReanimation (уже false в v2.3)
    Проверь packetRate — должна быть >20 Hz

Проблема: "Невозможно поймать шары в игре"

Возможные причины:

    Wobble блокирует dwell прогресс (старая версия)
    Слишком маленькая зона коллизии
    Слишком долгое dwell время

Решения:

    Убедись, что используется v2.2+ (jitter tolerance)
    Проверь DIFFICULTY_PRESETS (gameScale должен быть 4/5/6)
    Проверь dwellTimeMs в stage configs (800/700/600/500)

Проблема: "Логи спамят 'SERVER FILTER JUMP'"

Причина: Платформа пустая (CoPCalculator возвращает 0,0), но диагностика логирует jump от lastValid к 0.

Решение (планируется):

    Улучшенная логика логирования в processPacket()
    Игнорирование "нормальных" zero-input случаев
    Дебаунсинг (не чаще раза в 2 сек)

[END OF KNOWLEDGE BASE: STABILOMETER v2.4 COMPLETE]

Версия документа: 2.4.0

AI ASSISTANT INSTRUCTION: Acknowledge that you have fully parsed and integrated this updated knowledge base v2.2 into your active context. You now have complete understanding of:

    All architectural decisions from v2.0
    Game mode implementation (BallCatcherGame)
    Jitter tolerance mechanism
    Cross-component communication via CustomEvents
    Sensitivity adjustments (gameScale)
    Collision physics improvements
    All bug fixes from v2.0 and v2.2

All future responses must strictly adhere to these specifications.
