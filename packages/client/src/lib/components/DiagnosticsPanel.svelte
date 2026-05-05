<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { diagnostics, type DiagnosticStats } from '@stabilometer/shared';
  
  let isOpen = false;
  let stats: DiagnosticStats | null = null;
  let issues: string[] = [];
  let updateInterval: ReturnType<typeof setInterval>;
  let autoScroll = true;
  
  // Логи для отображения
  let logLines: Array<{ timestamp: string; level: string; stage: string; message: string }> = [];
  let maxLogLines = 100;
  
  onMount(() => {
    updateInterval = setInterval(() => {
      stats = diagnostics.getStats();
      issues = diagnostics.generateDiagnosticReport();
      
      // Получаем свежие логи
      const recentSamples = diagnostics.getRecentSamples(10);
      const newLines = recentSamples
        .filter(s => s.type !== 'data') // Не показываем обычные data точки
        .map(s => ({
          timestamp: new Date(Date.now() - (performance.now() - s.timestamp)).toLocaleTimeString(),
          level: s.type,
          stage: s.stage.toUpperCase(),
          message: Object.entries(s.data).map(([k, v]) => `${k}=${v}`).join(' ')
        }));
      
      logLines = [...logLines, ...newLines].slice(-maxLogLines);
      
      if (autoScroll) {
        setTimeout(() => {
          const logContainer = document.getElementById('diagnostic-logs');
          if (logContainer) {
            logContainer.scrollTop = logContainer.scrollHeight;
          }
        }, 0);
      }
    }, 500);
  });
  
  onDestroy(() => {
    if (updateInterval) clearInterval(updateInterval);
  });
  
  function downloadDiagnosticData() {
    const data = diagnostics.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stabilometer-diagnostic-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  function clearDiagnostics() {
    diagnostics.clear();
    logLines = [];
    stats = diagnostics.getStats();
    issues = diagnostics.generateDiagnosticReport();
  }
  
  function formatNumber(value: number, precision: number = 1): string {
    return value.toFixed(precision);
  }
  
  function getConnectionStatusColor(state: string): string {
    switch (state) {
      case 'connected': return '#22c55e';
      case 'not_calibrated': return '#f59e0b';
      default: return '#ef4444';
    }
  }
  
  function getLogLevelColor(level: string): string {
    switch (level) {
      case 'error': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'info': return '#3b82f6';
      default: return '#6b7280';
    }
  }
</script>

<!-- Кнопка открытия панели -->
<button
  class="diagnostic-toggle"
  class:open={isOpen}
  on:click={() => isOpen = !isOpen}
  title="Диагностика системы"
>
  🔧
</button>

{#if isOpen}
  <div class="diagnostic-panel">
    <div class="panel-header">
      <h3>🔧 Диагностика системы</h3>
      <div class="panel-controls">
        <button on:click={clearDiagnostics} title="Очистить">🗑️</button>
        <button on:click={downloadDiagnosticData} title="Скачать данные">📥</button>
        <button on:click={() => isOpen = false} title="Закрыть">✖️</button>
      </div>
    </div>
    
    {#if stats}
      <!-- Статус соединения -->
      <div class="status-section">
        <div class="status-indicator" style="background-color: {getConnectionStatusColor(stats.connectionState)}"></div>
        <span>Состояние: {stats.connectionState}</span>
        {#if stats.isPlatformEmpty}
          <span class="status-tag">Платформа пуста</span>
        {/if}
      </div>
      
      <!-- Проблемы -->
      <div class="issues-section">
        <h4>📊 Анализ проблем:</h4>
        <ul>
          {#each issues as issue}
            <li class="issue-item" class:error={issue.includes('🔴')} class:warning={issue.includes('🟡')} class:success={issue.includes('✅')}>
              {issue}
            </li>
          {/each}
        </ul>
      </div>
      
      <!-- Основные метрики -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Пакеты</div>
          <div class="metric-value">{formatNumber(stats.packetRate)} Гц</div>
          <div class="metric-detail">{stats.validPackets}/{stats.totalPackets} валидных</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Рендер</div>
          <div class="metric-value">{formatNumber(stats.renderRate)} FPS</div>
          <div class="metric-detail">{formatNumber(stats.latencyMs)}мс задержка</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Фильтр</div>
          <div class="metric-value">{stats.kalmanResets} сбросов</div>
          <div class="metric-detail">σ={formatNumber(stats.filterUncertainty)}</div>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Позиция</div>
          <div class="metric-value">{formatNumber(stats.currentPosition.x)}, {formatNumber(stats.currentPosition.y)}</div>
          <div class="metric-detail">v={formatNumber(Math.sqrt(stats.currentVelocity.x**2 + stats.currentVelocity.y**2))} мм/с</div>
        </div>
      </div>
      
      <!-- Датчики -->
      <div class="sensors-section">
        <h4>🎛️ Датчики:</h4>
        <div class="sensors-grid">
          {#each Object.entries(stats.sensorRanges) as [key, sensor]}
            <div class="sensor-card">
              <div class="sensor-name">{key.toUpperCase()}</div>
              <div class="sensor-value">{sensor.current}</div>
              <div class="sensor-range">[{sensor.min}...{sensor.max}]</div>
            </div>
          {/each}
        </div>
      </div>
      
      <!-- Логи -->
      <div class="logs-section">
        <div class="logs-header">
          <h4>📝 Логи событий:</h4>
          <label>
            <input type="checkbox" bind:checked={autoScroll}>
            Автопрокрутка
          </label>
        </div>
        <div class="logs-container" id="diagnostic-logs">
          {#each logLines as line}
            <div class="log-line">
              <span class="log-time">{line.timestamp}</span>
              <span class="log-level" style="color: {getLogLevelColor(line.level)}">{line.level.toUpperCase()}</span>
              <span class="log-stage">{line.stage}</span>
              <span class="log-message">{line.message}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .diagnostic-toggle {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    border: none;
    border-radius: 50%;
    background: #374151;
    color: white;
    font-size: 18px;
    cursor: pointer;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: all 0.3s ease;
  }
  
  .diagnostic-toggle:hover {
    background: #4b5563;
    transform: scale(1.1);
  }
  
  .diagnostic-toggle.open {
    background: #3b82f6;
  }
  
  .diagnostic-panel {
    position: fixed;
    top: 80px;
    right: 20px;
    width: 500px;
    max-height: 80vh;
    background: #1f2937;
    color: #f9fafb;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    z-index: 999;
    overflow-y: auto;
    font-family: monospace;
    font-size: 12px;
  }
  
  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #374151;
    background: #111827;
    border-radius: 8px 8px 0 0;
  }
  
  .panel-header h3 {
    margin: 0;
    font-size: 16px;
  }
  
  .panel-controls {
    display: flex;
    gap: 8px;
  }
  
  .panel-controls button {
    background: none;
    border: 1px solid #4b5563;
    color: #f9fafb;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  
  .panel-controls button:hover {
    background: #374151;
  }
  
  .status-section {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid #374151;
  }
  
  .status-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  
  .status-tag {
    background: #f59e0b;
    color: black;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    margin-left: auto;
  }
  
  .issues-section {
    padding: 16px;
    border-bottom: 1px solid #374151;
  }
  
  .issues-section h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
  }
  
  .issue-item {
    list-style: none;
    padding: 4px 0;
    font-size: 11px;
  }
  
  .issue-item.error { color: #fca5a5; }
  .issue-item.warning { color: #fde047; }
  .issue-item.success { color: #86efac; }
  
  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 16px;
    border-bottom: 1px solid #374151;
  }
  
  .metric-card {
    background: #374151;
    padding: 8px;
    border-radius: 4px;
  }
  
  .metric-label {
    font-size: 10px;
    color: #9ca3af;
    margin-bottom: 2px;
  }
  
  .metric-value {
    font-size: 14px;
    font-weight: bold;
    color: #3b82f6;
  }
  
  .metric-detail {
    font-size: 9px;
    color: #6b7280;
    margin-top: 2px;
  }
  
  .sensors-section {
    padding: 16px;
    border-bottom: 1px solid #374151;
  }
  
  .sensors-section h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
  }
  
  .sensors-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  
  .sensor-card {
    background: #374151;
    padding: 6px;
    border-radius: 4px;
    text-align: center;
  }
  
  .sensor-name {
    font-size: 10px;
    color: #9ca3af;
  }
  
  .sensor-value {
    font-size: 12px;
    font-weight: bold;
    color: #22c55e;
    margin: 2px 0;
  }
  
  .sensor-range {
    font-size: 8px;
    color: #6b7280;
  }
  
  .logs-section {
    padding: 16px;
  }
  
  .logs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  
  .logs-header h4 {
    margin: 0;
    font-size: 14px;
  }
  
  .logs-header label {
    font-size: 10px;
    color: #9ca3af;
  }
  
  .logs-container {
    height: 200px;
    overflow-y: auto;
    background: #111827;
    border-radius: 4px;
    padding: 8px;
    font-size: 10px;
  }
  
  .log-line {
    display: grid;
    grid-template-columns: 80px 60px 60px 1fr;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid #374151;
  }
  
  .log-time {
    color: #6b7280;
    font-size: 9px;
  }
  
  .log-level {
    font-weight: bold;
    font-size: 9px;
  }
  
  .log-stage {
    color: #9ca3af;
    font-size: 9px;
  }
  
  .log-message {
    color: #f9fafb;
    word-wrap: break-word;
  }
</style>