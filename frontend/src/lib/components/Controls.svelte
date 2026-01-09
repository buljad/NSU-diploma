<script lang="ts">
  import { wsStore } from "$lib/stores/websocket";
  import type { SerialConfig } from "$lib/types/stabilogram";
  import { onMount } from "svelte";

  let baudRate: number = 9600;
  let selectedPort: string = "";
  let showPortSelection: boolean = false;
  let autoRefresh: boolean = false;
  let testMode: boolean = false;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  $: availablePorts = $wsStore.availablePorts;
  $: hasNoPorts = availablePorts.length === 0 && showPortSelection;
  $: wsConnected = $wsStore.connected;
  $: serialConnected = $wsStore.serialConnected;
  $: canConnect = wsConnected && (testMode || availablePorts.length > 0);

  // Автообновление списка портов каждые 3 секунды
  $: if (autoRefresh && wsConnected && !serialConnected && !testMode) {
    if (!refreshInterval) {
      refreshInterval = setInterval(() => {
        wsStore.listPorts();
      }, 3000);
    }
  } else {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  onMount(() => {
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  });

  function handleRefreshPorts(): void {
    console.log("🔄 Запрос списка портов...");
    wsStore.listPorts();
    showPortSelection = true;
  }

  function handleConnect(): void {
    if (!testMode && !selectedPort && availablePorts.length === 0) {
      wsStore.send("ERROR", {
        message: "Сначала найдите доступные порты или включите тестовый режим",
      });
      return;
    }

    const portPath = testMode
      ? null
      : selectedPort ||
        (availablePorts.length > 0 ? availablePorts[0].path : null);

    // ✅ ДОБАВЛЕНО ЛОГИРОВАНИЕ
    console.log("🔍 testMode:", testMode);
    console.log("🔍 portPath:", portPath);
    console.log("🔍 baudRate:", baudRate);

    console.log(
      testMode
        ? "🧪 Подключение в тестовом режиме"
        : `🔌 Подключение к порту: ${portPath} (${baudRate} baud)`
    );

    const config: SerialConfig = {
      baudRate,
      portPath,
      testMode,
    };

    // ✅ ДОБАВЛЕНО ЛОГИРОВАНИЕ
    console.log("🔍 Передаваемая конфигурация:", config);

    wsStore.connectSerial(config);
  }

  function handleDisconnect(): void {
    wsStore.disconnectSerial();
    selectedPort = "";
  }

  function handleClear(): void {
    wsStore.clearData();
  }

  function handlePortSelect(portPath: string): void {
    selectedPort = portPath;
    console.log("✅ Выбран порт:", portPath);
  }

  function handleTestModeToggle(): void {
    if (testMode) {
      showPortSelection = false; // Скрываем порты в тестовом режиме
    }
    console.log(
      testMode ? "🧪 Тестовый режим включен" : "📡 Тестовый режим выключен"
    );
  }
</script>

<div class="controls-container">
  <!-- Панель управления -->
  <div class="controls-header">
    <h3>⚙️ Управление подключением</h3>
  </div>

  <!-- Основные кнопки -->
  <div class="controls-buttons">
    <button
      class="btn btn-primary"
      on:click={handleRefreshPorts}
      disabled={!wsConnected || serialConnected || testMode}
      title="Получить список доступных COM-портов"
    >
      <span class="btn-icon">🔄</span>
      <span>Найти порты</span>
    </button>

    <button
      class="btn btn-success"
      class:test-mode={testMode}
      on:click={handleConnect}
      disabled={!wsConnected || serialConnected || !canConnect}
      title={testMode
        ? "Запустить симуляцию данных"
        : "Подключиться к выбранному порту"}
    >
      <span class="btn-icon">{testMode ? "🧪" : "🔌"}</span>
      <span>{testMode ? "Запустить симуляцию" : "Подключиться"}</span>
    </button>

    <button
      class="btn btn-danger"
      on:click={handleDisconnect}
      disabled={!serialConnected}
      title="Отключиться от COM-порта"
    >
      <span class="btn-icon">⏹</span>
      <span>Отключиться</span>
    </button>

    <button
      class="btn btn-secondary"
      on:click={handleClear}
      title="Очистить лог данных"
    >
      <span class="btn-icon">🗑</span>
      <span>Очистить лог</span>
    </button>
  </div>

  <!-- Настройки -->
  <div class="controls-settings">
    <div class="setting-item">
      <label for="baudRate">📡 Скорость передачи (baud):</label>
      <select
        id="baudRate"
        bind:value={baudRate}
        disabled={serialConnected || testMode}
      >
        <option value={9600}>9600</option>
        <option value={19200}>19200</option>
        <option value={38400}>38400</option>
        <option value={57600}>57600</option>
        <option value={115200}>115200</option>
      </select>
    </div>

    <div class="setting-item">
      <label class="checkbox-label" class:test-mode={testMode}>
        <input
          type="checkbox"
          bind:checked={testMode}
          on:change={handleTestModeToggle}
          disabled={serialConnected}
        />
        <span class="checkbox-icon">{testMode ? "🧪" : "📡"}</span>
        <span class="checkbox-text">
          {testMode
            ? "Тестовый режим (симуляция)"
            : "Работа с реальным устройством"}
        </span>
      </label>
    </div>

    <div class="setting-item">
      <label>
        <input
          type="checkbox"
          bind:checked={autoRefresh}
          disabled={serialConnected || !showPortSelection || testMode}
        />
        🔄 Автообновление списка портов
      </label>
    </div>
  </div>

  <!-- Список портов -->
  {#if showPortSelection && !testMode}
    <div class="ports-panel">
      <div class="ports-header">
        <h4>📋 Доступные COM-порты:</h4>
        <div class="ports-actions">
          <button
            class="btn-small"
            on:click={handleRefreshPorts}
            disabled={serialConnected}
            title="Обновить список"
          >
            🔄 Обновить
          </button>
          <span class="ports-count">
            Найдено: <strong>{availablePorts.length}</strong>
          </span>
        </div>
      </div>

      {#if hasNoPorts}
        <!-- Нет портов -->
        <div class="no-ports-warning">
          <div class="warning-icon">⚠️</div>
          <div class="warning-content">
            <h5>COM-порты не найдены</h5>
            <p>Возможные причины:</p>
            <ul>
              <li>Устройство не подключено к компьютеру</li>
              <li>Не установлены драйверы для устройства</li>
              <li>Порт занят другим приложением</li>
              <li>Требуются права администратора</li>
            </ul>
            <div class="warning-actions">
              <button class="btn btn-warning" on:click={handleRefreshPorts}>
                🔄 Попробовать снова
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Список портов -->
        <div class="ports-list">
          {#each availablePorts as port, index}
            <label
              class="port-card"
              class:selected={selectedPort === port.path}
              class:disabled={serialConnected}
            >
              <input
                type="radio"
                name="port"
                value={port.path}
                checked={selectedPort === port.path}
                on:change={() => handlePortSelect(port.path)}
                disabled={serialConnected}
              />

              <div class="port-content">
                <div class="port-main">
                  <span class="port-number">#{index + 1}</span>
                  <span class="port-path">{port.path}</span>
                  {#if selectedPort === port.path}
                    <span class="port-badge selected-badge">✓ Выбран</span>
                  {/if}
                </div>

                <div class="port-details">
                  {#if port.manufacturer}
                    <div class="port-detail">
                      <span class="detail-label">Производитель:</span>
                      <span class="detail-value">{port.manufacturer}</span>
                    </div>
                  {/if}

                  {#if port.serialNumber && port.serialNumber !== "N/A"}
                    <div class="port-detail">
                      <span class="detail-label">Серийный номер:</span>
                      <span class="detail-value">{port.serialNumber}</span>
                    </div>
                  {/if}

                  {#if port.productId}
                    <div class="port-detail">
                      <span class="detail-label">Product ID:</span>
                      <span class="detail-value">{port.productId}</span>
                    </div>
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>

        <!-- Подсказка -->
        {#if !selectedPort && availablePorts.length > 0}
          <div class="ports-hint">
            💡 <strong>Совет:</strong> Если не выбрать порт, будет использован
            первый из списка ({availablePorts[0].path})
          </div>
        {/if}
      {/if}
    </div>
  {:else if wsConnected && !testMode}
    <!-- Подсказка до нажатия "Найти порты" -->
    <div class="initial-hint">
      <p>
        👆 Нажмите <strong>"Найти порты"</strong> чтобы увидеть список доступных
        COM-портов
      </p>
    </div>
  {:else if testMode}
    <!-- Подсказка для тестового режима -->
    <div class="test-mode-hint">
      <div class="test-hint-icon">🧪</div>
      <div class="test-hint-content">
        <h4>Тестовый режим активен</h4>
        <p>Будет использоваться симуляция данных стабилометра</p>
        <ul>
          <li>Генерация реалистичных координат центра давления</li>
          <li>Имитация различных движений и нагрузок</li>
          <li>Тестирование парсера без реального оборудования</li>
        </ul>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ============================================================================
     ОСНОВНЫЕ СТИЛИ
     ============================================================================ */

  .controls-container {
    background: white;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
  }

  .controls-header h3 {
    margin: 0 0 20px 0;
    color: #333;
    font-size: 18px;
  }

  /* Кнопки */
  .controls-buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
    transform: translateZ(0);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-icon {
    font-size: 16px;
    transition: transform 0.2s ease;
  }

  .btn::before {
    content: "";
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.2),
      transparent
    );
    transition: left 0.5s;
  }

  .btn:hover::before {
    left: 100%;
  }

  .btn:active {
    transform: scale(0.98);
  }

  .btn:disabled::before {
    display: none;
  }

  .btn-primary {
    background: linear-gradient(135deg, #2196f3, #1976d2);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #1976d2, #1565c0);
  }

  .btn-success {
    background: linear-gradient(135deg, #4caf50, #388e3c);
    color: white;
  }

  .btn-success:hover:not(:disabled) {
    background: linear-gradient(135deg, #388e3c, #2e7d32);
  }

  .btn-success:not(:disabled) {
    animation: pulse-ready 3s infinite;
  }

  @keyframes pulse-ready {
    0%,
    95%,
    100% {
      box-shadow: 0 2px 5px rgba(76, 175, 80, 0.3);
    }
    50% {
      box-shadow: 0 2px 15px rgba(76, 175, 80, 0.6);
    }
  }

  .btn-danger {
    background: linear-gradient(135deg, #f44336, #d32f2f);
    color: white;
  }

  .btn-danger:hover:not(:disabled) {
    background: linear-gradient(135deg, #d32f2f, #c62828);
  }

  .btn-secondary {
    background: linear-gradient(135deg, #9e9e9e, #757575);
    color: white;
  }

  .btn-secondary:hover:not(:disabled) {
    background: linear-gradient(135deg, #757575, #616161);
  }

  .btn-warning {
    background: #ff9800;
    color: white;
    padding: 8px 16px;
    font-size: 13px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-small {
    background: #e3f2fd;
    color: #1976d2;
    border: 1px solid #90caf9;
    padding: 6px 12px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-small:hover:not(:disabled) {
    background: #bbdefb;
  }

  /* ============================================================================
     ТЕСТОВЫЙ РЕЖИМ
     ============================================================================ */

  .test-mode {
    background: linear-gradient(135deg, #ff9800, #f57c00) !important;
    color: white !important;
    box-shadow: 0 0 15px rgba(255, 152, 0, 0.3);
    transform: scale(1.02);
  }

  .test-mode .btn-icon {
    animation: pulse-test 1.5s infinite;
  }

  @keyframes pulse-test {
    0%,
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
    50% {
      transform: scale(1.1);
      filter: brightness(1.2);
    }
  }

  /* Настройки */
  .controls-settings {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    padding: 15px;
    background: #f9f9f9;
    border-radius: 6px;
    margin-bottom: 20px;
  }

  .setting-item {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .setting-item label {
    font-weight: 500;
    color: #555;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 6px;
    transition: all 0.3s ease;
  }

  .checkbox-label:hover {
    background: #f0f0f0;
  }

  .checkbox-label.test-mode {
    background: #fff3e0;
    border: 1px solid #ff9800;
  }

  .checkbox-icon {
    font-size: 16px;
    transition: transform 0.2s ease;
  }

  .checkbox-label:hover .checkbox-icon {
    transform: scale(1.2);
  }

  .checkbox-text {
    font-weight: 500;
  }

  select {
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 14px;
    background: white;
    cursor: pointer;
  }

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ============================================================================
     ПАНЕЛЬ ПОРТОВ
     ============================================================================ */

  .ports-panel {
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
  }

  .ports-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }

  .ports-header h4 {
    margin: 0;
    font-size: 16px;
    color: #333;
  }

  .ports-actions {
    display: flex;
    gap: 15px;
    align-items: center;
  }

  .ports-count {
    font-size: 14px;
    color: #666;
  }

  .ports-count strong {
    color: #2196f3;
    font-size: 16px;
  }

  /* Список портов */
  .ports-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: 400px;
    overflow-y: auto;
  }

  .port-card {
    display: flex;
    gap: 15px;
    padding: 15px 20px;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
    transition: all 0.2s;
    will-change: transform, background-color;
  }

  .port-card:last-child {
    border-bottom: none;
  }

  .port-card:hover:not(.disabled) {
    background: #f5f9ff;
  }

  .port-card.selected {
    background: #e3f2fd;
    border-left: 4px solid #2196f3;
  }

  .port-card.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .port-card input[type="radio"] {
    margin-top: 2px;
    cursor: pointer;
  }

  .port-content {
    flex: 1;
  }

  .port-main {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .port-number {
    background: #e0e0e0;
    color: #666;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .port-path {
    font-weight: 600;
    font-size: 16px;
    color: #333;
  }

  .port-badge {
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }

  .selected-badge {
    background: #4caf50;
    color: white;
  }

  .port-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .port-detail {
    display: flex;
    gap: 8px;
    font-size: 13px;
  }

  .detail-label {
    color: #999;
    min-width: 140px;
  }

  .detail-value {
    color: #666;
    font-weight: 500;
  }

  /* Предупреждение */
  .no-ports-warning {
    display: flex;
    gap: 20px;
    padding: 30px;
    background: #fff3cd;
    border-bottom: 1px solid #ffc107;
  }

  .warning-icon {
    font-size: 48px;
    line-height: 1;
  }

  .warning-content h5 {
    margin: 0 0 10px 0;
    color: #856404;
    font-size: 16px;
  }

  .warning-content p {
    margin: 0 0 8px 0;
    color: #856404;
    font-size: 14px;
  }

  .warning-content ul {
    margin: 0 0 15px 20px;
    padding: 0;
    color: #856404;
  }

  .warning-content li {
    margin: 4px 0;
    font-size: 13px;
  }

  .warning-actions {
    margin-top: 15px;
  }

  /* Подсказки */
  .ports-hint {
    padding: 12px 20px;
    background: #e3f2fd;
    border-top: 1px solid #90caf9;
    font-size: 13px;
    color: #1565c0;
  }

  .initial-hint {
    padding: 30px;
    text-align: center;
    background: #f5f5f5;
    border-radius: 6px;
    border: 2px dashed #ddd;
  }

  .initial-hint p {
    margin: 0;
    color: #666;
    font-size: 14px;
  }

  .test-mode-hint {
    display: flex;
    gap: 20px;
    padding: 25px;
    background: linear-gradient(135deg, #fff3e0, #ffe0b2);
    border: 2px solid #ff9800;
    border-radius: 12px;
    margin-top: 15px;
  }

  .test-hint-icon {
    font-size: 48px;
    line-height: 1;
    animation: bounce-test 2s infinite;
  }

  @keyframes bounce-test {
    0%,
    20%,
    50%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-10px);
    }
    60% {
      transform: translateY(-5px);
    }
  }

  .test-hint-content h4 {
    margin: 0 0 10px 0;
    color: #f57c00;
    font-size: 18px;
  }

  .test-hint-content p {
    margin: 0 0 10px 0;
    color: #e65100;
    font-size: 14px;
  }

  .test-hint-content ul {
    margin: 0;
    padding-left: 20px;
    color: #e65100;
  }

  .test-hint-content li {
    margin: 4px 0;
    font-size: 13px;
  }

  /* ============================================================================
     СКРОЛЛБАР
     ============================================================================ */

  .ports-list::-webkit-scrollbar {
    width: 8px;
  }

  .ports-list::-webkit-scrollbar-track {
    background: #f5f5f5;
  }

  .ports-list::-webkit-scrollbar-thumb {
    background: #ccc;
    border-radius: 4px;
  }

  .ports-list::-webkit-scrollbar-thumb:hover {
    background: #aaa;
  }

  /* ============================================================================
     АДАПТИВНОСТЬ
     ============================================================================ */

  @media (max-width: 768px) {
    .controls-buttons {
      flex-direction: column;
    }

    .btn {
      width: 100%;
      justify-content: center;
    }

    .controls-settings {
      flex-direction: column;
      gap: 10px;
    }

    .setting-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 5px;
    }

    .ports-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .test-mode-hint {
      flex-direction: column;
      text-align: center;
    }
  }

  @media (max-width: 480px) {
    .controls-container {
      padding: 15px;
    }

    .btn {
      padding: 14px 20px;
      font-size: 16px;
    }

    .controls-header h3 {
      font-size: 16px;
    }
  }

  /* ============================================================================
     ТЕМНАЯ ТЕМА
     ============================================================================ */

  @media (prefers-color-scheme: dark) {
    .controls-container {
      background: #2d2d2d;
      color: #e0e0e0;
    }

    .controls-settings {
      background: #1e1e1e;
    }

    .checkbox-label:hover {
      background: #3d3d3d;
    }

    .initial-hint {
      background: #1e1e1e;
      border-color: #444;
      color: #ccc;
    }

    select {
      background: #3d3d3d;
      color: #e0e0e0;
      border-color: #555;
    }
  }

  /* ============================================================================
     ПРОИЗВОДИТЕЛЬНОСТЬ
     ============================================================================ */

  .btn {
    will-change: transform;
  }

  .checkbox-icon {
    will-change: transform;
  }

  /* Отключаем анимации для пользователей с ограниченными возможностями */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
