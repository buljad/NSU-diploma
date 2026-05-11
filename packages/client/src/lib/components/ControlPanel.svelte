<!-- packages/client/src/lib/components/ControlPanel.svelte -->
<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { stabilogramStore } from '../stores/stabilogram';
	import { gameStateStore, currentStage } from '../stores/gameState';
	import {
		STAGE_MENU,
		STAGE_RESULTS,
		DIFF_EASY,
		DIFF_MEDIUM,
		DIFF_HARD,
		type DifficultyPreset
	} from '../game/types';

	import { DIFFICULTY_PRESETS } from '../game/constants';
	import { wsClient } from '../websocket/client';

	export let gameMode = false;

	const dispatch = createEventDispatcher();

	// Состояние подключения
	$: wsConnected = $stabilogramStore.isWsConnected;
	$: deviceConnected = $stabilogramStore.isDeviceConnected;
	$: calibrated = $stabilogramStore.isCalibrated;

	// Игровое состояние
	$: stage = $currentStage;
	$: gameSnapshot = $gameStateStore;

	// Игровые настройки
	let selectedDifficulty = DIFF_MEDIUM;

	// Порты и подключение
	let availablePorts: Array<{ path: string; manufacturer?: string }> = [];
	let selectedPort = '';
	let selectedBaudRate = 115200;
	let testMode = false;

	// Калибровка
	let isCalibrating = false;
	let calibrationProgress = 0;
	let calibrationTotal = 0;

	// Конфигурация осей
	let axisConfig = {
		swapXY: false,
		invertX: false,
		invertY: false,
		rotationDeg: 0
	};

	// ✅ ИСПРАВЛЕНИЕ: Храним функции отписки
	let unsubscribePortsList: (() => void) | null = null;
	let unsubscribeCalibrationStarted: (() => void) | null = null;
	let unsubscribeCalibrationProgress: (() => void) | null = null;
	let unsubscribeCalibrationComplete: (() => void) | null = null;

	// ════════════════════════════════════════════════
	// WebSocket Events (регистрируем в onMount)
	// ════════════════════════════════════════════════

	onMount(() => {
		console.log('🎛️ ControlPanel mounted, registering event handlers...');

		// ✅ РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ С СОХРАНЕНИЕМ ФУНКЦИЙ ОТПИСКИ
		unsubscribePortsList = wsClient.on('PORTS_LIST', (data: any) => {
			console.log('📡 Received PORTS_LIST:', data);
			availablePorts = data.ports || [];

			// Автоматически выбираем первый порт, если ничего не выбрано
			if (availablePorts.length > 0 && !selectedPort) {
				selectedPort = availablePorts[0].path;
				console.log('✅ Auto-selected port:', selectedPort);
			}
		});

		unsubscribeCalibrationStarted = wsClient.on('CALIBRATION_STARTED', () => {
			console.log('📏 Calibration started');
			isCalibrating = true;
			calibrationProgress = 0;
			calibrationTotal = 200;
		});

		unsubscribeCalibrationProgress = wsClient.on('CALIBRATION_PROGRESS', (data: any) => {
			calibrationProgress = data.progress || 0;
			calibrationTotal = data.total || 200;
		});

		unsubscribeCalibrationComplete = wsClient.on('CALIBRATION_COMPLETE', () => {
			console.log('✅ Calibration complete');
			isCalibrating = false;
			calibrationProgress = 0;
		});

		// ✅ ЗАПРАШИВАЕМ ПОРТЫ С ЗАДЕРЖКОЙ (даем время WebSocket подключиться)
		const wsReadyInterval = setInterval(() => {
			if (wsClient.getConnectionState()) {
				console.log('🔌 WebSocket ready, requesting ports...');
				refreshPorts();
				clearInterval(wsReadyInterval);
			} else {
				console.log('⏳ Waiting for WebSocket connection...');
			}
		}, 100);

		// Очищаем интервал через 5 секунд (защита от зависания)
		setTimeout(() => {
			clearInterval(wsReadyInterval);
			if (!wsClient.getConnectionState()) {
				console.error('❌ WebSocket not connected after 5 seconds');
			}
		}, 5000);
	});

	onDestroy(() => {
		console.log('🎛️ ControlPanel destroying, cleaning up event handlers...');

		// ✅ ОЧИСТКА ОБРАБОТЧИКОВ
		if (unsubscribePortsList) unsubscribePortsList();
		if (unsubscribeCalibrationStarted) unsubscribeCalibrationStarted();
		if (unsubscribeCalibrationProgress) unsubscribeCalibrationProgress();
		if (unsubscribeCalibrationComplete) unsubscribeCalibrationComplete();
	});

	// ════════════════════════════════════════════════
	// Actions
	// ════════════════════════════════════════════════

	function refreshPorts() {
		console.log('🔄 Refreshing ports...');
		wsClient.listPorts();
	}

	function connectDevice() {
		if (!selectedPort) {
			console.warn('⚠️ No port selected');
			return;
		}
		console.log('🔌 Connecting to:', selectedPort, 'at', selectedBaudRate);
		wsClient.connectDevice(selectedPort, selectedBaudRate, testMode);
	}

	function disconnectDevice() {
		console.log('🔌 Disconnecting device...');
		wsClient.disconnectDevice();
	}

	function startCalibration() {
		console.log('📏 Starting calibration...');
		wsClient.calibrateZero();
	}

	function updateAxisConfig() {
		console.log('🔧 Updating axis config:', axisConfig);
		wsClient.configureAxes(axisConfig);
	}

	// Игровые действия
	function startGame() {
		if (!deviceConnected) {
			alert('Сначала подключите стабилометр!');
			return;
		}

		console.log('🚀 Starting game from ControlPanel with difficulty:', selectedDifficulty);

		window.dispatchEvent(
			new CustomEvent('gameStart', {
				detail: { difficulty: selectedDifficulty }
			})
		);
	}

	function pauseGame() {
		console.log('⏸️ Pausing game from ControlPanel');
		window.dispatchEvent(new CustomEvent('gamePause'));
	}

	function restartGame() {
		console.log('🔄 Restarting game from ControlPanel');
		window.dispatchEvent(new CustomEvent('gameRestart'));
	}

	function stopGame() {
		console.log('🛑 Stopping game from ControlPanel');
		window.dispatchEvent(new CustomEvent('gameStop'));
	}

	// Медицинские действия
	function handleExport() {
		dispatch('export');
	}

	function handleStartRecording() {
		dispatch('startRecording');
	}

	function handleStopRecording() {
		dispatch('stopRecording');
	}
</script>

<div class="control-panel">
	<!-- ════════════════════════════════════════════════ -->
	<!-- СТАТУС ПОДКЛЮЧЕНИЯ -->
	<!-- ════════════════════════════════════════════════ -->

	<div class="section">
		<h3>🔌 Подключение</h3>

		<div class="status-grid">
			<div class="status-item" class:connected={wsConnected}>
				<span class="status-dot"></span>
				WebSocket {wsConnected ? 'подключен' : 'отключен'}
			</div>

			<div class="status-item" class:connected={deviceConnected}>
				<span class="status-dot"></span>
				Устройство {deviceConnected ? 'подключено' : 'отключено'}
			</div>

			<div class="status-item" class:connected={calibrated}>
				<span class="status-dot"></span>
				Калибровка {calibrated ? 'выполнена' : 'требуется'}
			</div>
		</div>
	</div>

	<!-- ════════════════════════════════════════════════ -->
	<!-- УСТРОЙСТВО -->
	<!-- ════════════════════════════════════════════════ -->

	<div class="section">
		<h3>⚙️ Устройство</h3>

		{#if !deviceConnected}
			<div class="form-group">
				<label for="port-select">Порт:</label>
				<div class="port-row">
					<!-- ✅ ИСПРАВЛЕНИЕ: Убрали лишний disabled -->
					<select id="port-select" bind:value={selectedPort}>
						{#if availablePorts.length === 0}
							<option value="" disabled>Нет доступных портов</option>
						{:else}
							{#each availablePorts as port}
								<option value={port.path}>
									{port.path}
									{port.manufacturer ? `(${port.manufacturer})` : ''}
								</option>
							{/each}
						{/if}
					</select>
					<button class="btn-icon" on:click={refreshPorts} title="Обновить список портов">
						🔄
					</button>
				</div>
			</div>

			<div class="form-row">
				<div class="form-group">
					<label for="baud-select">Скорость:</label>
					<select id="baud-select" bind:value={selectedBaudRate}>
						<option value={9600}>9600</option>
						<option value={115200}>115200</option>
						<option value={230400}>230400</option>
					</select>
				</div>

				<div class="form-group">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={testMode} />
						Тестовый режим
					</label>
				</div>
			</div>

			<button
				class="btn primary full-width"
				on:click={connectDevice}
				disabled={!selectedPort || !wsConnected}
			>
				Подключить
			</button>

			<!-- ✅ НОВОЕ: Подсказка если порты не загрузились -->
			{#if availablePorts.length === 0 && wsConnected}
				<p class="warning-text">⚠️ Порты не найдены. Нажмите 🔄 для обновления</p>
			{/if}
		{:else}
			<div class="connected-info">
				<p>✅ Подключено к: <strong>{selectedPort}</strong></p>
				<button class="btn secondary full-width" on:click={disconnectDevice}> Отключить </button>
			</div>
		{/if}
	</div>

	<!-- Остальной код без изменений -->

	<!-- ════════════════════════════════════════════════ -->
	<!-- КАЛИБРОВКА -->
	<!-- ════════════════════════════════════════════════ -->

	<div class="section">
		<h3>📏 Калибровка</h3>

		{#if isCalibrating}
			<div class="progress-container">
				<div class="progress-bar">
					<div
						class="progress-fill"
						style="width: {(calibrationProgress / calibrationTotal) * 100}%"
					></div>
				</div>
				<p class="progress-text">
					{calibrationProgress} / {calibrationTotal}
				</p>
			</div>
		{:else}
			<button
				class="btn primary full-width"
				on:click={startCalibration}
				disabled={!deviceConnected || isCalibrating}
			>
				Калибровка нуля
			</button>

			{#if !calibrated}
				<p class="warning-text">⚠️ Требуется калибровка перед использованием</p>
			{/if}
		{/if}
	</div>

	<!-- ════════════════════════════════════════════════ -->
	<!-- ИГРОВОЙ РЕЖИМ -->
	<!-- ════════════════════════════════════════════════ -->

	{#if gameMode}
		<div class="section game-section">
			<h3>🎮 Управление игрой</h3>

			{#if !gameSnapshot.isRunning}
				<div class="game-menu">
					<div class="form-group">
						<label for="difficulty-select">Сложность:</label>
						<select id="difficulty-select" bind:value={selectedDifficulty}>
							<option value={DIFF_EASY}>{DIFFICULTY_PRESETS[DIFF_EASY].label}</option>
							<option value={DIFF_MEDIUM}>{DIFFICULTY_PRESETS[DIFF_MEDIUM].label}</option>
							<option value={DIFF_HARD}>{DIFFICULTY_PRESETS[DIFF_HARD].label}</option>
						</select>
					</div>

					<button
						class="btn game-btn full-width"
						on:click={startGame}
						disabled={!deviceConnected || !calibrated}
					>
						🚀 Начать игру
					</button>

					{#if !deviceConnected}
						<p class="warning-text">⚠️ Подключите стабилометр</p>
					{:else if !calibrated}
						<p class="warning-text">⚠️ Выполните калибровку</p>
					{/if}
				</div>
			{:else}
				<div class="game-active">
					<div class="game-stats">
						<div class="stat-item">
							<span class="stat-label">Счёт:</span>
							<span class="stat-value">{gameSnapshot.score}</span>
						</div>

						{#if gameSnapshot.streak > 0}
							<div class="stat-item">
								<span class="stat-label">Серия:</span>
								<span class="stat-value">{gameSnapshot.streak}</span>
							</div>
						{/if}

						<div class="stat-item">
							<span class="stat-label">Поймано:</span>
							<span class="stat-value">{gameSnapshot.catchCount}</span>
						</div>

						{#if gameSnapshot.stageTimeRemaining > 0}
							<div class="stat-item">
								<span class="stat-label">Время:</span>
								<span class="stat-value">{gameSnapshot.stageTimeRemaining.toFixed(0)}с</span>
							</div>
						{/if}
					</div>

					<div class="game-controls">
						<button class="btn secondary" on:click={pauseGame}>
							{gameSnapshot.isPaused ? '▶️ Продолжить' : '⏸️ Пауза'}
						</button>

						<button class="btn secondary" on:click={restartGame}> 🔄 Заново </button>

						<button class="btn danger full-width" on:click={stopGame}> 🛑 Выйти в меню </button>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="section">
			<h3>📊 Управление</h3>

			<div class="button-group">
				<button
					class="btn primary"
					on:click={handleStartRecording}
					disabled={!deviceConnected || !calibrated}
				>
					⏺️ Запись
				</button>

				<button class="btn secondary" on:click={handleStopRecording}> ⏹️ Стоп </button>
			</div>

			<button class="btn secondary full-width" on:click={handleExport} disabled={!deviceConnected}>
				💾 Экспорт данных
			</button>
		</div>
	{/if}

	{#if !gameMode}
		<div class="section">
			<h3>🔧 Настройки осей</h3>

			<div class="axis-controls">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={axisConfig.swapXY} on:change={updateAxisConfig} />
					Поменять оси X↔Y
				</label>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={axisConfig.invertX} on:change={updateAxisConfig} />
					Инвертировать X
				</label>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={axisConfig.invertY} on:change={updateAxisConfig} />
					Инвертировать Y
				</label>

				<div class="rotation-control">
					<label for="rotation">Поворот:</label>
					<input
						type="range"
						id="rotation"
						min="0"
						max="360"
						step="15"
						bind:value={axisConfig.rotationDeg}
						on:input={updateAxisConfig}
					/>
					<span>{axisConfig.rotationDeg}°</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.control-panel {
		background: white;
		border-radius: 12px;
		padding: 24px; /* ✅ УВЕЛИЧИЛИ PADDING */
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		border: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-height: calc(100vh - 140px);
		overflow-y: auto;
		min-width: 340px; /* ✅ ДОБАВИЛИ МИНИМАЛЬНУЮ ШИРИНУ */
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* ✅ НОВЫЙ СТИЛЬ для игровой секции */
	.game-section {
		background: #f8fafc;
		border: 2px solid #3b82f6;
		border-radius: 8px;
		padding: 16px;
	}

	.section h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: #111827;
		border-bottom: 2px solid #f3f4f6;
		padding-bottom: 8px;
	}

	.game-section h3 {
		color: #1d4ed8;
		border-bottom-color: #dbeafe;
	}

	.status-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.status-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: #6b7280;
	}

	.status-item.connected {
		color: #059669;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #dc2626;
		flex-shrink: 0;
	}

	.status-item.connected .status-dot {
		background: #059669;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px; /* ✅ УВЕЛИЧИЛИ GAP */
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: end;
	}

	.port-row {
		display: flex;
		gap: 8px;
	}

	.port-row select {
		flex: 1;
	}

	label {
		font-size: 13px;
		font-weight: 500;
		color: #374151;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		cursor: pointer;
		font-size: 13px;
		gap: 8px; /* ✅ ДОБАВИЛИ GAP */
	}

	select,
	input[type='range'] {
		padding: 10px 12px; /* ✅ УВЕЛИЧИЛИ PADDING */
		border: 2px solid #e5e7eb;
		border-radius: 6px;
		font-size: 14px;
		background: white;
		color: #111827;
		min-width: 0; /* ✅ ДОБАВИЛИ для правильного отображения */
	}

	select:focus,
	input[type='range']:focus {
		outline: none;
		border-color: #3b82f6;
	}

	input[type='checkbox'] {
		margin: 0; /* ✅ УБРАЛИ MARGIN */
		width: 16px;
		height: 16px;
	}

	.btn {
		padding: 12px 16px; /* ✅ УВЕЛИЧИЛИ PADDING */
		border: none;
		border-radius: 6px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		white-space: nowrap; /* ✅ ДОБАВИЛИ */
	}

	.btn:hover:not(:disabled) {
		transform: translateY(-1px);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.btn.primary {
		background: #3b82f6;
		color: white;
	}

	.btn.primary:hover:not(:disabled) {
		background: #2563eb;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
	}

	.btn.secondary {
		background: #6b7280;
		color: white;
	}

	.btn.secondary:hover:not(:disabled) {
		background: #4b5563;
	}

	.btn.game-btn {
		background: #059669;
		color: white;
		font-size: 16px; /* ✅ УВЕЛИЧИЛИ РАЗМЕР */
		padding: 14px 20px; /* ✅ УВЕЛИЧИЛИ PADDING */
	}

	.btn.game-btn:hover:not(:disabled) {
		background: #047857;
		box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);
	}

	.btn.danger {
		background: #dc2626;
		color: white;
	}

	.btn.danger:hover:not(:disabled) {
		background: #b91c1c;
	}

	.btn-icon {
		padding: 10px;
		background: #f3f4f6;
		border: 2px solid #e5e7eb;
		border-radius: 6px;
		cursor: pointer;
		font-size: 12px;
		flex-shrink: 0;
	}

	.btn-icon:hover:not(:disabled) {
		background: #e5e7eb;
	}

	.full-width {
		width: 100%;
	}

	.button-group {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.progress-container {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.progress-bar {
		height: 8px;
		background: #f3f4f6;
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #3b82f6;
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 12px;
		color: #6b7280;
		text-align: center;
		margin: 0;
	}

	.game-stats {
		display: flex;
		flex-direction: column;
		gap: 10px; /* ✅ УВЕЛИЧИЛИ GAP */
		padding: 14px; /* ✅ УВЕЛИЧИЛИ PADDING */
		background: white;
		border-radius: 8px;
		margin-bottom: 12px;
	}

	.stat-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-label {
		font-size: 13px;
		color: #6b7280;
	}

	.stat-value {
		font-size: 15px; /* ✅ УВЕЛИЧИЛИ РАЗМЕР */
		font-weight: 600;
		color: #111827;
	}

	.game-controls {
		display: flex;
		flex-direction: column;
		gap: 10px; /* ✅ УВЕЛИЧИЛИ GAP */
	}

	.axis-controls {
		display: flex;
		flex-direction: column;
		gap: 10px; /* ✅ УВЕЛИЧИЛИ GAP */
	}

	.rotation-control {
		display: flex;
		align-items: center;
		gap: 10px; /* ✅ УВЕЛИЧИЛИ GAP */
		font-size: 13px;
	}

	.rotation-control input[type='range'] {
		flex: 1;
		padding: 4px;
	}

	.rotation-control span {
		min-width: 40px; /* ✅ УВЕЛИЧИЛИ */
		text-align: right;
		font-weight: 500;
	}

	.warning-text {
		font-size: 12px;
		color: #dc2626;
		margin: 8px 0 0 0;
		text-align: center;
		padding: 10px; /* ✅ УВЕЛИЧИЛИ PADDING */
		background: #fef2f2;
		border-radius: 6px;
		border: 1px solid #fecaca;
	}

	.connected-info {
		padding: 14px; /* ✅ УВЕЛИЧИЛИ PADDING */
		background: #f0fdf4;
		border-radius: 8px;
		text-align: center;
		border: 1px solid #bbf7d0;
	}

	.connected-info p {
		margin: 0 0 12px 0;
		font-size: 14px;
		color: #166534;
	}
</style>
