<script lang="ts">
  import { page } from '$app/stores';
  import { wsStore } from '$lib/stores/websocket';
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';

  const WS_URL = 'ws://localhost:8081';

  onMount(() => {
    wsStore.connect(WS_URL);
  });

  onDestroy(() => {
    wsStore.disconnect();
  });

  $: currentPath = $page.url.pathname;
</script>

<svelte:head>
  <title>Стабилометр</title>
</svelte:head>

<div class="app">
  <!-- Навигация -->
  <nav class="navbar">
    <div class="nav-container">
      <div class="nav-brand">
        <span class="brand-icon">⚖️</span>
        <span class="brand-text">Стабилометр</span>
      </div>

      <div class="nav-links">
        <a 
          href="/" 
          class="nav-link"
          class:active={currentPath === '/'}
        >
          <span class="link-icon">📊</span>
          <span>Визуализация</span>
        </a>
        <a 
          href="/settings" 
          class="nav-link"
          class:active={currentPath === '/settings'}
        >
          <span class="link-icon">⚙️</span>
          <span>Настройки</span>
        </a>
      </div>

      <!-- Статус подключения в навбаре -->
      <div class="nav-status">
        <div class="status-indicator" class:connected={$wsStore.connected}>
          <span class="status-dot"></span>
          <span class="status-text">
            {#if $wsStore.serialConnected}
              🟢 Подключено
            {:else if $wsStore.connected}
              🟡 Готов
            {:else}
              🔴 Не подключено
            {/if}
          </span>
        </div>
      </div>
    </div>
  </nav>

  <!-- Контент страницы -->
  <main class="main-content">
    <slot />
  </main>

  <!-- Футер -->
  <footer class="footer">
    <div class="footer-content">
      <p>© 2025 Стабилометр | WebSocket: {WS_URL}</p>
    </div>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
      Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  /* Навигация */
  .navbar {
    background: white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    position: sticky;
    top: 0;
    z-index: 1000;
  }

  .nav-container {
    max-width: 1600px;
    margin: 0 auto;
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 30px;
    height: 70px;
  }

  .nav-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 700;
    font-size: 20px;
    color: #333;
  }

  .brand-icon {
    font-size: 28px;
  }

  .nav-links {
    display: flex;
    gap: 10px;
    flex: 1;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 8px;
    text-decoration: none;
    color: #666;
    font-weight: 500;
    transition: all 0.2s;
  }

  .nav-link:hover {
    background: #f5f5f5;
    color: #333;
  }

  .nav-link.active {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
  }

  .link-icon {
    font-size: 18px;
  }

  .nav-status {
    margin-left: auto;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: #f5f5f5;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 500;
  }

  .status-indicator.connected {
    background: #e8f5e9;
    color: #2e7d32;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f44336;
    animation: pulse 2s infinite;
  }

  .status-indicator.connected .status-dot {
    background: #4CAF50;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Основной контент */
  .main-content {
    flex: 1;
    padding: 20px;
  }

  /* Футер */
  .footer {
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 20px;
    margin-top: auto;
  }

  .footer-content {
    max-width: 1600px;
    margin: 0 auto;
    text-align: center;
  }

  .footer-content p {
    margin: 0;
    font-size: 14px;
    opacity: 0.8;
  }

  /* Адаптивность */
  @media (max-width: 768px) {
    .nav-container {
      flex-wrap: wrap;
      height: auto;
      padding: 15px 20px;
    }

    .nav-brand {
      width: 100%;
      margin-bottom: 10px;
    }

    .nav-links {
      width: 100%;
      order: 3;
    }

    .nav-status {
      margin-left: 0;
      order: 2;
    }

    .brand-text {
      font-size: 18px;
    }

    .link-icon {
      font-size: 16px;
    }
  }
</style>