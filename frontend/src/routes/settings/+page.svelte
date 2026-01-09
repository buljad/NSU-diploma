<script lang="ts">
  import Controls from '$lib/components/Controls.svelte';
  import StatusIndicator from '$lib/components/StatusIndicator.svelte';
  import DataLog from '$lib/components/DataLog.svelte';
  import { goto } from '$app/navigation';
  import { wsStore } from '$lib/stores/websocket';

  // Автоматический переход на визуализацию после подключения
  let wasConnected = false;
  
  $: if ($wsStore.serialConnected && !wasConnected) {
    wasConnected = true;
    // Опционально: автоматический переход
    // setTimeout(() => goto('/'), 2000);
  }
  
  $: if (!$wsStore.serialConnected) {
    wasConnected = false;
  }
</script>

<svelte:head>
  <title>Настройки | Стабилометр</title>
</svelte:head>

<div class="settings-page">
  <div class="page-container">
    
    <header class="page-header">
      <h1>⚙️ Настройки подключения</h1>
      <p class="subtitle">Подключение к COM-порту и управление данными</p>
    </header>

    <!-- Уведомление об успешном подключении -->
    {#if $wsStore.serialConnected}
      <div class="success-notification">
        <div class="notification-content">
          <span class="notification-icon">✅</span>
          <div class="notification-text">
            <strong>Подключение установлено!</strong>
            <p>Устройство передает данные. Перейдите на страницу визуализации.</p>
          </div>
          <button class="notification-btn" on:click={() => goto('/')}>
            📊 Открыть визуализацию
          </button>
        </div>
      </div>
    {/if}

    <StatusIndicator />
    <Controls />
    <DataLog />

    <!-- Дополнительная информация -->
    <div class="info-panel">
      <h3>ℹ️ Информация</h3>
      <div class="info-grid">
        <div class="info-card">
          <div class="info-icon">🔌</div>
          <h4>Подключение</h4>
          <p>Выберите COM-порт устройства или включите тестовый режим для демонстрации</p>
        </div>
        <div class="info-card">
          <div class="info-icon">📊</div>
          <h4>Визуализация</h4>
          <p>После подключения данные будут доступны на главной странице</p>
        </div>
        <div class="info-card">
          <div class="info-icon">🧪</div>
          <h4>Тестовый режим</h4>
          <p>Симуляция данных для тестирования без реального устройства</p>
        </div>
      </div>
    </div>

  </div>
</div>

<style>
  .settings-page {
    min-height: calc(100vh - 110px);
  }

  .page-container {
    max-width: 1400px;
    margin: 0 auto;
    background: white;
    border-radius: 16px;
    padding: 40px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  }

  .page-header {
    margin-bottom: 30px;
  }

  .page-header h1 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 32px;
  }

  .subtitle {
    margin: 0;
    color: #666;
    font-size: 16px;
  }

  /* Уведомление об успешном подключении */
  .success-notification {
    margin-bottom: 30px;
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .notification-content {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 20px 25px;
    background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
    border: 2px solid #4CAF50;
    border-radius: 12px;
  }

  .notification-icon {
    font-size: 32px;
  }

  .notification-text {
    flex: 1;
  }

  .notification-text strong {
    display: block;
    color: #2e7d32;
    font-size: 16px;
    margin-bottom: 5px;
  }

  .notification-text p {
    margin: 0;
    color: #1b5e20;
    font-size: 14px;
  }

  .notification-btn {
    padding: 12px 24px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
  }

  .notification-btn:hover {
    background: #45a049;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
  }

  /* Информационная панель */
  .info-panel {
    margin-top: 40px;
    padding: 30px;
    background: #f9f9f9;
    border-radius: 12px;
  }

  .info-panel h3 {
    margin: 0 0 20px 0;
    color: #333;
    font-size: 20px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
  }

  .info-card {
    padding: 25px;
    background: white;
    border-radius: 8px;
    border: 1px solid #e0e0e0;
    transition: all 0.2s;
  }

  .info-card:hover {
    border-color: #667eea;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
    transform: translateY(-2px);
  }

  .info-icon {
    font-size: 32px;
    margin-bottom: 15px;
  }

  .info-card h4 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 16px;
  }

  .info-card p {
    margin: 0;
    color: #666;
    font-size: 14px;
    line-height: 1.6;
  }

  @media (max-width: 768px) {
    .page-container {
      padding: 20px;
    }

    .page-header h1 {
      font-size: 24px;
    }

    .notification-content {
      flex-direction: column;
      text-align: center;
    }

    .notification-btn {
      width: 100%;
    }

    .info-grid {
      grid-template-columns: 1fr;
    }
  }
</style>