<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import StabilogramCanvas from '$lib/components/StabilogramCanvas.svelte';
	import { wsClient } from '$lib/websocket/client';
	import { stabilogramStore } from '$lib/stores/stabilogram';

	// Инициализируем связь (Dependency Injection)
	wsClient.setStore(stabilogramStore);

	interface LocalPortInfo {
		path: string;
		manufacturer?: string;
	}

	let ports: LocalPortInfo[] = [];
	let selectedPort = '';
	let testMode = true;
	let showDebug = true;

	// Реактивные переменные из стора
	$: isWsConnected = $stabilogramStore.isWsConnected;
	$: isDeviceConnected = $stabilogramStore.isDeviceConnected;
	$: isCalibrated = $stabilogramStore.isCalibrated;

	onMount(() => {
		const unsubPorts = wsClient.on('PORTS_LIST', (data: any) => {
			// ИСПРАВЛЕНИЕ: data - это уже массив, а не объект { ports: [...] }
			console.log('Received ports:', data);
			ports = Array.isArray(data) ? data : data?.ports || [];

			if (ports.length > 0 && !selectedPort) {
				selectedPort = ports[0].path;
			}
		});

		try {
			wsClient.connect().then(() => {
				wsClient.requestPorts();
			});
		} catch (error) {
			console.error('Failed to connect:', error);
		}

		return () => {
			unsubPorts();
			wsClient.disconnect();
		};
	});
	
	// Остальной код (функции connectDevice, calibrate и т.д.) без изменений...
	function connectDevice() {
		if (testMode) {
			wsClient.connectToPort('', 115200, true);
		} else if (selectedPort) {
			wsClient.connectToPort(selectedPort);
		}
	}

	function disconnectDevice() {
		wsClient.disconnectFromPort();
	}

	function calibrate() {
		wsClient.calibrateZero();
	}

	function refreshPorts() {
		wsClient.requestPorts();
	}
</script>

<!-- Разметка HTML остается прежней -->
<svelte:head>
	<title>Стабилометр</title>
</svelte:head>

<main>
	<header>
		<h1>🎯 Медицинский стабилометр</h1>
	</header>

	<div class="content">
		<aside class="controls">
			<div class="ws-status" class:connected={isWsConnected}>
				Сервер: {isWsConnected ? 'OK' : 'Нет связи'}
			</div>

			<section>
				<h2>Подключение</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={testMode} disabled={isDeviceConnected} />
					Тестовый режим
				</label>

				{#if !testMode}
					<div class="form-group">
						<label for="port">COM-порт</label>
						<div class="port-row">
							<select id="port" bind:value={selectedPort} disabled={isDeviceConnected}>
								{#each ports as port}
									<option value={port.path}>
										{port.path}
										{port.manufacturer ? `(${port.manufacturer})` : ''}
									</option>
								{/each}
							</select>
							<button class="btn-icon" on:click={refreshPorts} disabled={isDeviceConnected}
								>🔄</button
							>
						</div>
					</div>
				{/if}

				<div class="buttons">
					{#if !isDeviceConnected}
						<button class="btn primary" on:click={connectDevice} disabled={!isWsConnected}>
							Подключить
						</button>
					{:else}
						<button class="btn danger" on:click={disconnectDevice}> Отключить </button>
					{/if}
				</div>
			</section>

			<section>
				<h2>Калибровка</h2>
				<p class="hint">Встаньте в центр платформы</p>
				<button class="btn secondary" on:click={calibrate} disabled={!isDeviceConnected}>
					Калибровать ноль
				</button>

				{#if isCalibrated}
					<p class="status ok">✅ Откалибровано</p>
				{:else}
					<p class="status warn">⚠️ Требуется калибровка</p>
				{/if}
			</section>

			<section>
				<h2>Настройки</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={showDebug} />
					Показывать отладку
				</label>
			</section>
		</aside>

		<div class="visualization">
			<StabilogramCanvas width={800} height={600} {showDebug} />
		</div>
	</div>
</main>

<style>
	/* Стили остаются прежними */
	:global(body) {
		margin: 0;
		background: #0a0a0f;
		color: #fff;
		font-family: sans-serif;
	}
	main {
		min-height: 100vh;
		padding: 20px;
	}
	header {
		text-align: center;
		margin-bottom: 30px;
	}
	h1 {
		font-size: 2rem;
		background: linear-gradient(135deg, #4a9eff, #6366f1);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.content {
		display: flex;
		gap: 30px;
		max-width: 1200px;
		margin: 0 auto;
	}
	.controls {
		width: 280px;
		flex-shrink: 0;
	}
	section {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 20px;
	}
	h2 {
		font-size: 0.9rem;
		margin: 0 0 15px;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.form-group {
		margin-bottom: 15px;
	}
	.form-group label {
		display: block;
		margin-bottom: 5px;
		color: #aaa;
		font-size: 0.9rem;
	}
	select {
		width: 100%;
		padding: 10px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		color: #fff;
	}
	.port-row {
		display: flex;
		gap: 8px;
	}
	.port-row select {
		flex: 1;
	}
	.btn-icon {
		padding: 10px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		cursor: pointer;
	}
	.btn-icon:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.buttons {
		display: flex;
		gap: 10px;
	}
	.btn {
		flex: 1;
		padding: 12px 20px;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-size: 1rem;
		transition: all 0.2s;
	}
	.btn.primary {
		background: linear-gradient(135deg, #4a9eff, #6366f1);
		color: white;
	}
	.btn.primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 5px 20px rgba(74, 158, 255, 0.4);
	}
	.btn.secondary {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}
	.btn.secondary:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.btn.danger {
		background: #e74c3c;
		color: white;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 15px;
		cursor: pointer;
	}
	.hint {
		font-size: 0.85rem;
		color: #666;
		margin-bottom: 10px;
	}
	.status {
		font-size: 0.9rem;
		margin-top: 10px;
	}
	.status.ok {
		color: #2ecc71;
	}
	.status.warn {
		color: #f39c12;
	}
	.visualization {
		flex: 1;
		display: flex;
		justify-content: center;
	}
	.ws-status {
		margin-bottom: 10px;
		padding: 8px;
		border-radius: 8px;
		background: #e74c3c;
		text-align: center;
		font-size: 0.8rem;
	}
	.ws-status.connected {
		background: #2ecc71;
	}
</style>
