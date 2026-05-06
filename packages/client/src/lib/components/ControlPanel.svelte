<!-- packages/client/src/lib/components/ControlPanel.svelte -->
<script lang="ts">
  import { wsClient } from '../websocket/client';
  import { stabilogramStore } from '../stores/stabilogram';
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  
  const dispatch = createEventDispatcher();
  
  let availablePorts: any[] = [];
  let selectedPort = '';
  let isCalibrating = false;
  let calibrationProgress = 0;
  
  // ✅ Переменные для отслеживания подключений
  let unsubscribers: (() => void)[] = [];
  
  $: isConnected = $stabilogramStore.isWsConnected;
  $: isDeviceConnected = $stabilogramStore.isDeviceConnected;
  $: isCalibrated = $stabilogramStore.isCalibrated;
  
  onMount(() => {
    setupEventHandlers();
    // Запрашиваем порты при загрузке
    setTimeout(() => {
      wsClient.requestPorts();
    }, 500);
  });
  
  onDestroy(() => {
    // Очищаем подписки
    unsubscribers.forEach(unsub => unsub());
  });
  
  function setupEventHandlers() {
    // ✅ ИСПРАВЛЕНИЕ: Обработка списка портов
    const unsubPorts = wsClient.on('PORTS_LIST', (ports: any) => {
      console.log('Получены порты:', ports);
      availablePorts = Array.isArray(ports) ? ports : [];
      if (availablePorts.length > 0 && !selectedPort) {
        selectedPort = availablePorts[0].path;
      }
    });
    
    // ✅ ИСПРАВЛЕНИЕ: Обработка завершения калибровки
    const unsubCalibration = wsClient.on('CALIBRATION_COMPLETE', (data: any) => {
      console.log('Калибровка завершена:', data);
      isCalibrating = false;
      calibrationProgress = 100;
      
      // Сбрасываем прогресс через 2 секунды
      setTimeout(() => {
        calibrationProgress = 0;
      }, 2000);
    });
    
    // ✅ ИСПРАВЛЕНИЕ: Обработка начала калибровки
    const unsubCalibStart = wsClient.on('CALIBRATION_STARTED', () => {
      console.log('Калибровка начата');
      isCalibrating = true;
      calibrationProgress = 0;
    });
    
    // ✅ ИСПРАВЛЕНИЕ: Обработка прогресса калибровки
    const unsubCalibProgress = wsClient.on('CALIBRATION_PROGRESS', (data: any) => {
      if (data && typeof data.progress === 'number' && typeof data.total === 'number') {
        calibrationProgress = (data.progress / data.total) * 100;
      }
    });
    
    // Сохраняем функции отписки
    unsubscribers.push(unsubPorts, unsubCalibration, unsubCalibStart, unsubCalibProgress);
  }
  
  function requestPorts() {
    console.log('Запрос портов...');
    wsClient.requestPorts();
  }
  
  function connectDevice() {
    if (selectedPort) {
      console.log('Подключение к порту:', selectedPort);
      wsClient.connectToPort(selectedPort, 115200, false);
    }
  }
  
  function startTestMode() {
    console.log('Запуск тестового режима');
    wsClient.connectToPort('', 115200, true);
  }
  
  function startCalibration() {
    if (isDeviceConnected && !isCalibrating) {
      console.log('Запуск калибровки');
      wsClient.calibrateZero();
      // isCalibrating будет установлено через событие CALIBRATION_STARTED
    }
  }
  
  function disconnectDevice() {
    console.log('Отключение устройства');
    wsClient.disconnectFromPort();
    isCalibrating = false;
    calibrationProgress = 0;
  }
  
  function exportData() {
    dispatch('export');
  }
  
  function startRecording() {
    dispatch('startRecording');
  }
  
  function stopRecording() {
    dispatch('stopRecording');
  }
</script>

<div class="control-panel">
  <div class="section">
    <h3>Подключение устройства</h3>
    
    {#if !isDeviceConnected}
      <div class="connection-controls">
        <div class="port-selection">
          <button on:click={requestPorts} class="btn-secondary">
            Обновить порты
          </button>
          
          <select bind:value={selectedPort} disabled={!availablePorts.length}>
            <option value="">Выберите порт...</option>
            {#each availablePorts as port}
              <option value={port.path}>
                {port.path} {port.manufacturer ? `(${port.manufacturer})` : ''}
              </option>
            {/each}
          </select>
        </div>
        
        <div class="connect-buttons">
          <button 
            on:click={connectDevice} 
            disabled={!selectedPort}
            class="btn-primary"
          >
            Подключить устройство
          </button>
          
          <button on:click={startTestMode} class="btn-secondary">
            Тестовый режим
          </button>
        </div>
      </div>
    {:else}
      <div class="device-status">
        <div class="status-indicator connected">
          <span class="dot"></span>
          Устройство подключено
        </div>
        
        <button on:click={disconnectDevice} class="btn-danger">
          Отключить
        </button>
      </div>
    {/if}
  </div>

  <div class="section">
    <h3>Калибровка</h3>
    
    {#if !isCalibrated}
      <div class="calibration-warning">
        <strong>Требуется калибровка!</strong>
        <p>Освободите платформу и нажмите "Калибровать"</p>
      </div>
    {:else}
      <div class="calibration-success">
        <span class="check-mark">✓</span>
        Калибровка выполнена
      </div>
    {/if}
    
    <!-- ✅ УЛУЧШЕНИЕ: Прогресс калибровки -->
    {#if isCalibrating}
      <div class="calibration-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: {calibrationProgress}%"></div>
        </div>
        <span class="progress-text">{Math.round(calibrationProgress)}%</span>
      </div>
    {/if}
    
    <button 
      on:click={startCalibration}
      disabled={!isDeviceConnected || isCalibrating}
      class="btn-primary"
      class:loading={isCalibrating}
    >
      {isCalibrating ? 'Калибровка...' : 'Калибровать ноль'}
    </button>
  </div>

  <div class="section">
    <h3>Запись и анализ</h3>
    
    <div class="recording-controls">
      <button on:click={startRecording} class="btn-success">
        Начать запись
      </button>
      
      <button on:click={stopRecording} class="btn-secondary">
        Остановить
      </button>
      
      <button on:click={exportData} class="btn-secondary">
        Экспорт данных
      </button>
    </div>
  </div>
  
  <!-- ✅ ОТЛАДОЧНАЯ ПАНЕЛЬ (временная) -->
  {#if false}
    <div class="debug-section">
      <h4>Отладка</h4>
      <small>WS: {isConnected ? '✓' : '✗'}</small><br>
      <small>Device: {isDeviceConnected ? '✓' : '✗'}</small><br>
      <small>Calibrated: {isCalibrated ? '✓' : '✗'}</small><br>
      <small>Ports: {availablePorts.length}</small>
    </div>
  {/if}
</div>

<style>
  .control-panel {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    padding: 20px;
    width: 300px;
  }

  .section {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid #eee;
  }

  .section:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }

  h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: #333;
  }

  .connection-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .port-selection {
    display: flex;
    gap: 8px;
  }

  .connect-buttons {
    display: flex;
    gap: 8px;
  }

  .device-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .status-indicator.connected {
    color: #059669;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    animation: pulse 2s infinite;
  }

  .calibration-warning {
    background: #fef3cd;
    border: 1px solid #fde68a;
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 12px;
  }

  .calibration-warning strong {
    color: #92400e;
  }

  .calibration-warning p {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #78350f;
  }

  .calibration-success {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #059669;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .check-mark {
    color: #10b981;
    font-weight: bold;
  }

  /* ✅ НОВЫЕ СТИЛИ: Прогресс калибровки */
  .calibration-progress {
    margin-bottom: 12px;
  }

  .progress-bar {
    width: 100%;
    height: 6px;
    background: #f3f4f6;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #1d4ed8);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 12px;
    color: #6b7280;
  }

  .recording-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .debug-section {
    border-top: 1px solid #eee;
    padding-top: 12px;
    margin-top: 12px;
  }

  .debug-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: #666;
  }

  .debug-section small {
    font-size: 11px;
    color: #888;
    line-height: 1.4;
  }

  /* Кнопки */
  button {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #3b82f6;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-secondary {
    background: #f3f4f6;
    color: #374151;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #e5e7eb;
  }

  .btn-success {
    background: #10b981;
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: #059669;
  }

  .btn-danger {
    background: #ef4444;
    color: white;
    font-size: 12px;
    padding: 6px 12px;
  }

  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }

  .loading {
    position: relative;
    overflow: hidden;
  }

  .loading::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255,255,255,0.3),
      transparent
    );
    animation: loading-sweep 1.5s infinite;
  }

  select {
    flex: 1;
    padding: 8px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 13px;
  }

  @keyframes loading-sweep {
    0% { left: -100%; }
    100% { left: 100%; }
  }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
    50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
  }
</style>