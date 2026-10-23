<!-- packages/client/src/lib/components/BallCatcherCanvas.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { stabilogramStore } from '../stores/stabilogram';
	import { gameStateStore, currentStage, isGameActive } from '../stores/gameState';
	import { BallCatcherGame } from '../game/BallCatcherGame';
	import type { Vector2D } from '@stabilometer/shared';
	import {
		STAGE_MENU,
		STAGE_RESULTS,
		STAGE_PAUSED,
		DIFF_EASY,
		DIFF_MEDIUM,
		DIFF_HARD
	} from '../game/types';
	import {
		GAME_BG_COLOR,
		BALL_FILL_COLORS,
		BALL_STROKE_COLORS,
		BALL_GLOW_COLORS,
		BALL_SYMBOLS,
		BASKET_FILL_COLOR,
		BASKET_STROKE_COLOR,
		BASKET_WOBBLE_FILL_COLOR,
		BASKET_WOBBLE_STROKE_COLOR,
		BASKET_CORNER_RADIUS,
		BASKET_STROKE_WIDTH,
		DWELL_RING_FILL,
		DWELL_RING_BG,
		DWELL_RING_WIDTH,
		DWELL_RING_GAP,
		HUD_FONT,
		TARGET_HINT_FONT,
		SCORE_FLOAT_FONT,
		BALL_SYMBOL_FONT,
		SCORE_TEXT_COLORS,
		COMFORT_ZONE_VISUAL_RADIUS,
		COMFORT_ZONE_COLOR,
		COMFORT_ZONE_ACTIVE_COLOR,
		COLOR_CHANGE_FLASH_MS,
		COLOR_CHANGE_FLASH_COLOR,
		WOBBLE_CATCH_BLOCK_THRESHOLD,
		DIFFICULTY_PRESETS
	} from '../game/constants';
	import {
		BALL_STATE_INACTIVE,
		BALL_STATE_FALLING,
		BALL_STATE_DWELLING,
		BALL_STATE_CAUGHT,
		BALL_STATE_MISSED
	} from '../game/types';

	// ════════════════════════════════════════════════
	// Props
	// ════════════════════════════════════════════════

	export let width = 1000;
	export let height = 750;
	export let showDebug = false;
	export let hideGameControls = false;

	// ════════════════════════════════════════════════
	// Canvas & Game
	// ════════════════════════════════════════════════

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let game: BallCatcherGame;
	let animationId: number;
	let isInitialized = false;

	// ════════════════════════════════════════════════
	// Render state (предаллокация для zero-GC)
	// ════════════════════════════════════════════════

	const tempPos: Vector2D = { x: 0, y: 0 };
	const tempVel: Vector2D = { x: 0, y: 0 };

	// ════════════════════════════════════════════════
	// UI state
	// ════════════════════════════════════════════════

	let selectedDifficulty = DIFF_MEDIUM;
	let lastSnapshotUpdate = 0;
	let completionEmitted = false;
	let controlMessage = '';
	const comfortZoneDash = [8, 6];

	// ════════════════════════════════════════════════
	// Event handlers (типизированные)
	// ════════════════════════════════════════════════

	function handleGameStart(event: Event): void {
		const customEvent = event as CustomEvent<{ difficulty: number }>;
		selectedDifficulty = customEvent.detail.difficulty;
		startGame();
	}

	function handleGamePause(event: Event): void {
		pauseGame();
	}

	function handleGameRestart(event: Event): void {
		restartGame();
	}

	function handleGameStop(event: Event): void {
		stopGame();
	}

	// Reactive subscriptions
	$: stabilogramState = $stabilogramStore;
	$: stage = $currentStage;
	$: gameActive = $isGameActive;

	// ════════════════════════════════════════════════
	// Lifecycle
	// ════════════════════════════════════════════════

	onMount(() => {
		initializeGame();

		// ✅ ИСПРАВЛЕНИЕ: Правильная типизация event listeners
		window.addEventListener('gameStart', handleGameStart as EventListener);
		window.addEventListener('gamePause', handleGamePause as EventListener);
		window.addEventListener('gameRestart', handleGameRestart as EventListener);
		window.addEventListener('gameStop', handleGameStop as EventListener);
	});

	onDestroy(() => {
		cleanup();

		// ✅ ИСПРАВЛЕНИЕ: Удаляем слушатели с правильной типизацией
		window.removeEventListener('gameStart', handleGameStart as EventListener);
		window.removeEventListener('gamePause', handleGamePause as EventListener);
		window.removeEventListener('gameRestart', handleGameRestart as EventListener);
		window.removeEventListener('gameStop', handleGameStop as EventListener);
	});

	// ✅ Отдельная функция инициализации
	function initializeGame(): void {
		if (isInitialized) return;

		ctx = canvas.getContext('2d')!;
		game = new BallCatcherGame(width, height);

		// 🔧 ВАЖНО: Инициализируем store только если не был инициализирован для игрового режима
		if (!stabilogramStore.isGameModeInitialized) {
			stabilogramStore.initializeGameMode({ x: width, y: height });
		}

		// 🔧 Принудительно устанавливаем состояние MENU
		gameStateStore.reset();
		gameStateStore.updateSnapshot({
			...game.getSnapshot(),
			stage: STAGE_MENU,
			isRunning: false,
			isPaused: false
		});

		isInitialized = true;
		startRenderLoop();
	}

	function cleanup(): void {
		if (animationId) {
			cancelAnimationFrame(animationId);
		}
		if (game) {
			game.stop();
		}
		// 🔧 Сбрасываем флаг инициализации игрового режима
		if (stabilogramStore.resetGameMode) {
			stabilogramStore.resetGameMode();
		}
		isInitialized = false;
	}

	// ════════════════════════════════════════════════
	// Render Loop (ZERO-GC)
	// ════════════════════════════════════════════════

	function startRenderLoop(): void {
		function render(now: number): void {
			if (!isInitialized) return;

			updateGame(now);
			drawFrame(now);
			updateGameStateStore(now);
			animationId = requestAnimationFrame(render);
		}
		animationId = requestAnimationFrame(render);
	}

	/**
	 * Обновить игровую логику (ZERO-GC: только чтение/мутация полей).
	 */
	function updateGame(now: number): void {
		if (!game) return;

		game.updateTransportState(
			stabilogramState.isWsConnected && stabilogramState.isDeviceConnected,
			stabilogramStore.isStreamFresh(now),
			now
		);

		// ✅ Получаем позицию только если игра запущена
		if (game.isRunning && !game.isPaused) {
			const renderPos = stabilogramStore.getRenderPosition();
			const renderVel = stabilogramStore.getRenderVelocity();

			tempPos.x = renderPos.x;
			tempPos.y = renderPos.y;
			tempVel.x = renderVel.x;
			tempVel.y = renderVel.y;

			game.update(tempPos.x, tempPos.y, tempVel.x, tempVel.y, now);
		}
	}

	/**
	 * Отрисовка кадра (ZERO-GC: только чтение массивов, мутация Canvas state).
	 */
	function drawFrame(now: number): void {
		if (!ctx || !game) return;

		// Очистка
		ctx.fillStyle = GAME_BG_COLOR;
		ctx.fillRect(0, 0, width, height);

		// ✅ Всегда рисуем что-то, никогда не оставляем черный экран
		if (game.stageManager.currentStage === STAGE_RESULTS) {
			drawResults();
			return;
		}
		if (!game.isRunning) {
			drawMenu();
			return;
		}

		// ✅ Показываем базовый UI даже если игра на паузе
		if (game.isPaused) {
			drawPausedState();
			return;
		}

		// ═══ Основной игровой рендеринг ═══
		drawComfortZone(now);
		drawBalls(now);
		drawBasket(now);
		drawFloatingTexts(now);
		drawHUD();
		drawColorChangeFlash(now);

		if (showDebug) {
			drawDebugInfo();
		}
	}

	// ✅ Состояние паузы
	function drawPausedState(): void {
		// Затемнение
		ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
		ctx.fillRect(0, 0, width, height);

		// Текст паузы
		ctx.font = 'bold 48px sans-serif';
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('ПАУЗА', width * 0.5, height * 0.4);

		ctx.font = '24px sans-serif';
		ctx.fillStyle = '#cccccc';
		ctx.fillText(
			game.pauseReason === 'manual'
				? 'Нажмите «Продолжить», когда будете готовы'
				: 'Ожидание свежих данных от платформы',
			width * 0.5,
			height * 0.55
		);

		if (showDebug) {
			ctx.font = '16px monospace';
			ctx.fillStyle = '#888';
			ctx.textAlign = 'left';
			ctx.fillText(`WS: ${stabilogramState.isWsConnected}`, 20, height - 60);
			ctx.fillText(`Device: ${stabilogramState.isDeviceConnected}`, 20, height - 40);
		}
	}

	/**
	 * Обновить Svelte store (НЕ в каждом кадре — ~2-4 Гц).
	 */
	function updateGameStateStore(now: number): void {
		const completed = game?.stageManager.currentStage === STAGE_RESULTS && !completionEmitted;
		if (!completed && now - lastSnapshotUpdate < 250) return; // 4 Гц
		lastSnapshotUpdate = now;

		if (game) {
			const snapshot = game.getSnapshot(); // ⚠️ АЛЛОКАЦИЯ (но редко)
			gameStateStore.updateSnapshot(snapshot);
			if (snapshot.stage === STAGE_RESULTS && !completionEmitted) {
				completionEmitted = true;
				window.dispatchEvent(new CustomEvent('gameCompleted', { detail: snapshot }));
			}
		}
	}

	// ════════════════════════════════════════════════
	// Drawing Functions (ZERO-GC)
	// ════════════════════════════════════════════════

	function drawBalls(now: number): void {
		const pool = game.ballPool;
		const balls = pool.balls;
		const cap = pool.capacity;

		for (let i = 0; i < cap; i++) {
			const ball = balls[i];
			if (ball.state === BALL_STATE_INACTIVE) continue;

			drawSingleBall(ball, now);
		}
	}

	function drawSingleBall(ball: any, now: number): void {
		const { x, y, radius, colorIndex, symbolIndex, opacity, state, animProgress } = ball;

		// ── Анимации трансформаций ──
		let drawRadius = radius;
		let alpha = opacity;

		if (state === BALL_STATE_CAUGHT) {
			const t = animProgress;
			drawRadius = radius * (1 + t * 0.5);
			alpha = opacity * (1 - t);
		} else if (state === BALL_STATE_MISSED) {
			const t = animProgress;
			drawRadius = radius * (1 - t * 0.7);
			alpha = opacity * (1 - t);
		}

		if (alpha <= 0.01) return;

		ctx.save();
		ctx.globalAlpha = alpha;

		// ── Glow эффект ──
		if (ball.isTarget && alpha > 0.7) {
			const glowColor = BALL_GLOW_COLORS[colorIndex];
			ctx.shadowColor = glowColor;
			ctx.shadowBlur = 15;
		}

		// ── Основной шар ──
		ctx.fillStyle = BALL_FILL_COLORS[colorIndex];
		ctx.strokeStyle = BALL_STROKE_COLORS[colorIndex];
		ctx.lineWidth = 2;

		ctx.beginPath();
		ctx.arc(x, y, drawRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.shadowBlur = 0;

		// ── Символ ──
		if (symbolIndex >= 0) {
			ctx.fillStyle = '#ffffff';
			ctx.font = BALL_SYMBOL_FONT;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(BALL_SYMBOLS[symbolIndex], x, y);
		}

		// ── Dwell прогресс ──
		if (state === BALL_STATE_DWELLING && ball.dwellProgress > 0) {
			drawDwellRing(x, y, drawRadius, ball.dwellProgress);
		}

		ctx.restore();
	}

	function drawDwellRing(x: number, y: number, ballRadius: number, progress: number): void {
		const ringRadius = ballRadius + DWELL_RING_GAP;
		const startAngle = -Math.PI / 2;
		const progressAngle = startAngle + progress * Math.PI * 2;

		ctx.lineWidth = DWELL_RING_WIDTH;
		ctx.lineCap = 'round';

		ctx.strokeStyle = DWELL_RING_BG;
		ctx.beginPath();
		ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
		ctx.stroke();

		if (progress > 0) {
			ctx.strokeStyle = DWELL_RING_FILL;
			ctx.beginPath();
			ctx.arc(x, y, ringRadius, startAngle, progressAngle);
			ctx.stroke();
		}
	}

	function drawBasket(now: number): void {
		const basket = game.basketController.basket;
		const { wobbleIntensity } = basket;
		const isWobbling = wobbleIntensity >= WOBBLE_CATCH_BLOCK_THRESHOLD;

		const drawX = game.basketController.getDrawX();
		const drawY = game.basketController.getDrawY();

		ctx.save();

		if (isWobbling) {
			ctx.fillStyle = BASKET_WOBBLE_FILL_COLOR;
			ctx.strokeStyle = BASKET_WOBBLE_STROKE_COLOR;
		} else {
			ctx.fillStyle = BASKET_FILL_COLOR;
			ctx.strokeStyle = BASKET_STROKE_COLOR;
		}

		ctx.lineWidth = BASKET_STROKE_WIDTH;

		const halfW = basket.width * 0.5;
		const halfH = basket.height * 0.5;
		const left = drawX - halfW;
		const top = drawY - halfH;

		ctx.beginPath();
		ctx.roundRect(left, top, basket.width, basket.height, BASKET_CORNER_RADIUS);
		ctx.fill();
		ctx.stroke();

		ctx.restore();
	}

	function drawComfortZone(now: number): void {
		const centerX = width * 0.5;
		const centerY = height * 0.5;

		const scoreManager = game.scoreManager;
		const isActive = scoreManager.isInComfortZone;
		const progress = Math.min(scoreManager.comfortZoneTime / 10, 1);

		const color = isActive && progress > 0.5 ? COMFORT_ZONE_ACTIVE_COLOR : COMFORT_ZONE_COLOR;

		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.setLineDash(comfortZoneDash);

		ctx.beginPath();
		ctx.arc(centerX, centerY, COMFORT_ZONE_VISUAL_RADIUS, 0, Math.PI * 2);
		ctx.stroke();

		ctx.restore();
	}

	function drawFloatingTexts(now: number): void {
		const texts = game.scoreManager.texts;
		const cap = game.scoreManager.textCapacity;

		ctx.font = SCORE_FLOAT_FONT;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		for (let i = 0; i < cap; i++) {
			const text = texts[i];
			if (!text.active) continue;

			const opacity = game.scoreManager.getTextOpacity(text);
			const scale = game.scoreManager.getTextScale(text);
			const color = SCORE_TEXT_COLORS[text.colorIndex];

			if (opacity <= 0.01) continue;

			ctx.save();
			ctx.globalAlpha = opacity;

			if (scale !== 1) {
				ctx.translate(text.x, text.y);
				ctx.scale(scale, scale);
				ctx.translate(-text.x, -text.y);
			}

			ctx.fillStyle = color;
			ctx.fillText(text.text, text.x, text.y);

			ctx.restore();
		}
	}

	function drawHUD(): void {
		const score = game.scoreManager;
		const stageManager = game.stageManager;

		// ✅ ОСНОВНАЯ ИНФОРМАЦИЯ
		ctx.font = HUD_FONT;
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'left';

		const hudLeft = 20;
		let hudY = 30;
		const lineHeight = 28;

		ctx.fillText(`Счёт: ${score.score}`, hudLeft, hudY);
		hudY += lineHeight;

		if (score.streak > 0) {
			ctx.fillText(`Серия: ${score.streak}`, hudLeft, hudY);
			hudY += lineHeight;
		}

		ctx.fillText(`Поймано: ${score.catchCount}`, hudLeft, hudY);
		hudY += lineHeight;

		if (stageManager.getTimeRemainingSec() > 0) {
			ctx.fillText(`Время: ${stageManager.getTimeRemainingSec().toFixed(0)}с`, hudLeft, hudY);
			hudY += lineHeight;
		}

		// ✅ ИНСТРУКЦИЯ ПО ИГРЕ
		const hintY = height - 80;
		ctx.font = TARGET_HINT_FONT;
		ctx.fillStyle = '#FFE66D';
		ctx.textAlign = 'center';

		if (game.stageManager.config.useSymbols) {
			ctx.fillText('Лови звёзды ★', width * 0.5, hintY);
		} else {
			ctx.fillText(`Лови ${stageManager.getTargetColorName()}!`, width * 0.5, hintY);
		}

		// ✅ ПОДСКАЗКА МЕХАНИКИ
		ctx.font = '16px sans-serif';
		ctx.fillStyle = '#88c999';
		ctx.fillText(
			`Удерживайте корзинку на шаре ${(stageManager.effectiveDwellTimeMs / 1000).toFixed(1)} с`,
			width * 0.5,
			hintY + 30
		);

		// ✅ СТАТУС ПАУЗЫ
		if (game.isPaused) {
			ctx.font = 'bold 32px sans-serif';
			ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			// Затемнение для паузы
			ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.fillRect(0, 0, width, height);

			ctx.fillStyle = '#ffffff';
			ctx.fillText('⏸️ ПАУЗА', width * 0.5, height * 0.5);
		}
	}

	function drawColorChangeFlash(now: number): void {
		const timeSinceChange = game.simulationTime - game.stageManager.lastColorChangeTime;
		if (timeSinceChange > COLOR_CHANGE_FLASH_MS) return;

		const progress = timeSinceChange / COLOR_CHANGE_FLASH_MS;
		const alpha = (1 - progress) * 0.15;

		ctx.save();
		ctx.fillStyle = COLOR_CHANGE_FLASH_COLOR.replace('0.15', alpha.toString());
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
	}

	// ✅ Улучшенное меню с диагностикой
	function drawMenu(): void {
		ctx.font = 'bold 48px sans-serif';
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('Поймай мяч!', width * 0.5, height * 0.3);

		ctx.font = '24px sans-serif';
		ctx.fillStyle = '#cccccc';
		ctx.fillText('Выберите сложность и нажмите "Старт"', width * 0.5, height * 0.5);

		// ✅ Статус подключения
		const connectionColor =
			stabilogramState.isWsConnected && stabilogramState.isDeviceConnected ? '#10b981' : '#ef4444';
		const connectionText =
			stabilogramState.isWsConnected && stabilogramState.isDeviceConnected
				? 'Стабилометр готов'
				: 'Подключите стабилометр';

		ctx.font = '18px sans-serif';
		ctx.fillStyle = connectionColor;
		ctx.fillText(connectionText, width * 0.5, height * 0.65);

		if (showDebug) {
			ctx.font = '14px monospace';
			ctx.fillStyle = '#888';
			ctx.textAlign = 'left';
			const debugLines = [
				`Stage: ${stage}`,
				`Game: ${game?.isRunning ? 'running' : 'stopped'}`,
				`WS: ${stabilogramState.isWsConnected}`,
				`Device: ${stabilogramState.isDeviceConnected}`,
				`Initialized: ${isInitialized}`
			];
			debugLines.forEach((line, i) => {
				ctx.fillText(line, 10, height - 100 + i * 16);
			});
		}
	}

	function drawResults(): void {
		const score = game.scoreManager;

		ctx.font = 'bold 42px sans-serif';
		ctx.fillStyle = '#FFE66D';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('Игра завершена!', width * 0.5, height * 0.3);

		ctx.font = '28px sans-serif';
		ctx.fillStyle = '#ffffff';
		const y = height * 0.45;
		const lineHeight = 35;

		ctx.fillText(`Итоговый счёт: ${score.score}`, width * 0.5, y);
		ctx.fillText(`Лучшая серия: ${score.bestStreak}`, width * 0.5, y + lineHeight);
		ctx.fillText(`Поймано шаров: ${score.catchCount}`, width * 0.5, y + lineHeight * 2);
	}

	function drawDebugInfo(): void {
		const pool = game.ballPool;
		const renderPos = stabilogramStore.getRenderPosition();

		ctx.font = '14px monospace';
		ctx.fillStyle = 'rgba(255,255,255,0.8)';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';

		const lines = [
			`CoP: (${renderPos.x.toFixed(1)}, ${renderPos.y.toFixed(1)}) mm`,
			`Шаров: ${pool.activeCount}/${pool.capacity}`,
			`Wobble: ${game.basketController.basket.wobbleIntensity.toFixed(2)}`,
			`Stage: ${game.stageManager.currentStage}`
		];

		lines.forEach((line, i) => {
			ctx.fillText(line, 10, height - 80 + i * 18);
		});
	}

	// ════════════════════════════════════════════════
	// Game Controls
	// ════════════════════════════════════════════════

	function startGame(): void {
		if (!game) return;
		if (
			!stabilogramState.isWsConnected ||
			!stabilogramState.isDeviceConnected ||
			!stabilogramStore.isStreamFresh()
		) {
			controlMessage =
				'Для начала игры подключите платформу и дождитесь свежих данных под нагрузкой.';
			return;
		}
		controlMessage = '';
		completionEmitted = false;
		game.start(selectedDifficulty);
		gameStateStore.updateSnapshot(game.getSnapshot());
		window.dispatchEvent(new CustomEvent('gameStarted', { detail: game.getSnapshot() }));
	}

	// ✅ ИСПРАВЛЕНИЕ: Улучшенная функция паузы
	function pauseGame(): void {
		if (!game?.isRunning) return;
		// A user can request a manual pause while the transport is also paused.
		if (game.pauseReason === 'manual') game.resume('manual');
		else game.pause('manual');

		// Принудительно обновляем стор
		gameStateStore.updateSnapshot(game.getSnapshot());
	}

	function restartGame(): void {
		if (!game) return;

		startGame();
	}

	function stopGame(): void {
		if (!game) return;

		window.dispatchEvent(new CustomEvent('gameStopped', { detail: game.getSnapshot() }));
		game.stop();
		gameStateStore.reset();
	}

	function handleCanvasResize(): void {
		if (game) {
			game.updateCanvasSize(width, height);
		}
	}

	// React на изменения размеров
	$: if (canvas && game) {
		handleCanvasResize();
	}
</script>

<!-- ════════════════════════════════════════════════ -->
<!-- TEMPLATE -->
<!-- ════════════════════════════════════════════════ -->

<div class="ball-catcher-container">
	<canvas
		bind:this={canvas}
		{width}
		{height}
		class="game-canvas"
		aria-label="Тренировка равновесия «Поймай мяч»"
	>
		Поле тренировки. Перемещайте центр давления, чтобы удерживать корзинку на целевом мяче.
	</canvas>
	{#if controlMessage}<p class="warning" role="status">{controlMessage}</p>{/if}

	<!-- ✅ Используем проп hideGameControls -->
	{#if !hideGameControls}
		<div class="game-controls">
			{#if stage === STAGE_MENU}
				<div class="menu-panel">
					<h3>Настройки игры</h3>

					<div class="difficulty-selector">
						<label for="difficulty-select">Сложность:</label>
						<select id="difficulty-select" bind:value={selectedDifficulty}>
							<option value={DIFF_EASY}>{DIFFICULTY_PRESETS[DIFF_EASY].label}</option>
							<option value={DIFF_MEDIUM}>{DIFFICULTY_PRESETS[DIFF_MEDIUM].label}</option>
							<option value={DIFF_HARD}>{DIFFICULTY_PRESETS[DIFF_HARD].label}</option>
						</select>
					</div>

					<button
						class="control-btn primary"
						on:click={startGame}
						disabled={!stabilogramState.isWsConnected || !stabilogramState.isDeviceConnected}
					>
						Начать игру
					</button>

					{#if !stabilogramState.isWsConnected}
						<p class="warning">Подключите WebSocket сервер</p>
					{:else if !stabilogramState.isDeviceConnected}
						<p class="warning">Подключите стабилометр</p>
					{/if}
				</div>
			{:else if gameActive}
				<div class="game-panel">
					<button class="control-btn" on:click={pauseGame}>
						{game?.isPaused ? 'Продолжить' : 'Пауза'}
					</button>
					<button class="control-btn" on:click={restartGame}>Заново</button>
					<button class="control-btn secondary" on:click={stopGame}>Выйти в меню</button>
				</div>
			{:else if stage === STAGE_RESULTS}
				<div class="results-panel">
					<button class="control-btn" on:click={restartGame}>Играть снова</button>
					<button class="control-btn secondary" on:click={stopGame}>В меню</button>
				</div>
			{/if}

			{#if gameActive}
				<div class="debug-toggle">
					<input type="checkbox" id="debug-checkbox" bind:checked={showDebug} />
					<label for="debug-checkbox">Отладка</label>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- ════════════════════════════════════════════════ -->
<!-- STYLES -->
<!-- ════════════════════════════════════════════════ -->

<style>
	.ball-catcher-container {
		position: relative;
		display: block;
		width: 100%;
		min-width: 0;
	}

	.game-canvas {
		display: block;
		width: 100%;
		height: auto;
		max-height: 78vh;
		object-fit: contain;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
		border: 1px solid #dce4ec;
		box-sizing: border-box;
		background: #0a0a1a;
	}

	.game-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 12px;
	}

	.menu-panel,
	.game-panel,
	.results-panel {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		width: 100%;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		border-radius: 8px;
		padding: 16px;
		box-sizing: border-box;
		border: 1px solid #dce4ec;
	}

	.menu-panel h3 {
		margin: 0 0 16px 0;
		color: #2c3e50;
		font-weight: 600;
	}

	.difficulty-selector {
		margin-bottom: 16px;
	}

	.difficulty-selector label {
		display: block;
		margin-bottom: 6px;
		font-weight: 500;
		color: #34495e;
	}

	.difficulty-selector select {
		width: 100%;
		padding: 8px 12px;
		border: 2px solid #bdc3c7;
		border-radius: 6px;
		font-size: 14px;
		background: white;
		color: #2c3e50;
	}

	.control-btn {
		background: #3498db;
		color: white;
		border: none;
		border-radius: 6px;
		padding: 10px 16px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
		min-height: 42px;
	}

	.control-btn:hover:not(:disabled) {
		background: #2980b9;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
	}

	.control-btn:disabled {
		background: #95a5a6;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.control-btn.primary {
		background: #27ae60;
	}

	.control-btn.primary:hover:not(:disabled) {
		background: #229954;
		box-shadow: 0 4px 12px rgba(39, 174, 96, 0.3);
	}

	.control-btn.secondary {
		background: #e74c3c;
	}

	.control-btn.secondary:hover:not(:disabled) {
		background: #c0392b;
		box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
	}

	.warning {
		margin: 12px 0 0 0;
		padding: 8px 12px;
		background: #fff3cd;
		border: 1px solid #ffeaa7;
		border-radius: 4px;
		color: #856404;
		font-size: 13px;
		text-align: center;
	}

	.debug-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: #64748b;
		cursor: pointer;
		margin-top: 8px;
	}

	.debug-toggle input[type='checkbox'] {
		margin: 0;
	}

	@media (max-width: 1200px) {
		.game-controls {
			position: static;
			margin-top: 15px;
			max-width: none;
		}

		.menu-panel,
		.game-panel,
		.results-panel {
			background: rgba(255, 255, 255, 1);
		}
	}
</style>
