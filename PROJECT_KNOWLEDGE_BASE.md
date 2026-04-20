# 🧠 AI SYSTEM PROMPT & MASTER KNOWLEDGE BASE: STABILOMETER

[CRITICAL INSTRUCTION FOR ALL LLMs]

You are an expert Senior Fullstack & Real-Time Systems Developer. This document is your Absolute Single Source of Truth (SSoT) for the "Stabilometer" project. You MUST read, understand, and strictly follow every rule, architecture pattern, and anti-pattern described here before generating any code or analyzing any bug. Do NOT hallucinate standard SvelteKit, Vite, or Node.js patterns if they contradict the rules established in this document.

## 1. ДОМЕННАЯ ОБЛАСТЬ И ФИЗИКА СИСТЕМЫ
Ы
Проект — аппаратно-программный комплекс класса "Soft Real-Time" для медицинской диагностики и реабилитации (оценка баланса человека).

- **Оборудование**: Платформа с 4 тензодатчиками.
- **Топология**: [Hardware (COM-port, 50-100Hz)] ===> [Node.js Server] ===(WebSocket)===> [SvelteKit SPA Client (60-144Hz)].
- **Метрики**: X, Y (координаты Центра Давления - CoP), Z (резерв, 0), F (общая сила/вес пациента).
- **Главный инженерный вызов**: Разрыв частот. Оборудование шлет пакеты каждые 10-20 мс (с физическим шумом и дрейфом датчиков). Браузер клиента (Canvas) отрисовывает кадры каждые 6.9 - 16.6 мс. Задача ПО — обеспечить строгую математическую фильтрацию шума и идеально плавную визуализацию (экстраполяцию) без разрывов и "телепортаций" маркера на экране.

## 2. АРХИТЕКТУРА MONOREPO И СБОРКА

Проект использует pnpm workspaces. Пересечение зон ответственности между пакетами СТРОГО ЗАПРЕЩЕНО.
stabilometer/
├── pnpm-workspace.yaml
├── packages/
│ ├── shared/ # [ISOMORPHIC] Только чистый TS. Никаких DOM/Node API.
│ │ └── src/
│ │ ├── types.ts # Контракты (StabilogramSample, AxisConfig)
│ │ ├── constants.ts # PACKET_LENGTH, TERMINATOR, WEBSOCKET_PORT
│ │ ├── RingBuffer.ts # Memory-safe буферы
│ │ ├── PacketParser.ts # Распаковка 6-bit ASCII
│ │ └── AxisTransform.ts# Вращение и инверсия координат
│ │
│ ├── server/ # [NODE.JS] Backend.
│ │ └── src/
│ │ └── index.ts # serialport, WebSocket Server, Калибровка, Масштаб
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
│ │ └── StabilogramCanvas.svelte # Рендеринг (requestAnimationFrame)
│ ├── filters/
│ │ └── KalmanFilter.ts # Сглаживание шума датчиков
│ ├── rendering/
│ │ └── PositionInterpolator.ts # Экстраполяция 50Hz -> 144Hz
│ ├── stores/
│ │ └── stabilogram.ts # Svelte Store (Бизнес-логика)
│ ├── websocket/
│ │ └── client.ts # WS Клиент
│ └── game/ # [ИГРОВОЙ РЕЖИМ]
│ ├── BallCatcherGame.ts # Главный оркестратор
│ ├── BallPool.ts # Object Pool шаров
│ ├── BasketController.ts # Управление корзинкой
│ ├── CollisionDetector.ts # Проверка столкновений
│ ├── ScoreManager.ts # Очки, серии
│ ├── StageManager.ts # Управление этапами
│ ├── constants.ts # Константы игры
│ └── types.ts # Игровые типы

## 3. СТРОГИЕ АНТИ-ПАТТЕРНЫ И ПРАВИЛА (CRITICAL RULES)

**ЛЮБОЕ НАРУШЕНИЕ ЭТИХ ПРАВИЛ ПРИВЕДЕТ К КРАШУ СИСТЕМЫ.**

### 🚫 Правило 1: SSR Полностью отключен (Strict SPA)

В файле `client/src/routes/+page.ts` жестко задано `export const ssr = false;`.

- **ЗАПРЕЩЕНО**: Использовать серверные хуки SvelteKit (`+page.server.ts`), Load-функции с Node.js кодом, или пытаться обращаться к файловой системе в пакете `client`.

### 🚫 Правило 2: Импорт типов в Svelte-компонентах

Парсер `vite-plugin-svelte` падает при конструкции `import { type X }` внутри `.svelte` файлов из-за workspace symlinks.

- **Правило**: Использовать ТОЛЬКО `import type { X } from '@stabilometer/shared'`.
- **Правило**: Если парсер всё равно выдает `Unexpected token`, необходимо полностью удалить импорт типа из блока `<script>` файла `.svelte`.
- **ЗАПРЕЩЕНО**: Указывать расширения файлов в импортах (никаких `.ts` или `.js` в путях).

### 🚫 Правило 3: Vite Alias для Shared

**ЗАПРЕЩЕНО** импортировать `shared` через относительные пути (например, `../../../shared/src`).

В `client/vite.config.ts` жестко прописан alias. Используйте только:

```typescript
import { X } from '@stabilometer/shared';
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

Стор (stabilogram.ts) и WS Клиент (client.ts) логически зависят друг от друга, но ЗАПРЕЩЕНО импортировать их друг в друга статически в шапке файлов (вызовет ошибку Vite doesn't provide an export named X).

    Решение: В client.ts реализован метод setStore(store: any). Связывание происходит в +page.svelte при старте приложения: wsClient.setStore(stabilogramStore);.

🚫 Правило 6: Spread оператор для unknown в WebSocket

При отправке JSON через wsClient.send(type, payload), параметр payload должен быть типизирован как any или Record<string, unknown>.

    ЗАПРЕЩЕНО: Использовать тип unknown в связке со spread-оператором: JSON.stringify({ type, ...payload }) — TypeScript скомпилирует это так, что данные потеряются.

🚫 Правило 7: Garbage Collection (GC) в Render Loop

Внутри функции animate() и draw() в StabilogramCanvas.svelte (вызывается 60-144 раза в секунду) ЗАПРЕЩЕНО выделять новую память:

    Не создавать новые массивы []
    Не создавать новые объекты {}
    Не использовать методы .map(), .filter()

Все вычисления должны мутировать существующие переменные (Object Pool), иначе возникнут GC-паузы (микрофризы на экране).

## 4. БАЗОВЫЕ ИНТЕРФЕЙСЫ (DATA DICTIONARY)
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

## 5. ПАЙПЛАЙН ДАННЫХ И МАТЕМАТИКА
Этап 1: Распаковка протокола (PacketParser.ts)

    Пакет: 22 байта. Терминатор & (0x26). Формат: STATUS[1] + X[4] + Y[4] + Z[4] + F[4] + TIME[4] + &
    Кодировка (6-bit ASCII): 24-битное число со знаком упаковано в 4 байта. Смещения ASCII: 35-93 и 95-99.
    Битовая математика (Sign Extension):
let result = 0;
for (let i = 0; i < 4; i++) {
  result |= (decodeLUT[bytes[offset + i]] << (i * 6));
}
if (result >= 0x800000) result -= 0x1000000; // Восстановление минуса

Этап 2: Серверная математика (server/src/index.ts)

    AxisTransform: Корректировка физической сборки. Строгий порядок: swapXY → Матричный поворот (sin/cos) → invertX / invertY.
    Калибровка Нуля (CALIBRATE_ZERO): Сервер копит 100 пакетов и вычисляет Медиану (отсекает физические выбросы от случайных рывков пациента). Сохраняет как center.
    Масштабирование: mm.x = (transformed.x - center.x) * 0.01. (Константа MM_PER_UNIT).

Этап 3: Фильтрация (KalmanFilter2D.ts)

    Модель: Дискретная модель постоянной скорости. Состояние [x, y, vx, vy].
    Обновление: dt вычисляется динамически между приходом WS-пакетов. Убирает высокочастотный тремор датчиков, сохраняя реакцию на движения тела.

Этап 4: Интерполяция и Canvas (PositionInterpolator.ts)

    Экстраполяция: Если кадр рендерится, а новый пакет (50 Гц) еще не пришел, позиция предсказывается: target.x = last.x + last.vx * dt.
    Экранные координаты (КРИТИЧЕСКИ ВАЖНО): Физический ноль — центр платформы. В Canvas ноль — левый верхний угол. Ось Y в Canvas инвертирована относительно декартовой физики.
const screenX = canvasWidth / 2 + pos.x * scale;
const screenY = canvasHeight / 2 - pos.y * scale; // МИНУС ОБЯЗАТЕЛЕН

## 6. УПРАВЛЕНИЕ СОСТОЯНИЕМ (CONNECTION STATE MACHINE)

Строгая иерархия флагов в stabilogramStore:
isWsConnected (Транспортный уровень):

    Связь: Browser <-> Node.js.
    Следствие: Если false → UI полностью блокируется.

isDeviceConnected (Аппаратный уровень):

    Связь: Node.js <-> Arduino (COM-порт).
    Управляется: Событиями от сервера SERIAL_CONNECTED / SERIAL_DISCONNECTED.
    Правило UI: Если false → Кнопка "Подключить" активна, кнопка "Калибровка" заблокирована.
    Правило каскада: При isWsConnected === false, стор принудительно ставит isDeviceConnected = false.

## 7. WEBSOCKET ПРОТОКОЛ (API CONTRACTS)

Все сообщения передаются через JSON.stringify({ type, ...payload }).
Client → Server (Commands)

    { type: 'LIST_PORTS' }
    { type: 'CONNECT', portPath: string, baudRate: number, testMode: boolean } (Если testMode: true, сервер генерирует движение по кругу)
    { type: 'DISCONNECT' }
    { type: 'CALIBRATE_ZERO' }
    { type: 'CONFIGURE_AXES', swapXY: boolean, invertX: boolean, invertY: boolean, rotationDeg: number }

Server → Client (Events)

    { type: 'DATA', data: StabilogramSample } (Поток 50-100 Гц)
    { type: 'PORTS_LIST', ports: Array<{path, manufacturer}> }
    { type: 'CONNECTED', serialConnected: boolean, calibrated: boolean } (Синхронизация состояния при F5)
    { type: 'SERIAL_CONNECTED', port: string, testMode: boolean }
    { type: 'SERIAL_DISCONNECTED' }
    { type: 'CALIBRATION_STARTED' }
    { type: 'CALIBRATION_COMPLETE', calibration: CalibrationData }
    { type: 'ERROR', error: string }

## 8. ИГРОВОЙ РЕЖИМ «ПОЙМАЙ МЯЧ»
8.1. Архитектура и компоненты

Игровой режим — это медицинская реабилитационная игра-тренажёр для развития баланса у детей и взрослых. Пациент управляет виртуальной корзинкой, смещая центр давления (CoP) на платформе.

Топология: Hardware (CoP 50Hz) → Server → WS → stabilogramStore → BallCatcherGame → Canvas (60-144Hz)

Главные компоненты (все в packages/client/src/lib/game/):
Файл Ответственность ZERO-GC гарантия
BallCatcherGame.ts Главный оркестратор, жизненный цикл ✅ update() — только мутация
BallPool.ts Object Pool шаров (предаллокация 30 шт) ✅ spawn/update — мутация полей
BasketController.ts Маппинг CoP → корзинка, wobble-эффект ✅ Единственный экземпляр Basket
CollisionDetector.ts Circle-AABB collision, dwell-таймер ✅ Скалярная арифметика
ScoreManager.ts Очки, серии, всплывающие тексты ✅ FloatingText[] pool
StageManager.ts Этапы, спавн шаров, смена цвета ✅ spawn() — примитивы
constants.ts Все магические числа, цвета (предаллоцированные строки) N/A (константы)
types.ts Интерфейсы игровых объектов (примитивные поля) N/A (типы)

КРИТИЧЕСКОЕ ПРАВИЛО: Игра работает в том же render loop, что и стабилограмма (60-144 Гц). Абсолютно запрещены любые аллокации в update() и draw().

### 8.2. Object Pool паттерн и ZERO-GC гарантии
Проблема: Создание объектов в цикле 144 Гц → GC-паузы → микрофризы → разрушение иммерсии.

Решение: Все игровые объекты создаются ОДИН РАЗ при старте игры. В runtime — ТОЛЬКО мутация существующих полей.
Object Pool таблица:
Тип объекта Размер пула Когда создаётся Как активируется
Ball[] 30 (MAX_BALLS) Конструктор BallPool pool.spawn(x,y,vx,vy,...) → мутация неактивного слота
Basket 1 (singleton) Конструктор BasketController N/A (всегда активен)
FloatingText[] 12 (MAX_FLOATING_TEXTS) Конструктор ScoreManager spawnFloatingText() → мутация

Пример ZERO-GC spawn (из BallPool.ts):
// ✅ ПРАВИЛЬНО (ZERO-GC):
spawn(x: number, y: number, vx: number, vy: number, ...): number {
  for (let i = 0; i < this.capacity; i++) {
    if (this.balls[i].state !== BALL_STATE_INACTIVE) continue;
    
    const b = this.balls[i];
    b.x = x;                    // Мутация примитива
    b.y = y;                    // Мутация примитива
    b.state = BALL_STATE_FALLING;
    // ... остальные поля
    return i;
  }
  return -1; // Пул исчерпан
}

// ❌ ЗАПРЕЩЕНО (аллокация):
spawn(x: number, y: number): void {
  this.balls.push({ x, y, state: FALLING }); // КРАШНЕТ GC!
}

Жизненный цикл шара (state machine):
INACTIVE → spawn() → FALLING ⇄ DWELLING → markCaught() → CAUGHT → [anim] → INACTIVE
                         ↓                    markMissed() → MISSED → [anim] → INACTIVE
                     deactivate()

8.3. Жизненный цикл игры
Порядок обновления (каждый кадр, 60-144 Гц):
// В BallCatcherGame.update(copX, copY, velX, velY, now):
1. basketController.update(copX, copY, velX, velY, dt)
2. collisionDetector.check(pool, basket, score, dt, now)  // До обновления шаров!
3. ballPool.update(dt, now)
4. checkOffScreenBalls()
5. handleComfortZone(copX, copY, dt)
6. scoreManager.updateFloatingTexts(dt)
7. stageManager.update(score, pool, wobble, dt, now)
8. Проверка перехода этапа
ВАЖНО: collisionDetector.check() вызывается ДО ballPool.update(), чтобы столкновения проверялись на позициях предыдущего кадра (даёт визуальное преимущество игроку — «прощение» сдвига).

Состояния игры:
Состояние isRunning isPaused UI
Меню false false Выбор сложности
Игра true false Рендеринг игры
Пауза (WS disconnect) true true Overlay «Переподключение...»
Результаты true false Финальный счёт, кнопка «Заново»

8.4. Физика и маппинг координат
CoP → Корзинка (экранные координаты):
// BasketController.update():
const rawX = canvasWidth * 0.5 + copX * gameScale;
const rawY = canvasHeight * 0.5 - copY * gameScale;  // ← МИНУС!
КРИТИЧНО: Ось Y инвертирована. Физика: Y+ = вперёд (тело наклоняется вперёд). Canvas: Y+ = вниз. Поэтому МИНУС обязателен.
Параметры маппинга (по сложности):
Сложность gameScale Смысл
EASY 7 px/mm 1 мм смещения CoP = 7 px на экране (меньше чувствительность)
MEDIUM 9 px/mm Баланс
HARD 12 px/mm Высокая чувствительность (малейший сдвиг → большое перемещение)

Clamp (ограничение):
// Корзинка не выходит за Canvas:
if (basket.x < halfW) basket.x = halfW;
if (basket.x > canvasW - halfW) basket.x = canvasW - halfW;
// Аналогично для Y

8.5. Механики геймплея
A. Wobble (тряска корзинки при рывках)

Физика: Jerk (рывок) = изменение скорости / dt = мгновенное ускорение (mm/s²).
// BasketController.update():
const dvx = velX - basket.prevVelX;
const dvy = velY - basket.prevVelY;
const jerkSq = dvx * dvx + dvy * dvy;

if (jerkSq > wobbleThreshold² * dt²) {
  basket.wobbleIntensity = sqrt(jerkSq) / dt / (wobbleThreshold * 3);
}

// Затухание (экспоненциальное):
basket.wobbleIntensity *= exp(-wobbleDecayRate * dt);

// Визуальное смещение (две перпендикулярные синусоиды):
basket.wobbleOffsetX = sin(phase) * intensity * MAX_OFFSET;
basket.wobbleOffsetY = cos(phase * 1.3) * intensity * MAX_OFFSET * 0.6;
Влияние на геймплей:

    Wobble ≥ 0.15 → блокирует ловлю (dwell прогресс сбрасывается)
    Визуально: корзинка «дрожит», цвет меняется на красный
    Тренирует плавность движений (суть БОС-терапии)

B. Dwell (механика удержания для обычных шаров)

Алгоритм:
1. Корзинка наезжает на шар → ball.state = DWELLING, dwellTimestamp = now
2. Каждый кадр: dwellProgress += dt / effectiveDwellTimeMs
3. Если корзинка ушла ИЛИ zatряслась → state = FALLING, progress = 0
4. Если progress ≥ 1.0 → пойман!

Визуализация: Вокруг шара рисуется кольцо прогресса (зелёная дуга 0°–360° * progress).

Параметры:
Сложность dwellTimeMultiplier Этап 1 (базовый 1300 мс) Этап 3 (базовый 1000 мс)
EASY 1.3 1690 мс 1300 мс
MEDIUM 1.0 1300 мс 1000 мс
HARD 0.7 910 мс 700 мс
C. Быстрые шары (BALL_FAST, Этап 3+)

    Спавн: 30% шаров на Этапе 3, 20% на Финале
    Скорость: ×2.2 от обычной
    Ловля: Мгновенная при первом касании (без dwell)
    Радиус: ×0.85 (чуть меньше обычных)
    Очки: ×2 (20 вместо 10)

D. Зона комфорта (бонус «Мастер баланса»)

Определение: Круг радиуса comfortZoneRadiusMm (физические мм) с центром в (0, 0).

Проверка (zero-GC, без sqrt):
isInComfortZone(copX: number, copY: number): boolean {
  return (copX * copX + copY * copY) <= radiusSq;
}

Механика:

    Непрерывно находиться в зоне 10 секунд → +50 очков
    Таймер отображается в UI
    Вышел из зоны → таймер сбрасывается

Параметры:
Сложность Радиус (мм) Радиус экранный (MEDIUM, scale 9)
EASY 20 ~180 px
MEDIUM 15 ~135 px
HARD 10 ~90 px
E. Коллизии (Circle-AABB)

Алгоритм (CollisionDetector.ts):
// Ближайшая точка AABB к центру круга:
closestX = clamp(ball.x, basket.left, basket.right);
closestY = clamp(ball.y, basket.top, basket.bottom);

// Квадрат расстояния (без sqrt для производительности):
distSq = (ball.x - closestX)² + (ball.y - closestY)²;
isOverlapping = distSq < ball.radius²;

Clamp через if (не Math.min/max, чтобы избежать JIT-деоптимизации):
if (ball.x < left) closestX = left;
else if (ball.x > right) closestX = right;
else closestX = ball.x;

8.6. Этапы и прогрессия
Таблица этапов:
Этап Условие перехода Механика Шары (одновременно) Цвет
1. Лови заданный цвет Поймать 8 шаров Фиксированный цвет (синий) 3 3 цвета
2. Цвет меняется! Поймать 12 шаров Смена цели каждые 17 сек 4 5 цветов
3. Двойная ловля Поймать 12 шаров Быстрые шары (30%) 5 4 цвета
ФИНАЛ. Цветной поток Продержаться 60 сек Символы ★●▲◆, wobble ускоряет спавн 7 6 цветов
Прогрессия сложности:

По этапам (при MEDIUM):

    Скорость падения: 55–90 px/s → 110–190 px/s
    Интервал спавна: 2800 мс → 1300 мс
    Dwell время: 1300 мс → 800 мс

По уровням сложности:

    Корзинка: 110×50 px (EASY) → 65×36 px (HARD)
    Радиус шаров: ×1.3 (EASY) → ×0.8 (HARD)
    Wobble порог: 800 mm/s² (EASY) → 300 mm/s² (HARD, более чувствителен)

Финальный этап (особенности):

    Символы вместо цветов: Цель определяется символом ★, не цветом.
    Wobble-ускорение: При тряске интервал спавна уменьшается: interval / (1 + wobbleIntensity). При max wobble (1.0) → вдвое чаще.
    Тайм-аттак: 60 секунд, максимум очков.
    Смена символа каждые 12 секунд.

8.7. Система очков
Базовые значения:
Событие Очки Условие
Поймал обычный +10 Правильный цвет/символ
Поймал быстрый +20 Правильный цвет/символ
Пропустил целевой -5 Улетел за экран
Поймал неправильный -15 Не тот цвет/символ
Бонус серии +25 Каждые 5 подряд
Бонус зоны +50 10 сек в зоне комфорта
Всплывающие тексты (FloatingText pool):

Предаллокация строк:
// constants.ts:
export const PRECOMPUTED_SCORE_TEXTS: ReadonlyMap<number, string> = new Map([
  [10,  '+10'],
  [20,  '+20'],
  [-5,  '-5'],
  [-15, '-15'],
  [25,  '+25 СЕРИЯ!'],
  [50,  '+50 БАЛАНС!'],
]);

В render loop (zero-GC):
// ScoreManager.getTextOpacity(text):
const text = PRECOMPUTED_SCORE_TEXTS.get(points) ?? '+?';
// Читаем готовую строку из Map — никакой конкатенации!

Анимация:

    Движение вверх: y -= SCORE_FLOAT_SPEED * dt (70 px/s)
    Fade-out: Линейный в последние 30% жизни
    Scale: Эффект «пружинки» первые 15%: 0.3 → 1.15 → 1.0

Счётчики (для UI):
interface GameSnapshot {
  score: number;         // Может быть отрицательным!
  streak: number;        // Текущая серия
  bestStreak: number;    // Лучшая серия за сессию
  catchCount: number;    // Всего поймано
  missCount: number;     // Всего пропущено
  wrongCatchCount: number;
  // ... остальные поля
}

8.8. Wobble (детальная спецификация)
Параметры по сложности:
Сложность wobbleThreshold (mm/s²) wobbleDecayRate (1/s) Смысл
EASY 800 4.5 Сложно вызвать, быстро гаснет
MEDIUM 500 3.0 Баланс
HARD 300 2.0 Легко вызвать, долго держится
Формулы:
// 1. Jerk (ускорение):
jerk = sqrt((velX - prevVelX)² + (velY - prevVelY)²) / dt;

// 2. Интенсивность (если jerk > threshold):
intensity = jerk / (threshold × 3);  // Нормализуем [0, 1]
intensity = clamp(intensity, 0, 1);

// 3. Затухание (каждый кадр):
intensity *= exp(-decayRate × dt);

// 4. Визуальное смещение:
offsetX = sin(phase) × intensity × MAX_OFFSET;
offsetY = cos(phase × 1.3) × intensity × MAX_OFFSET × 0.6;

// 5. Фаза (непрерывная осцилляция):
phase += WOBBLE_FREQUENCY × dt;  // 25 рад/с
if (phase > 2π) phase -= 2π;

Влияние на рендеринг:
// Рисуем корзинку:
const drawX = basket.x + basket.wobbleOffsetX;  // С wobble-смещением
const drawY = basket.y + basket.wobbleOffsetY;

// Коллизии проверяются по базовой позиции (без wobble):
const hitboxX = basket.x;  // БЕЗ смещения!

Логика: Wobble — это визуальный feedback о нестабильности. Коллизии проверяются по «логической» позиции корзинки (без тряски), чтобы не наказывать игрока за визуальный эффект.
8.9. Интеграция со стабилометром
Источник данных (stabilogramStore → BallCatcherGame):
// В Canvas render loop (+page.svelte или BallCatcherCanvas.svelte):
const pos = stabilogramStore.getRenderPosition();  // { x, y } в мм
const vel = stabilogramStore.velocity;             // { x, y } в мм/с

game.update(
  pos.x,    // CoP X (мм)
  pos.y,    // CoP Y (мм)
  vel.x,    // Скорость X (мм/с)
  vel.y,    // Скорость Y (мм/с)
  now       // performance.now()
);

Цепочка обработки:
Hardware (50Hz) 
  → PacketParser (6-bit decode)
  → Server AxisTransform + Calibration
  → WebSocket (JSON)
  → stabilogramStore (Kalman filter)
  → PositionInterpolator (экстраполяция 50Hz → 144Hz)
  → BallCatcherGame.update() (маппинг CoP → basket, wobble, коллизии)
  → Canvas.draw() (рендеринг шаров, корзинки, UI)

Паузы игры (автоматические):
Событие Действие UI
WS disconnect game.pause() Overlay «Переподключение к серверу...»
Device disconnect game.pause() Overlay «Платформа отключена»
WS/device reconnect game.resume() Игра продолжается (время паузы не учитывается)

Реализация:
// В +page.svelte:
$: if ($stabilogramStore.isWsConnected && $stabilogramStore.isDeviceConnected) {
  game.resume();
} else {
  game.pause();
}

Снимок состояния (для Svelte UI):
// Вызывается НЕ в render loop, а по таймеру ~2-4 Гц:
setInterval(() => {
  gameStateStore.set(game.getSnapshot());
}, 250);

// UI биндится к gameStateStore:
{#if $gameState.isRunning}
  <div>Счёт: {$gameState.score}</div>
  <div>Серия: {$gameState.streak}</div>
  <div>Лови {$gameState.targetColorName}!</div>
{/if}

[END OF KNOWLEDGE BASE]

AI ASSISTANT INSTRUCTION: Acknowledge that you have fully parsed and integrated this knowledge base (including the new Game Mode section 8) into your active context. Confirm you will strictly adhere to all "CRITICAL RULES AND ANTI-PATTERNS" and the ZERO-GC requirements for the game render loop in all future responses.

