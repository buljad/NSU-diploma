<script lang="ts">
  import KidsStabilogramCanvas from '$lib/components/KidsStabilogramCanvas.svelte';
  import { wsStore } from '$lib/stores/websocket';
  import { goto } from '$app/navigation';

  // Быстрые действия
  function handleConnect() {
    if (!$wsStore.serialConnected) {
      goto('/settings');
    }
  }
</script>

<svelte:head>
  <title>Визуализация | Стабилометр</title>
</svelte:head>

<div class="visualization-page">
  <div class="page-container">
    
    {#if !$wsStore.serialConnected}
      <!-- Заглушка когда не подключено -->
      <div class="not-connected">
        <div class="not-connected-content">
          <div class="not-connected-icon">📡</div>
          <h2>Стабилометр не подключен</h2>
          <p>Подключите устройство или запустите тестовый режим для начала работы</p>
          <button class="btn-primary" on:click={handleConnect}>
            <span class="btn-icon">⚙️</span>
            Перейти к настройкам
          </button>
          
          <div class="quick-info">
            <h3>💡 Быстрый старт:</h3>
            <ol>
              <li>Перейдите в раздел <strong>"Настройки"</strong></li>
              <li>Включите <strong>"Тестовый режим"</strong> для демонстрации</li>
              <li>Или подключите реальное устройство через COM-порт</li>
              <li>Нажмите <strong>"Подключиться"</strong></li>
              <li>Вернитесь на эту страницу для просмотра визуализации</li>
            </ol>
          </div>
        </div>
      </div>
    {:else}
      <!-- Визуализация в полноэкранном режиме -->
      <div class="visualization-active">
        <KidsStabilogramCanvas />
        
        <!-- Панель быстрых действий -->
        <div class="quick-actions">
          <button class="action-btn" on:click={() => goto('/settings')}>
            ⚙️ Настройки
          </button>
          <button class="action-btn" on:click={() => wsStore.clearData()}>
            🗑 Очистить данные
          </button>
          <button class="action-btn danger" on:click={() => wsStore.disconnectSerial()}>
            ⏹ Отключиться
          </button>
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .visualization-page {
    min-height: calc(100vh - 110px); /* высота - navbar - footer */
  }

  .page-container {
    max-width: 1600px;
    margin: 0 auto;
  }

  /* Состояние "не подключено" */
  .not-connected {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 150px);
    padding: 40px 20px;
  }

  .not-connected-content {
    max-width: 600px;
    background: white;
    padding: 60px 40px;
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    text-align: center;
  }

  .not-connected-icon {
    font-size: 80px;
    margin-bottom: 20px;
    animation: float 3s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }

  .not-connected-content h2 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 28px;
  }

  .not-connected-content p {
    margin: 0 0 30px 0;
    color: #666;
    font-size: 16px;
    line-height: 1.6;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 16px 32px;
    font-size: 16px;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
  }

  .btn-primary:active {
    transform: translateY(0);
  }

  .btn-icon {
    font-size: 20px;
  }

  .quick-info {
    margin-top: 40px;
    padding: 25px;
    background: #f9f9f9;
    border-radius: 8px;
    text-align: left;
  }

  .quick-info h3 {
    margin: 0 0 15px 0;
    color: #333;
    font-size: 18px;
  }

  .quick-info ol {
    margin: 0;
    padding-left: 25px;
    color: #666;
  }

  .quick-info li {
    margin: 10px 0;
    line-height: 1.6;
  }

  .quick-info strong {
    color: #667eea;
  }

  /* Визуализация активна */
  .visualization-active {
    position: relative;
  }

  .quick-actions {
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-top: 20px;
    flex-wrap: wrap;
  }

  .action-btn {
    padding: 12px 24px;
    font-size: 14px;
    font-weight: 500;
    background: white;
    color: #333;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: #f5f5f5;
    border-color: #667eea;
    transform: translateY(-2px);
  }

  .action-btn.danger {
    color: #f44336;
    border-color: #f44336;
  }

  .action-btn.danger:hover {
    background: #ffebee;
  }

  @media (max-width: 768px) {
    .not-connected-content {
      padding: 40px 30px;
    }

    .not-connected-icon {
      font-size: 60px;
    }

    .not-connected-content h2 {
      font-size: 24px;
    }

    .quick-actions {
      flex-direction: column;
    }

    .action-btn {
      width: 100%;
    }
  }
</style>