<script lang="ts">
  import { wsStore } from '$lib/stores/websocket';
  import { onMount, onDestroy } from 'svelte';
  
  interface LogEntry {
    timestamp: Date;
    type: 'raw' | 'parsed' | 'info' | 'error';
    message: string;
    data?: any;
  }
  
  let logs: LogEntry[] = [];
  let maxLogs = 100;
  let showParsedData = true;
  let autoscroll = true;
  let logContainer: HTMLDivElement;
  
  // Подписка на изменения данных
  const unsubscribe = wsStore.subscribe(($store) => {
    // Добавляем последнее сообщение в лог
    if ($store.data.length > 0) {
      const lastMessage = $store.data[$store.data.length - 1];
      
      if (lastMessage.parsed) {
        // Добавляем распарсенные данные
        addLog('parsed', '✅ Пакет распарсен', {
          raw: lastMessage.raw,
          x: lastMessage.parsed.interpretation.variant2.x,
          y: lastMessage.parsed.interpretation.variant2.y,
          xMm: (lastMessage.parsed.interpretation.variant2.x / 1000).toFixed(2),
          yMm: (lastMessage.parsed.interpretation.variant2.y / 1000).toFixed(2),
          force: lastMessage.parsed.interpretation.variant2.force,
          time: lastMessage.parsed.deviceTime,
          coord1: lastMessage.parsed.coordinates.coord1,
          coord2: lastMessage.parsed.coordinates.coord2,
          coord3: lastMessage.parsed.coordinates.coord3,
          coord4: lastMessage.parsed.coordinates.coord4
        });
      } else {
        // Сырые данные
        addLog('raw', `📥 Сырые данные: ${lastMessage.raw}`);
      }
    }
    
    // Логируем ошибки
    if ($store.error) {
      addLog('error', `❌ ${$store.error}`);
    }
  });
  
  function addLog(type: LogEntry['type'], message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date(),
      type,
      message,
      data
    };
    
    logs = [...logs, entry];
    
    // Ограничиваем количество логов
    if (logs.length > maxLogs) {
      logs = logs.slice(-maxLogs);
    }
    
    // Автопрокрутка
    if (autoscroll && logContainer) {
      setTimeout(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      }, 50);
    }
  }
  
  function clearLogs() {
    logs = [];
  }
  
  function exportLogs() {
    const data = JSON.stringify(logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stabilogram-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  onDestroy(() => {
    unsubscribe();
  });
</script>

<div class="data-log">
  <div class="log-header">
    <h3>📋 Журнал данных</h3>
    <div class="log-controls">
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          bind:checked={showParsedData}
        >
        <span>Показать детали</span>
      </label>
      <label class="checkbox-label">
        <input 
          type="checkbox" 
          bind:checked={autoscroll}
        >
        <span>Автопрокрутка</span>
      </label>
      <button class="btn-small" on:click={clearLogs}>
        🗑️ Очистить
      </button>
      <button class="btn-small" on:click={exportLogs}>
        💾 Экспорт
      </button>
    </div>
  </div>
  
  <div class="log-container" bind:this={logContainer}>
    {#if logs.length === 0}
      <div class="log-empty">
        <span class="empty-icon">📭</span>
        <p>Журнал пуст</p>
        <p class="empty-hint">Данные появятся после подключения</p>
      </div>
    {:else}
      {#each logs as log}
        <div class="log-entry {log.type}">
          <span class="log-time">
            {log.timestamp.toLocaleTimeString('ru-RU', { 
              hour: '2-digit', 
              minute: '2-digit', 
              second: '2-digit',
              fractionalSecondDigits: 3 
            })}
          </span>
          <span class="log-message">{log.message}</span>
          
          {#if log.type === 'parsed' && log.data && showParsedData}
            <div class="parsed-data">
              <div class="parsed-grid">
                <div class="parsed-section">
                  <h4>📦 Пакет</h4>
                  <code>{log.data.raw}</code>
                </div>
                
                <div class="parsed-section">
                  <h4>📍 Координаты</h4>
                  <div class="coord-grid">
                    <div>X: {log.data.x} μm ({log.data.xMm} мм)</div>
                    <div>Y: {log.data.y} μm ({log.data.yMm} мм)</div>
                    <div>Force: {log.data.force}</div>
                    <div>Time: {log.data.time}</div>
                  </div>
                </div>
                
                <div class="parsed-section">
                  <h4>🔢 Сырые значения</h4>
                  <div class="raw-values">
                    <span>C1: {log.data.coord1}</span>
                    <span>C2: {log.data.coord2}</span>
                    <span>C3: {log.data.coord3}</span>
                    <span>C4: {log.data.coord4}</span>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  
  <div class="log-footer">
    <span class="log-count">
      Записей: {logs.length} / {maxLogs}
    </span>
    <span class="log-stats">
      Пакетов: {logs.filter(l => l.type === 'parsed').length} | 
      Ошибок: {logs.filter(l => l.type === 'error').length}
    </span>
  </div>
</div>

<style>
  .data-log {
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    overflow: hidden;
    margin-top: 20px;
  }
  
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }
  
  .log-header h3 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }
  
  .log-controls {
    display: flex;
    align-items: center;
    gap: 15px;
  }
  
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 14px;
    color: #666;
  }
  
  .checkbox-label input {
    cursor: pointer;
  }
  
  .btn-small {
    padding: 6px 12px;
    font-size: 14px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-small:hover {
    background: #f0f0f0;
    border-color: #999;
  }
  
  .log-container {
    height: 400px;
    overflow-y: auto;
    padding: 10px;
    background: #fafafa;
  }
  
  .log-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #999;
  }
  
  .empty-icon {
    font-size: 48px;
    margin-bottom: 10px;
  }
  
  .log-empty p {
    margin: 5px 0;
  }
  
  .empty-hint {
    font-size: 14px;
    color: #bbb;
  }
  
  .log-entry {
    padding: 10px;
    margin-bottom: 8px;
    background: white;
    border-radius: 8px;
    border-left: 4px solid #ddd;
    font-family: 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    transition: all 0.2s;
  }
  
  .log-entry.parsed {
    border-left-color: #4CAF50;
    background: #f1f8e9;
  }
  
  .log-entry.raw {
    border-left-color: #2196F3;
  }
  
  .log-entry.error {
    border-left-color: #f44336;
    background: #ffebee;
  }
  
  .log-entry.info {
    border-left-color: #FF9800;
    background: #fff3e0;
  }
  
  .log-time {
    color: #999;
    margin-right: 10px;
    font-size: 12px;
  }
  
  .log-message {
    color: #333;
  }
  
  /* Распарсенные данные */
  .parsed-data {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #e8f5e9;
  }
  
  .parsed-grid {
    display: grid;
    gap: 15px;
  }
  
  .parsed-section {
    background: white;
    padding: 12px;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
  }
  
  .parsed-section h4 {
    margin: 0 0 8px 0;
    font-size: 12px;
    color: #666;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .parsed-section code {
    display: block;
    padding: 6px;
    background: #f5f5f5;
    border-radius: 4px;
    font-size: 12px;
    color: #333;
    word-break: break-all;
  }
  
  .coord-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    font-size: 12px;
  }
  
  .coord-grid div {
    padding: 4px 8px;
    background: #f5f5f5;
    border-radius: 4px;
  }
  
  .raw-values {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  
  .raw-values span {
    padding: 4px 8px;
    background: #e3f2fd;
    border-radius: 4px;
    font-size: 12px;
  }
  
  /* Скроллбар */
  .log-container::-webkit-scrollbar {
    width: 8px;
  }
  
  .log-container::-webkit-scrollbar-track {
    background: #f1f1f1;
  }
  
  .log-container::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }
  
  .log-container::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
  
  .log-footer {
    padding: 12px 20px;
    background: #f5f5f5;
    border-top: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: #666;
  }
  
  @media (max-width: 768px) {
    .log-header {
      flex-direction: column;
      gap: 10px;
    }
    
    .log-controls {
      width: 100%;
      justify-content: space-between;
    }
    
    .log-container {
      height: 300px;
    }
    
    .coord-grid {
      grid-template-columns: 1fr;
    }
  }
</style>