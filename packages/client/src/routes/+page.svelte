<!-- packages/client/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { wsClient } from '$lib/websocket/client';
  import { stabilogramStore } from '$lib/stores/stabilogram';
  import ControlPanel from '$lib/components/ControlPanel.svelte';
  import MedicalStabilogramCanvas from '$lib/components/MedicalStabilogramCanvas.svelte';
  
  let canvasRef: MedicalStabilogramCanvas;
  let isRecording = false;
  let recordingStartTime: number;
  
  onMount(() => {
    wsClient.setStore(stabilogramStore);
    wsClient.connect().catch(console.error);
  });
  
  function handleExport() {
    if (canvasRef) {
      canvasRef.exportSessionData();
    }
  }
  
  function handleStartRecording() {
    isRecording = true;
    recordingStartTime = performance.now();
    console.log('Запись начата');
  }
  
  function handleStopRecording() {
    isRecording = false;
    const duration = (performance.now() - recordingStartTime) / 1000;
    console.log(`Запись остановлена. Продолжительность: ${duration.toFixed(1)}с`);
  }
</script>

<svelte:head>
  <title>Стабилометр - Анализ баланса</title>
</svelte:head>

<main class="app">
  <header class="app-header">
    <h1>Система анализа баланса</h1>
    <p>Медицинский стабилометр</p>
  </header>

  <div class="app-content">
    <aside class="sidebar">
      <ControlPanel 
        on:export={handleExport}
        on:startRecording={handleStartRecording}
        on:stopRecording={handleStopRecording}
      />
      
      {#if isRecording}
        <div class="recording-indicator">
          <div class="recording-dot"></div>
          <span>Идет запись...</span>
        </div>
      {/if}
    </aside>

    <section class="main-view">
      <MedicalStabilogramCanvas 
        bind:this={canvasRef}
        width={900}
        height={700}
        medicalMode={true}
        showDebug={false}
      />
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

  .app-header h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: #111827;
  }

  .app-header p {
    margin: 4px 0 0 0;
    color: #6b7280;
    font-size: 14px;
  }

  .app-content {
    flex: 1;
    display: flex;
    gap: 20px;
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }

  .sidebar {
    flex-shrink: 0;
  }

  .main-view {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .recording-indicator {
    margin-top: 16px;
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

  @keyframes recording-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @media (max-width: 1200px) {
    .app-content {
      flex-direction: column;
    }
    
    .sidebar {
      order: 2;
    }
    
    .main-view {
      order: 1;
    }
  }
</style>