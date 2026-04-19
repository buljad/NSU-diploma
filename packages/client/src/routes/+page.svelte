<!-- packages/client/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import StabilogramCanvas from '$lib/components/StabilogramCanvas.svelte';
  import BallCatcherCanvas from '$lib/components/BallCatcherCanvas.svelte';
  import { wsClient } from '$lib/websocket/client';
  import { stabilogramStore } from '$lib/stores/stabilogram';
  import { gameState } from '$lib/stores/gameState';
  import {
    DIFF_EASY,
    DIFF_MEDIUM,
    DIFF_HARD,
    STAGE_MENU,
    STAGE_RESULTS,
  } from '$lib/game/types';
  import {
    BALL_FILL_COLORS,
    DIFFICULTY_PRESETS,
  } from '$lib/game/constants';

  // ══════════════════════════════════════════════
  // Dependency Injection (CRITICAL RULE #5)
  // ══════════════════════════════════════════════

  wsClient.setStore(stabilogramStore);

  // ══════════════════════════════════════════════
  // Local state
  // ══════════════════════════════════════════════

  interface LocalPortInfo {
    path: string;
    manufacturer?: string;
  }

  let ports: LocalPortInfo[] = [];
  let selectedPort = '';
  let testMode = true;
  let showDebug = true;

  // ── App mode ──
  let appMode: 'diagnostic' | 'game' = 'diagnostic';
  let selectedDifficulty: number = DIFF_MEDIUM;
  let gameCanvas: BallCatcherCanvas;

  // ── Difficulty options (предаллоцированный массив) ──
  const DIFFICULTY_OPTIONS = [
    { id: DIFF_EASY, label: 'Легко', emoji: '🟢' },
    { id: DIFF_MEDIUM, label: 'Средне', emoji: '🟡' },
    { id: DIFF_HARD, label: 'Сложно', emoji: '🔴' },
  ];

  // ── Stage labels ──
  const STAGE_LABELS: Record<number, string> = {
    1: 'Лови цвет',
    2: 'Цвет меняется',
    3: 'Двойная ловля',
    4: 'Финал',
    5: 'Результаты',
  };

  // ══════════════════════════════════════════════
  // Reactive state from stores
  // ══════════════════════════════════════════════

  $: isWsConnected = $stabilogramStore.isWsConnected;
  $: isDeviceConnected = $stabilogramStore.isDeviceConnected;
  $: isCalibrated = $stabilogramStore.isCalibrated;

  // Game state (from gameState store, updated ~6 Гц)
  $: gs = $gameState;
  $: isGameRunning = gs.isRunning;
  $: isGameActive = gs.isRunning && gs.stage !== STAGE_RESULTS && gs.stage !== STAGE_MENU;
  $: isGameResults = gs.isRunning && gs.stage === STAGE_RESULTS;
  $: canStartGame = isDeviceConnected && !gs.isRunning;

  // ══════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════

  onMount(() => {
    const unsubPorts = wsClient.on('PORTS_LIST', (data: any) => {
      console.log('Received ports:', data);
      ports = Array.isArray(data) ? data : data?.ports || [];

      if (ports.length > 0 && !selectedPort) {
        selectedPort = ports[0].path;
      }
    });

    try {
      wsClient.connect().then(() => {
        wsClient.requestPorts();
      });
    } catch (error) {
      console.error('Failed to connect:', error);
    }

    return () => {
      unsubPorts();
      wsClient.disconnect();
    };
  });

  // ══════════════════════════════════════════════
  // Connection handlers
  // ══════════════════════════════════════════════

  function connectDevice(): void {
    if (testMode) {
      wsClient.connectToPort('', 115200, true);
    } else if (selectedPort) {
      wsClient.connectToPort(selectedPort);
    }
  }

  function disconnectDevice(): void {
    // Остановить игру при отключении устройства
    if (gameCanvas && isGameRunning) {
      gameCanvas.stopGame();
    }
    wsClient.disconnectFromPort();
  }

  function calibrate(): void {
    wsClient.calibrateZero();
  }

  function refreshPorts(): void {
    wsClient.requestPorts();
  }

  // ══════════════════════════════════════════════
  // Mode switching
  // ══════════════════════════════════════════════

  function setMode(mode: 'diagnostic' | 'game'): void {
    // Остановить игру при переключении на диагностику
    if (appMode === 'game' && mode === 'diagnostic' && gameCanvas && isGameRunning) {
      gameCanvas.stopGame();
    }
    appMode = mode;
  }

  // ══════════════════════════════════════════════
  // Game control handlers
  // ══════════════════════════════════════════════

  function handleStartGame(): void {
    if (!gameCanvas || !canStartGame) return;
    gameCanvas.startGame(selectedDifficulty);
  }

  function handlePauseGame(): void {
    if (!gameCanvas) return;
    gameCanvas.pauseGame();
  }

  function handleResumeGame(): void {
    if (!gameCanvas) return;
    gameCanvas.resumeGame();
  }

  function handleStopGame(): void {
    if (!gameCanvas) return;
    gameCanvas.stopGame();
  }

  function handleRestartGame(): void {
    if (!gameCanvas) return;
    gameCanvas.restartGame();
  }

  function selectDifficulty(diff: number): void {
    selectedDifficulty = diff;
  }
</script>

<svelte:head>
  <title>Стабилометр — {appMode === 'game' ? 'Поймай мяч' : 'Диагностика'}</title>
</svelte:head>

<main>
  <header>
    <h1>🎯 Медицинский стабилометр</h1>
  </header>

  <div class="content">
    <!-- ═══════════════════════════════════ -->
    <!-- SIDEBAR                             -->
    <!-- ═══════════════════════════════════ -->
    <aside class="controls">
      <!-- WS Status -->
      <div class="ws-status" class:connected={isWsConnected}>
        Сервер: {isWsConnected ? 'OK' : 'Нет связи'}
      </div>

      <!-- Mode Switcher -->
      <section class="mode-switcher">
        <h2>Режим</h2>
        <div class="mode-buttons">
          <button
            class="mode-btn"
            class:active={appMode === 'diagnostic'}
            on:click={() => setMode('diagnostic')}
          >
            📊 Диагностика
          </button>
          <button
            class="mode-btn"
            class:active={appMode === 'game'}
            on:click={() => setMode('game')}
          >
            🎮 Игра
          </button>
        </div>
      </section>

      <!-- Connection -->
      <section>
        <h2>Подключение</h2>
        <label class="checkbox">
          <input
            type="checkbox"
            bind:checked={testMode}
            disabled={isDeviceConnected}
          />
          Тестовый режим
        </label>

        {#if !testMode}
          <div class="form-group">
            <label for="port">COM-порт</label>
            <div class="port-row">
              <select id="port" bind:value={selectedPort} disabled={isDeviceConnected}>
                {#each ports as port}
                  <option value={port.path}>
                    {port.path}
                    {port.manufacturer ? `(${port.manufacturer})` : ''}
                  </option>
                {/each}
              </select>
              <button class="btn-icon" on:click={refreshPorts} disabled={isDeviceConnected}>
                🔄
              </button>
            </div>
          </div>
        {/if}

        <div class="buttons">
          {#if !isDeviceConnected}
            <button class="btn primary" on:click={connectDevice} disabled={!isWsConnected}>
              Подключить
            </button>
          {:else}
            <button class="btn danger" on:click={disconnectDevice}>
              Отключить
            </button>
          {/if}
        </div>
      </section>

      <!-- Calibration -->
      <section>
        <h2>Калибровка</h2>
        <p class="hint">Встаньте в центр платформы</p>
        <button class="btn secondary" on:click={calibrate} disabled={!isDeviceConnected}>
          Калибровать ноль
        </button>
        {#if isCalibrated}
          <p class="status ok">✅ Откалибровано</p>
        {:else}
          <p class="status warn">⚠️ Требуется калибровка</p>
        {/if}
      </section>

      <!-- ═══════════ DIAGNOSTIC MODE ═══════════ -->
      {#if appMode === 'diagnostic'}
        <section>
          <h2>Настройки</h2>
          <label class="checkbox">
            <input type="checkbox" bind:checked={showDebug} />
            Показывать отладку
          </label>
        </section>
      {/if}

      <!-- ═══════════ GAME MODE ═══════════ -->
      {#if appMode === 'game'}

        <!-- Game: not running → setup -->
        {#if !isGameRunning}
          <section>
            <h2>🎮 Поймай мяч</h2>
            <p class="hint">Выберите сложность:</p>

            <div class="difficulty-selector">
              {#each DIFFICULTY_OPTIONS as opt}
                <button
                  class="diff-btn"
                  class:selected={selectedDifficulty === opt.id}
                  on:click={() => selectDifficulty(opt.id)}
                >
                  {opt.emoji} {opt.label}
                </button>
              {/each}
            </div>

            <button
              class="btn primary full-width"
              on:click={handleStartGame}
              disabled={!canStartGame}
            >
              ▶ Старт
            </button>

            {#if !isDeviceConnected}
              <p class="status warn">⚠️ Подключите устройство</p>
            {/if}
          </section>

        <!-- Game: running → controls + status -->
        {:else}
          <section>
            <h2>🎮 Игра</h2>

            <!-- Stage Info -->
            <div class="game-info">
              <div class="info-row">
                <span class="info-label">Этап:</span>
                <span class="info-value">{STAGE_LABELS[gs.stage] ?? '—'}</span>
              </div>

              <div class="info-row">
                <span class="info-label">Очки:</span>
                <span class="info-value score">{gs.score}</span>
              </div>

              {#if gs.streak > 1}
                <div class="info-row">
                  <span class="info-label">Серия:</span>
                  <span class="info-value streak">×{gs.streak}</span>
                </div>
              {/if}

              {#if isGameActive}
                <div class="info-row">
                  <span class="info-label">Цель:</span>
                  <span class="info-value target">
                    <span
                      class="color-dot"
                      style="background:{BALL_FILL_COLORS[gs.targetColorIndex]}"
                    ></span>
                    {gs.targetColorName}
                  </span>
                </div>
              {/if}

              {#if gs.stageTimeRemaining >= 0}
                <div class="info-row">
                  <span class="info-label">Время:</span>
                  <span class="info-value" class:time-low={gs.stageTimeRemaining < 10}>
                    {Math.ceil(gs.stageTimeRemaining)} с
                  </span>
                </div>
              {/if}

              {#if gs.isInComfortZone}
                <div class="info-row">
                  <span class="info-label">Баланс:</span>
                  <span class="info-value zone">{gs.comfortZoneTime.toFixed(1)} с</span>
                </div>
              {/if}
            </div>

            <!-- Game Controls -->
            <div class="game-controls">
              {#if isGameActive}
                {#if gs.isPaused}
                  <button class="btn primary full-width" on:click={handleResumeGame}>
                    ▶ Продолжить
                  </button>
                {:else}
                  <button class="btn secondary full-width" on:click={handlePauseGame}>
                    ⏸ Пауза
                  </button>
                {/if}
              {/if}

              {#if isGameResults}
                <button class="btn primary full-width" on:click={handleRestartGame}>
                  🔄 Заново
                </button>
              {/if}

              <button class="btn danger full-width" on:click={handleStopGame}>
                ⏹ Завершить
              </button>
            </div>
          </section>

          <!-- Compact stats -->
          <section class="stats-compact">
            <h2>Статистика</h2>
            <div class="stats-grid">
              <div class="stat">
                <span class="stat-val ok">{gs.catchCount}</span>
                <span class="stat-lbl">Поймано</span>
              </div>
              <div class="stat">
                <span class="stat-val warn">{gs.missCount}</span>
                <span class="stat-lbl">Пропущено</span>
              </div>
              <div class="stat">
                <span class="stat-val danger">{gs.wrongCatchCount}</span>
                <span class="stat-lbl">Ошибок</span>
              </div>
              <div class="stat">
                <span class="stat-val streak">{gs.bestStreak}</span>
                <span class="stat-lbl">Макс. серия</span>
              </div>
            </div>
          </section>
        {/if}
      {/if}
    </aside>

    <!-- ═══════════════════════════════════ -->
    <!-- VISUALIZATION                       -->
    <!-- ═══════════════════════════════════ -->
    <div class="visualization">
      {#if appMode === 'diagnostic'}
        <StabilogramCanvas width={800} height={600} {showDebug} />
      {:else}
        <BallCatcherCanvas bind:this={gameCanvas} width={800} height={600} />
      {/if}
    </div>
  </div>
</main>

<style>
  /* ═══════════════════════════════════ */
  /* GLOBAL                              */
  /* ═══════════════════════════════════ */
  :global(body) {
    margin: 0;
    background: #0a0a0f;
    color: #fff;
    font-family: sans-serif;
  }

  main {
    min-height: 100vh;
    padding: 20px;
  }

  header {
    text-align: center;
    margin-bottom: 30px;
  }

  h1 {
    font-size: 2rem;
    background: linear-gradient(135deg, #4a9eff, #6366f1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .content {
    display: flex;
    gap: 30px;
    max-width: 1200px;
    margin: 0 auto;
  }

  /* ═══════════════════════════════════ */
  /* SIDEBAR                             */
  /* ═══════════════════════════════════ */
  .controls {
    width: 280px;
    flex-shrink: 0;
  }

  section {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 20px;
  }

  h2 {
    font-size: 0.9rem;
    margin: 0 0 15px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  /* ═══════════════════════════════════ */
  /* MODE SWITCHER                       */
  /* ═══════════════════════════════════ */
  .mode-switcher {
    background: rgba(255, 255, 255, 0.03);
  }

  .mode-buttons {
    display: flex;
    gap: 8px;
  }

  .mode-btn {
    flex: 1;
    padding: 10px 8px;
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
  }

  .mode-btn:hover {
    border-color: rgba(74, 158, 255, 0.4);
    color: white;
  }

  .mode-btn.active {
    border-color: #4a9eff;
    background: rgba(74, 158, 255, 0.15);
    color: white;
  }

  /* ═══════════════════════════════════ */
  /* DIFFICULTY SELECTOR                 */
  /* ═══════════════════════════════════ */
  .difficulty-selector {
    display: flex;
    gap: 6px;
    margin-bottom: 15px;
  }

  .diff-btn {
    flex: 1;
    padding: 8px 4px;
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.2s;
    text-align: center;
  }

  .diff-btn:hover {
    border-color: rgba(255, 255, 255, 0.3);
    color: white;
  }

  .diff-btn.selected {
    border-color: #f1c40f;
    background: rgba(241, 196, 15, 0.12);
    color: white;
  }

  /* ═══════════════════════════════════ */
  /* GAME INFO                           */
  /* ═══════════════════════════════════ */
  .game-info {
    margin-bottom: 15px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .info-label {
    color: #888;
    font-size: 0.85rem;
  }

  .info-value {
    font-weight: bold;
    font-size: 0.95rem;
  }

  .info-value.score {
    color: white;
    font-size: 1.2rem;
  }

  .info-value.streak {
    color: #f1c40f;
  }

  .info-value.target {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .info-value.zone {
    color: #2ecc71;
  }

  .time-low {
    color: #e74c3c !important;
    animation: time-pulse 1s infinite;
  }

  @keyframes time-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .color-dot {
    display: inline-block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.3);
  }

  /* ═══════════════════════════════════ */
  /* GAME CONTROLS                       */
  /* ═══════════════════════════════════ */
  .game-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .full-width {
    width: 100%;
  }

  /* ═══════════════════════════════════ */
  /* COMPACT STATS                       */
  /* ═══════════════════════════════════ */
  .stats-compact {
    padding: 15px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
  }

  .stat-val {
    font-size: 1.4rem;
    font-weight: bold;
  }

  .stat-val.ok {
    color: #2ecc71;
  }

  .stat-val.warn {
    color: #f39c12;
  }

  .stat-val.danger {
    color: #e74c3c;
  }

  .stat-val.streak {
    color: #f1c40f;
  }

  .stat-lbl {
    font-size: 0.7rem;
    color: #888;
    margin-top: 2px;
    text-transform: uppercase;
  }

  /* ═══════════════════════════════════ */
  /* COMMON (из оригинала)               */
  /* ═══════════════════════════════════ */
  .form-group {
    margin-bottom: 15px;
  }

  .form-group label {
    display: block;
    margin-bottom: 5px;
    color: #aaa;
    font-size: 0.9rem;
  }

  select {
    width: 100%;
    padding: 10px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    color: #fff;
  }

  .port-row {
    display: flex;
    gap: 8px;
  }

  .port-row select {
    flex: 1;
  }

  .btn-icon {
    padding: 10px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    cursor: pointer;
  }

  .btn-icon:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .buttons {
    display: flex;
    gap: 10px;
  }

  .btn {
    flex: 1;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
  }

  .btn.primary {
    background: linear-gradient(135deg, #4a9eff, #6366f1);
    color: white;
  }

  .btn.primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(74, 158, 255, 0.4);
  }

  .btn.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .btn.secondary:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .btn.danger {
    background: #e74c3c;
    color: white;
  }

  .btn.danger:hover {
    background: #c0392b;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 15px;
    cursor: pointer;
  }

  .hint {
    font-size: 0.85rem;
    color: #666;
    margin-bottom: 10px;
  }

  .status {
    font-size: 0.9rem;
    margin-top: 10px;
  }

  .status.ok {
    color: #2ecc71;
  }

  .status.warn {
    color: #f39c12;
  }

  .visualization {
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .ws-status {
    margin-bottom: 10px;
    padding: 8px;
    border-radius: 8px;
    background: #e74c3c;
    text-align: center;
    font-size: 0.8rem;
  }

  .ws-status.connected {
    background: #2ecc71;
  }
</style>