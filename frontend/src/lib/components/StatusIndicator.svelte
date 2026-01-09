<script lang="ts">
  import { wsStore } from '$lib/stores/websocket';

  $: wsConnected = $wsStore.connected;
  $: serialConnected = $wsStore.serialConnected;
  $: error = $wsStore.error;
  $: status = $wsStore.status;
</script>

<div class="status-panel">
  <!-- WebSocket статус -->
  <div class="status" class:connected={wsConnected} class:disconnected={!wsConnected} class:reconnecting={status === 'reconnecting'}>
    <span class="status-dot"></span>
    <span class="status-text">
      <strong>WebSocket:</strong> 
      {#if status === 'reconnecting'}
        Переподключение...
      {:else if wsConnected}
        Подключено
      {:else}
        Не подключено
      {/if}
    </span>
  </div>

  <!-- Serial порт статус -->
  <div class="status" class:connected={serialConnected} class:disconnected={!serialConnected}>
    <span class="status-dot"></span>
    <span class="status-text">
      <strong>COM-порт:</strong> 
      {serialConnected ? 'Подключено' : 'Не подключено'}
    </span>
  </div>

  <!-- Ошибки -->
  {#if error}
    <div class="error-message">
      ⚠️ {error}
      <button class="close-btn" on:click={() => wsStore.clearError()}>×</button>
    </div>
  {/if}
</div>

<style>
  .status-panel {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 20px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
  }

  .status.connected {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .status.disconnected {
    background: #ffebee;
    color: #c62828;
  }

  .status.reconnecting {
    background: #fff3e0;
    color: #e65100;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .connected .status-dot {
    background: #4CAF50;
    animation: pulse 2s infinite;
  }

  .disconnected .status-dot {
    background: #f44336;
  }

  .reconnecting .status-dot {
    background: #ff9800;
    animation: spin 1s linear infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .status-text strong {
    margin-right: 4px;
  }

  .error-message {
    background: #fff3cd;
    color: #856404;
    padding: 10px 15px;
    border-radius: 5px;
    border-left: 4px solid #ffc107;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 300px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #856404;
    margin-left: auto;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: #533f03;
  }
</style>