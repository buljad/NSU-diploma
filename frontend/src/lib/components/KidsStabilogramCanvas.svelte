<script lang="ts">
  import { wsStore } from "$lib/stores/websocket";
  import type { StabilogramDataMessage } from "$lib/types/stabilogram";
  import { onMount, onDestroy } from "svelte";

  // ============================================================================
  // ПЕРЕМЕННЫЕ CANVAS
  // ============================================================================

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  const CANVAS_WIDTH = 600;
  const CANVAS_HEIGHT = 600;
  const PLATFORM_SIZE = 400;
  const SCALE = CANVAS_WIDTH / (PLATFORM_SIZE * 2);
  const CENTER_X = CANVAS_WIDTH / 2;
  const CENTER_Y = CANVAS_HEIGHT / 2;

  // ============================================================================
  // СОСТОЯНИЕ ВИЗУАЛИЗАЦИИ
  // ============================================================================

  let currentX = 0;
  let currentY = 0;
  let currentForce = 0;

  let trail: Array<{ x: number; y: number }> = [];
  const MAX_TRAIL_LENGTH = 100;

  // ============================================================================
  // ИГРОВЫЕ ЭЛЕМЕНТЫ
  // ============================================================================

  let score = 0;
  let stars: Array<{ x: number; y: number; collected: boolean }> = [];
  let particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
  }> = [];

  // ============================================================================
  // НАСТРОЙКИ
  // ============================================================================

  let showGrid = true;
  let showTrail = true;
  let gameMode = true;
  let showDebug = false; // Отладочная панель

  // ============================================================================
  // ОТЛАДКА
  // ============================================================================

  let debugInfo = {
    messagesReceived: 0,
    lastRawMessage: null as StabilogramDataMessage | null,
    lastParsedData: null as any,
    hasValidData: false,
    parseErrors: [] as string[],
    lastUpdateTime: 0,
  };

  // ============================================================================
  // АНИМАЦИЯ
  // ============================================================================

  let animationFrameId: number;

  // ============================================================================
  // ПОДПИСКА НА WEBSOCKET STORE
  // ============================================================================

  const unsubscribe = wsStore.subscribe((state) => {
    // Получаем последнее сообщение из массива данных
    if (state.data.length > 0) {
      const lastMessage = state.data[state.data.length - 1];
      updateVisualization(lastMessage);
    }
  });

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  onMount(() => {
    ctx = canvas.getContext("2d");
    if (ctx) {
      generateStars();
      animate();
    }
  });

  onDestroy(() => {
    unsubscribe();
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });

  // ============================================================================
  // ГЕНЕРАЦИЯ ЗВЁЗД
  // ============================================================================

  function generateStars(): void {
    stars = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const distance = 150;
      stars.push({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        collected: false,
      });
    }
  }

  // ============================================================================
  // ОБНОВЛЕНИЕ ВИЗУАЛИЗАЦИИ
  // ============================================================================

  function updateVisualization(message: StabilogramDataMessage): void {
    debugInfo.messagesReceived++;
    debugInfo.lastRawMessage = message;
    debugInfo.lastUpdateTime = Date.now();

    // Проверяем наличие parsed данных
    if (!message.parsed) {
      debugInfo.hasValidData = false;
      debugInfo.parseErrors.push(
        `[${new Date().toISOString()}] parsed is null`
      );
      if (debugInfo.parseErrors.length > 10) {
        debugInfo.parseErrors.shift();
      }

      console.warn("⚠️ Получено сообщение без parsed данных:", message);
      return;
    }

    // Проверяем наличие interpretation
    if (!message.parsed.interpretation) {
      debugInfo.hasValidData = false;
      debugInfo.parseErrors.push(
        `[${new Date().toISOString()}] interpretation is missing`
      );
      if (debugInfo.parseErrors.length > 10) {
        debugInfo.parseErrors.shift();
      }

      console.warn("⚠️ Получено сообщение без interpretation:", message.parsed);
      return;
    }

    // Проверяем наличие variant2
    if (!message.parsed.interpretation.variant2) {
      debugInfo.hasValidData = false;
      debugInfo.parseErrors.push(
        `[${new Date().toISOString()}] variant2 is missing`
      );
      if (debugInfo.parseErrors.length > 10) {
        debugInfo.parseErrors.shift();
      }

      console.warn(
        "⚠️ Получено сообщение без variant2:",
        message.parsed.interpretation
      );
      return;
    }

    const { x, y, force } = message.parsed.interpretation.variant2;

    // Валидация числовых значений
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof force !== "number"
    ) {
      debugInfo.hasValidData = false;
      debugInfo.parseErrors.push(
        `[${new Date().toISOString()}] Invalid types: x=${typeof x}, y=${typeof y}, force=${typeof force}`
      );
      if (debugInfo.parseErrors.length > 10) {
        debugInfo.parseErrors.shift();
      }

      console.warn("⚠️ Неверные типы данных:", { x, y, force });
      return;
    }

    // Проверка на NaN
    if (isNaN(x) || isNaN(y) || isNaN(force)) {
      debugInfo.hasValidData = false;
      debugInfo.parseErrors.push(
        `[${new Date().toISOString()}] NaN values detected`
      );
      if (debugInfo.parseErrors.length > 10) {
        debugInfo.parseErrors.shift();
      }

      console.warn("⚠️ NaN значения:", { x, y, force });
      return;
    }

    // ✅ Данные валидны
    debugInfo.hasValidData = true;
    debugInfo.lastParsedData = message.parsed;
    debugInfo.parseErrors = []; // Очищаем ошибки при успешном парсинге

    currentX = x;
    currentY = y;
    currentForce = force;

    // Добавляем в траекторию
    if (showTrail) {
      trail.push({ x, y });
      if (trail.length > MAX_TRAIL_LENGTH) {
        trail.shift();
      }
    }

    // Проверяем сбор звёзд
    if (gameMode) {
      checkStarCollection(x / 1000, y / 1000);
    }
  }

  // ============================================================================
  // ИГРОВАЯ ЛОГИКА
  // ============================================================================

  function checkStarCollection(x: number, y: number): void {
    stars.forEach((star) => {
      if (!star.collected) {
        const dx = star.x - x;
        const dy = star.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 30) {
          star.collected = true;
          score += 10;
          createParticles(star.x, star.y);

          // Проверка на завершение уровня
          if (stars.every((s) => s.collected)) {
            setTimeout(() => {
              score += 50;
              generateStars();
            }, 1000);
          }
        }
      }
    });
  }

  function createParticles(x: number, y: number): void {
    const colors = ["#FFD700", "#FF6B9D", "#4FC3F7", "#4CAF50"];
    for (let i = 0; i < 15; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 60,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  // ============================================================================
  // АНИМАЦИЯ
  // ============================================================================

  function animate(): void {
    if (ctx) {
      draw();
      updateParticles();
    }
    animationFrameId = requestAnimationFrame(animate);
  }

  function updateParticles(): void {
    particles = particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.life--;
      return p.life > 0;
    });
  }

  // ============================================================================
  // ОТРИСОВКА
  // ============================================================================

  function draw(): void {
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Градиентный фон
    const gradient = ctx.createLinearGradient(
      0,
      0,
      CANVAS_WIDTH,
      CANVAS_HEIGHT
    );
    gradient.addColorStop(0, "#E3F2FD");
    gradient.addColorStop(1, "#F3E5F5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Платформа
    const platformGradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
    platformGradient.addColorStop(0, "#FF6B9D");
    platformGradient.addColorStop(0.5, "#4FC3F7");
    platformGradient.addColorStop(1, "#FFD93D");
    ctx.strokeStyle = platformGradient;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, (PLATFORM_SIZE * SCALE) / 2, 0, Math.PI * 2);
    ctx.stroke();

    if (showGrid) {
      drawGrid();
    }

    if (gameMode) {
      drawStars();
    }

    if (showTrail && trail.length > 1) {
      drawTrail();
    }

    drawParticles();
    drawCharacter();
  }

  function drawGrid(): void {
    if (!ctx) return;

    ctx.strokeStyle = "rgba(200, 200, 200, 0.3)";
    ctx.lineWidth = 1;
    const gridStep = 50 * SCALE;

    for (let x = CENTER_X % gridStep; x < CANVAS_WIDTH; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }

    for (let y = CENTER_Y % gridStep; y < CANVAS_HEIGHT; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
  }

  function drawStars(): void {
    if (!ctx) return;

    stars.forEach((star) => {
      if (!star.collected) {
        const screenX = CENTER_X + star.x * SCALE;
        const screenY = CENTER_Y - star.y * SCALE;

        const time = Date.now() / 1000;
        const pulse = Math.sin(time * 3) * 0.2 + 1;
        if (ctx) {
          ctx.save();
          ctx.translate(screenX, screenY);
          ctx.scale(pulse, pulse);
          ctx.rotate(time);

          ctx.fillStyle = "#FFD700";
          ctx.strokeStyle = "#FFA500";
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
            const radius = i % 2 === 0 ? 15 : 7;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.restore();
        }
      }
    });
  }

  function drawTrail(): void {
    if (!ctx || trail.length < 2) return;

    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < trail.length; i++) {
      const point = trail[i];
      const prevPoint = trail[i - 1];

      const screenX = CENTER_X + (point.x * SCALE) / 1000;
      const screenY = CENTER_Y - (point.y * SCALE) / 1000;
      const prevScreenX = CENTER_X + (prevPoint.x * SCALE) / 1000;
      const prevScreenY = CENTER_Y - (prevPoint.y * SCALE) / 1000;

      const alpha = i / trail.length;
      const hue = (i / trail.length) * 360;
      ctx.strokeStyle = `hsla(${hue}, 70%, 60%, ${alpha * 0.6})`;

      ctx.beginPath();
      ctx.moveTo(prevScreenX, prevScreenY);
      ctx.lineTo(screenX, screenY);
      ctx.stroke();
    }
  }

  function drawParticles(): void {
    if (!ctx) return;

    particles.forEach((p) => {
      const screenX = CENTER_X + p.x * SCALE;
      const screenY = CENTER_Y - p.y * SCALE;
      const alpha = p.life / 60;

      if (ctx) {
        ctx.fillStyle =
          p.color +
          Math.floor(alpha * 255)
            .toString(16)
            .padStart(2, "0");
        ctx.beginPath();
        ctx.arc(screenX, screenY, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawCharacter(): void {
    if (!ctx) return;

    const screenX = CENTER_X + (currentX * SCALE) / 1000;
    const screenY = CENTER_Y - (currentY * SCALE) / 1000;

    const radius = 20;

    // Тело
    const bodyGradient = ctx.createRadialGradient(
      screenX,
      screenY,
      0,
      screenX,
      screenY,
      radius
    );
    bodyGradient.addColorStop(0, "#FFD93D");
    bodyGradient.addColorStop(1, "#FF6B9D");

    ctx.fillStyle = bodyGradient;
    ctx.strokeStyle = "#FF6B9D";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Глаза
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(screenX - 7, screenY - 5, 3, 0, Math.PI * 2);
    ctx.arc(screenX + 7, screenY - 5, 3, 0, Math.PI * 2);
    ctx.fill();

    // Улыбка
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY + 2, 10, 0, Math.PI);
    ctx.stroke();

    // Блик
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.beginPath();
    ctx.arc(screenX - 5, screenY - 8, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ============================================================================
  // ДЕЙСТВИЯ
  // ============================================================================

  function clearTrail(): void {
    trail = [];
  }

  function resetGame(): void {
    score = 0;
    trail = [];
    generateStars();
  }

  function toggleDebug(): void {
    showDebug = !showDebug;
  }
</script>

<div class="kids-canvas-container">
  <!-- ЗАГОЛОВОК -->
  <div class="kids-header">
    <h2 class="kids-title">
      <span class="star-decoration">⭐</span>
      Собери все звёздочки!
      <span class="star-decoration">⭐</span>
    </h2>

    <div class="score-display">
      <span class="score-label">Очки:</span>
      <span class="score-value">{score}</span>
      <span class="emoji-bounce">🏆</span>
    </div>
  </div>

  <!-- CANVAS -->
  <div class="canvas-wrapper">
    <canvas
      bind:this={canvas}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      class="game-canvas"
    ></canvas>

    <!-- ПОДСКАЗКА -->
    {#if gameMode && stars.filter((s) => !s.collected).length > 0}
      <div class="hint-bubble">
        <div class="emoji-bounce">👆</div>
        <p>Двигайся чтобы собрать звёзды!</p>
        <p class="hint-small">
          Осталось: {stars.filter((s) => !s.collected).length}
        </p>
      </div>
    {/if}

    <!-- УРОВЕНЬ ЗАВЕРШЁН -->
    {#if stars.every((s) => s.collected)}
      <div class="level-complete">
        <div class="confetti-container">🎉 🎊 ✨ 🌟 ⭐</div>
        <h3>Молодец! Все звёзды собраны!</h3>
        <p>+50 бонусных очков!</p>
      </div>
    {/if}
  </div>

  <!-- УПРАВЛЕНИЕ -->
  <div class="kids-controls">
    <button class="btn-kids pink" on:click={() => (showTrail = !showTrail)}>
      {showTrail ? "🌈 След ВКЛ" : "❌ След ВЫКЛ"}
    </button>
    <button class="btn-kids blue" on:click={() => (gameMode = !gameMode)}>
      {gameMode ? "⭐ Игра ВКЛ" : "🎯 Игра ВЫКЛ"}
    </button>
    <button class="btn-kids green" on:click={clearTrail}>
      🗑 Очистить след
    </button>
    <button class="btn-kids rainbow" on:click={resetGame}>
      🔄 Новая игра
    </button>
    <button class="btn-kids debug" on:click={toggleDebug}>
      {showDebug ? "🐛 Скрыть отладку" : "🐛 Показать отладку"}
    </button>
  </div>

  <!-- ОТЛАДОЧНАЯ ИНФОРМАЦИЯ -->
  {#if showDebug}
    <div class="debug-panel">
      <h3>🐛 Отладочная информация</h3>

      <div class="debug-section">
        <h4>Статус данных:</h4>
        <div class="debug-grid">
          <div
            class="debug-item"
            class:success={debugInfo.hasValidData}
            class:error={!debugInfo.hasValidData}
          >
            <span class="debug-label">Валидные данные:</span>
            <span class="debug-value"
              >{debugInfo.hasValidData ? "✅ Да" : "❌ Нет"}</span
            >
          </div>
          <div class="debug-item">
            <span class="debug-label">Сообщений получено:</span>
            <span class="debug-value">{debugInfo.messagesReceived}</span>
          </div>
          <div class="debug-item">
            <span class="debug-label">Последнее обновление:</span>
            <span class="debug-value">
              {debugInfo.lastUpdateTime
                ? new Date(debugInfo.lastUpdateTime).toLocaleTimeString()
                : "Нет"}
            </span>
          </div>
        </div>
      </div>

      {#if debugInfo.parseErrors.length > 0}
        <div class="debug-section error-section">
          <h4>⚠️ Ошибки парсинга:</h4>
          <div class="error-list">
            {#each debugInfo.parseErrors as error}
              <div class="error-item">{error}</div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="debug-section">
        <h4>Текущие координаты:</h4>
        <div class="debug-grid">
          <div class="debug-item">
            <span class="debug-label">X (сырое):</span>
            <span class="debug-value">{currentX} μm</span>
          </div>
          <div class="debug-item">
            <span class="debug-label">Y (сырое):</span>
            <span class="debug-value">{currentY} μm</span>
          </div>
          <div class="debug-item">
            <span class="debug-label">X (мм):</span>
            <span class="debug-value">{(currentX / 1000).toFixed(2)} mm</span>
          </div>
          <div class="debug-item">
            <span class="debug-label">Y (мм):</span>
            <span class="debug-value">{(currentY / 1000).toFixed(2)} mm</span>
          </div>
          <div class="debug-item">
            <span class="debug-label">Сила:</span>
            <span class="debug-value">{currentForce.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <details class="debug-details">
        <summary>Последнее RAW сообщение</summary>
        <pre class="debug-json">{JSON.stringify(
            debugInfo.lastRawMessage,
            null,
            2
          )}</pre>
      </details>

      <details class="debug-details">
        <summary>Последние parsed данные</summary>
        <pre class="debug-json">{JSON.stringify(
            debugInfo.lastParsedData,
            null,
            2
          )}</pre>
      </details>
    </div>
  {/if}

  <!-- ПОЗИЦИЯ -->
  <div class="position-display">
    <div class="position-item">
      <span class="position-emoji">↔️</span>
      <span class="position-label">Влево-Вправо:</span>
      <span
        class="position-value"
        class:positive={currentX > 0}
        class:negative={currentX < 0}
      >
        {(currentX / 1000).toFixed(1)} мм
      </span>
    </div>
    <div class="position-item">
      <span class="position-emoji">↕️</span>
      <span class="position-label">Вперед-Назад:</span>
      <span
        class="position-value"
        class:positive={currentY > 0}
        class:negative={currentY < 0}
      >
        {(currentY / 1000).toFixed(1)} мм
      </span>
    </div>
  </div>
</div>

<style>
  /* ОСНОВНЫЕ СТИЛИ */
  .kids-canvas-container {
    background: white;
    border-radius: 20px;
    padding: 30px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  }

  .kids-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 15px;
  }

  .kids-title {
    font-family: "Comic Sans MS", cursive, sans-serif;
    font-size: 28px;
    color: #333;
    margin: 0;
  }

  .star-decoration {
    display: inline-block;
    animation: spin 3s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .score-display {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 25px;
    background: linear-gradient(135deg, #ff6b9d, #c44569);
    border-radius: 25px;
    color: white;
    box-shadow: 0 4px 15px rgba(255, 107, 157, 0.3);
  }

  .score-label {
    font-weight: 600;
    font-size: 18px;
  }

  .score-value {
    font-family: "Comic Sans MS", cursive, sans-serif;
    font-size: 32px;
    font-weight: 900;
  }

  .emoji-bounce {
    animation: bounce 1s ease-in-out infinite;
  }

  @keyframes bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-5px);
    }
  }

  /* CANVAS */
  .canvas-wrapper {
    position: relative;
    display: flex;
    justify-content: center;
    margin-bottom: 20px;
  }

  .game-canvas {
    border: 5px solid transparent;
    border-radius: 20px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    background:
      linear-gradient(white, white) padding-box,
      linear-gradient(135deg, #ff6b9d, #4fc3f7, #ffd93d) border-box;
  }

  /* ПОДСКАЗКА */
  .hint-bubble {
    position: absolute;
    top: 20px;
    right: 20px;
    background: white;
    padding: 15px 20px;
    border-radius: 20px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    text-align: center;
    animation: bubbleBounce 2s ease-in-out infinite;
    z-index: 5;
  }

  @keyframes bubbleBounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  .hint-bubble p {
    margin: 5px 0;
    color: #333;
    font-weight: 600;
  }

  .hint-small {
    font-size: 12px;
    color: #666;
  }

  /* УРОВЕНЬ ЗАВЕРШЁН */
  .level-complete {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 40px;
    border-radius: 30px;
    box-shadow: 0 10px 50px rgba(0, 0, 0, 0.3);
    text-align: center;
    animation: levelCompleteAppear 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    z-index: 10;
  }

  @keyframes levelCompleteAppear {
    0% {
      transform: translate(-50%, -50%) scale(0) rotate(-180deg);
      opacity: 0;
    }
    100% {
      transform: translate(-50%, -50%) scale(1) rotate(0deg);
      opacity: 1;
    }
  }

  .confetti-container {
    font-size: 48px;
    margin-bottom: 15px;
    animation: confettiShake 0.5s ease-in-out infinite;
  }

  @keyframes confettiShake {
    0%,
    100% {
      transform: rotate(-5deg);
    }
    50% {
      transform: rotate(5deg);
    }
  }

  .level-complete h3 {
    font-family: "Comic Sans MS", cursive, sans-serif;
    background: linear-gradient(135deg, #ff6b9d, #4fc3f7, #ffd93d);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-size: 32px;
    margin: 0 0 10px 0;
  }

  .level-complete p {
    font-size: 18px;
    color: #ffd93d;
    font-weight: 700;
  }

  /* КНОПКИ */
  .kids-controls {
    display: flex;
    justify-content: center;
    gap: 15px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .btn-kids {
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 700;
    border: none;
    border-radius: 15px;
    cursor: pointer;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
    color: white;
    font-family: "Comic Sans MS", cursive, sans-serif;
  }

  .btn-kids:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }

  .btn-kids:active {
    transform: translateY(0);
  }

  .btn-kids.pink {
    background: linear-gradient(135deg, #ff6b9d, #c44569);
  }

  .btn-kids.blue {
    background: linear-gradient(135deg, #4fc3f7, #2196f3);
  }

  .btn-kids.green {
    background: linear-gradient(135deg, #4caf50, #388e3c);
  }

  .btn-kids.rainbow {
    background: linear-gradient(135deg, #ff6b9d, #4fc3f7, #ffd93d, #4caf50);
  }

  .btn-kids.debug {
    background: linear-gradient(135deg, #9c27b0, #673ab7);
  }

  /* ОТЛАДКА */
  .debug-panel {
    background: #f5f5f5;
    border: 2px solid #9c27b0;
    border-radius: 15px;
    padding: 20px;
    margin: 20px 0;
    font-family: monospace;
  }

  .debug-panel h3 {
    margin: 0 0 15px 0;
    color: #9c27b0;
    font-size: 20px;
  }

  .debug-panel h4 {
    margin: 15px 0 10px 0;
    color: #333;
    font-size: 16px;
  }

  .debug-section {
    background: white;
    border-radius: 10px;
    padding: 15px;
    margin-bottom: 15px;
  }

  .debug-section.error-section {
    background: #ffebee;
    border: 1px solid #f44336;
  }

  .debug-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
  }

  .debug-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: #f9f9f9;
    border-radius: 5px;
    font-size: 13px;
  }

  .debug-item.success {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .debug-item.error {
    background: #ffebee;
    color: #c62828;
  }

  .debug-label {
    font-weight: 600;
  }

  .debug-value {
    font-weight: 700;
  }

  .error-list {
    max-height: 150px;
    overflow-y: auto;
  }

  .error-item {
    padding: 8px;
    background: white;
    border-left: 3px solid #f44336;
    margin-bottom: 5px;
    font-size: 12px;
  }

  .debug-details {
    margin-top: 10px;
    cursor: pointer;
  }

  .debug-details summary {
    padding: 10px;
    background: #e0e0e0;
    border-radius: 5px;
    font-weight: 600;
    user-select: none;
  }

  .debug-details summary:hover {
    background: #d0d0d0;
  }

  .debug-json {
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 15px;
    border-radius: 5px;
    overflow-x: auto;
    font-size: 12px;
    margin: 10px 0 0 0;
  }

  /* ПОЗИЦИЯ */
  .position-display {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 15px;
    padding: 20px;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    border-radius: 15px;
  }

  .position-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px;
    background: white;
    border-radius: 15px;
  }

  .position-emoji {
    font-size: 24px;
  }

  .position-label {
    font-weight: 600;
    color: #666;
    font-size: 14px;
  }

  .position-value {
    margin-left: auto;
    font-family: "Courier New", monospace;
    font-size: 20px;
    font-weight: 700;
    color: #333;
  }

  .position-value.positive {
    color: #4caf50;
  }

  .position-value.negative {
    color: #ff6b9d;
  }

  /* АДАПТИВНОСТЬ */
  @media (max-width: 768px) {
    .kids-canvas-container {
      padding: 20px;
    }

    .kids-title {
      font-size: 22px;
      text-align: center;
      width: 100%;
    }

    .score-display {
      margin: 0 auto;
    }

    .game-canvas {
      max-width: 100%;
      height: auto;
    }

    .kids-controls {
      flex-direction: column;
    }

    .btn-kids {
      width: 100%;
    }

    .hint-bubble {
      top: 10px;
      right: 10px;
      left: 10px;
      padding: 10px;
    }
  }
</style>
