<!-- packages/client/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { wsClient } from '$lib/websocket/client';
  import { stabilogramStore } from '$lib/stores/stabilogram';
  import ControlPanel from '$lib/components/ControlPanel.svelte';
  import MedicalStabilogramCanvas from '$lib/components/MedicalStabilogramCanvas.svelte';
  import BallCatcherCanvas from '$lib/components/BallCatcherCanvas.svelte';
  
  let canvasRef: MedicalStabilogramCanvas;
  let isRecording = false;
  let recordingStartTime: number;
  
  let currentMode: 'medical' | 'game' = 'medical';
  let isTransitioning = false;
  
  onMount(() => {
    wsClient.setStore(stabilogramStore);
    wsClient.connect().catch(console.error);
    console.log('📱 App mounted, mode:', currentMode);
  });

  onDestroy(() => {
    if (stabilogramStore.resetGameMode) {
      stabilogramStore.resetGameMode();
    }
  });
  
  function handleExport() {
    if (canvasRef) {
      canvasRef.exportSessionData();
    }
  }
  
  function handleStartRecording() {
    isRecording = true;
    recordingStartTime = performance.now();
    console.log('📹 Запись начата');
  }
  
  function handleStopRecording() {
    isRecording = false;
    const duration = (performance.now() - recordingStartTime) / 1000;
    console.log(`📹 Запись остановлена. Продолжительность: ${duration.toFixed(1)}с`);
  }

  async function switchToMedical() {
    if (currentMode === 'medical' || isTransitioning) return;
    
    console.log('🔄 Switching to medical mode...');
    isTransitioning = true;
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    currentMode = 'medical';
    isTransitioning = false;
    console.log('✅ Switched to medical mode');
  }

  async function switchToGame() {
    if (currentMode === 'game' || isTransitioning) return;
    
    console.log('🔄 Switching to game mode...');
    isTransitioning = true;
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    currentMode = 'game';
    isTransitioning = false;
    console.log('✅ Switched to game mode');
  }
</script>

<svelte:head>
  <title>Стабилометр - {currentMode === 'medical' ? 'Анализ баланса' : 'Игра "Поймай мяч"'}</title>
</svelte:head>

<main class="app">
  <header class="app-header">
    <div class="header-content">
      <div class="header-info">
        <h1>Система анализа баланса</h1>
        <p>Медицинский стабилометр {currentMode === 'game' ? '• Игровой режим' : ''}</p>
      </div>
      
      <div class="mode-switcher">
        <button 
          class="mode-btn" 
          class:active={currentMode === 'medical'}
          disabled={isTransitioning}
          on:click={switchToMedical}
        >
          📊 Медицинский
        </button>
        <button 
          class="mode-btn" 
          class:active={currentMode === 'game'}
          disabled={isTransitioning}
          on:click={switchToGame}
        >
          🎮 Игра
        </button>
      </div>
    </div>
  </header>

  <div class="app-content">
    <!-- ✅ ИСПРАВЛЕНИЕ: Увеличили ширину sidebar -->
    <aside class="sidebar">
      <ControlPanel 
        gameMode={currentMode === 'game'}
        on:export={handleExport}
        on:startRecording={handleStartRecording}
        on:stopRecording={handleStopRecording}
      />
      
      <!-- ✅ Дополнительная информация для игрового режима -->
      {#if currentMode === 'game'}
        <div class="game-info">
          <h3>🎮 Как играть</h3>
          <ul>
            <li>Двигайте корзинку центром тяжести</li>
            <li>Ловите шары нужного цвета</li>
            <li>Избегайте резких движений</li>
            <li>Стремитесь к высоким сериям</li>
          </ul>
          
          <div class="game-tips">
            <h4>💡 Советы:</h4>
            <p><strong>Зелёная зона</strong> — оптимальное положение для баланса</p>
            <p><strong>Тряска корзинки</strong> — следите за плавностью движений</p>
          </div>
        </div>
      {/if}

      <!-- Индикатор записи только в медицинском режиме -->
      {#if currentMode === 'medical' && isRecording}
        <div class="recording-indicator">
          <div class="recording-dot"></div>
          <span>Идет запись...</span>
        </div>
      {/if}

      {#if isTransitioning}
        <div class="transition-indicator">
          <span>Переключение режима...</span>
        </div>
      {/if}
    </aside>

    <section class="main-view">
      {#if !isTransitioning}
        {#if currentMode === 'medical'}
          <MedicalStabilogramCanvas 
            bind:this={canvasRef}
            width={900}
            height={700}
            medicalMode={true}
            showDebug={false}
          />
        {:else}
          <BallCatcherCanvas 
            width={1000}
            height={750}
            showDebug={true}
            hideGameControls={true}
          />
        {/if}
      {:else}
        <div class="transition-overlay">
          <div class="transition-spinner"></div>
          <p>Переключение режима...</p>
        </div>
      {/if}
    </section>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f8fafc;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .app-header {
    background: white;
    border-bottom: 1px solid #e5e7eb;
    padding: 20px 40px;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1600px; /* ✅ УВЕЛИЧИЛИ */
    margin: 0 auto;
  }

  .header-info h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: #111827;
  }

  .header-info p {
    margin: 4px 0 0 0;
    color: #6b7280;
    font-size: 14px;
  }

  .mode-switcher {
    display: flex;
    gap: 8px;
    background: #f3f4f6;
    padding: 4px;
    border-radius: 8px;
  }

  .mode-btn {
    background: transparent;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    color: #6b7280;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mode-btn:hover:not(:disabled) {
    background: #e5e7eb;
    color: #374151;
  }

  .mode-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .mode-btn.active {
    background: #3b82f6;
    color: white;
    box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
  }

  .app-content {
    flex: 1;
    display: flex;
    gap: 24px; /* ✅ УВЕЛИЧИЛИ GAP */
    padding: 24px; /* ✅ УВЕЛИЧИЛИ PADDING */
    max-width: 1600px; /* ✅ УВЕЛИЧИЛИ */
    margin: 0 auto;
    width: 100%;
  }

  .sidebar {
    flex-shrink: 0;
    width: 380px; /* ✅ УВЕЛИЧИЛИ С 300px ДО 380px */
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .main-view {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-width: 0; /* ✅ ДОБАВИЛИ для правильного flex */
  }

  .game-info {
    background: white;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    border: 1px solid #e5e7eb;
  }

  .game-info h3 {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
    color: #111827;
  }

  .game-info ul {
    margin: 0 0 16px 0;
    padding-left: 18px;
  }

  .game-info li {
    margin-bottom: 4px;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.4;
  }

  .game-tips {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 12px;
  }

  .game-tips h4 {
    margin: 0 0 6px 0;
    font-size: 13px;
    font-weight: 600;
    color: #166534;
  }

  .game-tips p {
    margin: 0 0 4px 0;
    font-size: 12px;
    color: #166534;
    line-height: 1.3;
  }

  .game-tips p:last-child {
    margin-bottom: 0;
  }

  .recording-indicator {
    padding: 12px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: #dc2626;
  }

  .recording-dot {
    width: 8px;
    height: 8px;
    background: #dc2626;
    border-radius: 50%;
    animation: recording-pulse 1s infinite;
  }

  .transition-indicator {
    padding: 12px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    text-align: center;
    font-size: 14px;
    color: #1e40af;
  }

  .transition-overlay {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 500px;
    color: #6b7280;
  }

  .transition-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top: 3px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes recording-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @media (max-width: 1400px) {
    .header-content {
      flex-direction: column;
      gap: 16px;
      align-items: flex-start;
    }
    
    .app-content {
      flex-direction: column;
    }
    
    .sidebar {
      order: 2;
      width: 100%;
    }
    
    .main-view {
      order: 1;
    }
  }
</style>