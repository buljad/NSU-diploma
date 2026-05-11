<!-- packages/client/src/lib/components/MedicalStabilogramCanvas.svelte -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { stabilogramStore } from '../stores/stabilogram';
	import type { Vector2D } from '@stabilometer/shared';

	export let width = 800;
	export let height = 600;
	export let showDebug = false;
	export let medicalMode = true;

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;
	let animationId: number;
	let trail: Vector2D[] = [];
	const maxTrailLength = 200;

	// ✅ НОВОЕ: Диагностические счетчики
	let frameCount = 0;
	let lastDiagnosticTime = 0;
	let lastRenderPosition: Vector2D = { x: 0, y: 0 };
	let isStoreInitialized = false; // ✅ ИСПРАВЛЕНО: Локальная переменная

	// Медицинские метрики
	let stabilityScore = 0;
	let averageSpeed = 0;
	let totalDistance = 0;

	// История для анализа
	let positionHistory: Vector2D[] = [];
	let lastPosition: Vector2D | null = null;
	let sessionStartTime = 0;

	// Зоны стабильности (в мм)
	const comfortZone = 15;
	const warningZone = 30;

	$: position = $stabilogramStore.interpolatedPosition;
	$: velocity = $stabilogramStore.velocity;
	$: scale = $stabilogramStore.scale;
	$: isConnected = $stabilogramStore.isWsConnected;

	onMount(() => {
		console.log('🎨 MedicalStabilogramCanvas mounted');
		ctx = canvas.getContext('2d')!;

		// ✅ ИСПРАВЛЕНО: Принудительная инициализация без проверки приватного свойства
		console.log('🚀 Force initializing stabilogram store from canvas');
		stabilogramStore.initialize({ x: width, y: height });
		isStoreInitialized = true; // ✅ Устанавливаем флаг

		sessionStartTime = performance.now();
		animate();
	});

	onDestroy(() => {
		if (animationId) {
			cancelAnimationFrame(animationId);
			console.log('🎨 MedicalStabilogramCanvas destroyed');
		}
	});

	function animate() {
		frameCount++;
		const now = performance.now();

		// Получаем позицию для рендера
		const renderPos = stabilogramStore.getRenderPosition();

		// ✅ ДЕТАЛЬНАЯ ДИАГНОСТИКА ВСЕГО ПАЙПЛАЙНА
		const currentSample = $stabilogramStore.currentSample;
		if (currentSample) {
			// Вычисляем дистанции на каждом этапе
			const rawDistance = Math.sqrt(currentSample.raw.x ** 2 + currentSample.raw.y ** 2);
			const centeredDistance = Math.sqrt(
				currentSample.centered.x ** 2 + currentSample.centered.y ** 2
			);
			const filteredDistance = Math.sqrt(
				currentSample.filtered.x ** 2 + currentSample.filtered.y ** 2
			);
			const mmDistance = Math.sqrt(currentSample.mm.x ** 2 + currentSample.mm.y ** 2);
			const renderDistance = Math.sqrt(renderPos.x ** 2 + renderPos.y ** 2);

			// Получаем данные интерполятора
			const interpolatorDebug = (stabilogramStore as any).getInterpolatorDebug?.() || {};
			const velocity = $stabilogramStore.velocity;
			const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);

			// ✅ ДЕТЕКТОР РЕЗКИХ ДВИЖЕНИЙ
			const maxStageJump = Math.max(
				Math.abs(rawDistance - centeredDistance),
				Math.abs(centeredDistance - filteredDistance),
				Math.abs(filteredDistance - mmDistance),
				Math.abs(mmDistance - renderDistance)
			);

			// Логируем только при больших скачках между этапами
			if (maxStageJump > 15 || speed > 100) {
				// 15мм разница между этапами или скорость > 100мм/с
				console.group(
					`🔥 РЕЗКОЕ ДВИЖЕНИЕ ДЕТЕКТИРОВАНО (jump: ${maxStageJump.toFixed(1)}mm, speed: ${speed.toFixed(1)}mm/s)`
				);

				console.log('📍 Пайплайн позиций:', {
					'1_raw': {
						x: currentSample.raw.x.toFixed(1),
						y: currentSample.raw.y.toFixed(1),
						dist: rawDistance.toFixed(1)
					},
					'2_centered': {
						x: currentSample.centered.x.toFixed(1),
						y: currentSample.centered.y.toFixed(1),
						dist: centeredDistance.toFixed(1)
					},
					'3_filtered': {
						x: currentSample.filtered.x.toFixed(1),
						y: currentSample.filtered.y.toFixed(1),
						dist: filteredDistance.toFixed(1)
					},
					'4_mm': {
						x: currentSample.mm.x.toFixed(1),
						y: currentSample.mm.y.toFixed(1),
						dist: mmDistance.toFixed(1)
					},
					'5_render': {
						x: renderPos.x.toFixed(1),
						y: renderPos.y.toFixed(1),
						dist: renderDistance.toFixed(1)
					}
				});

				console.log('⏱️ Timing:', {
					deviceTime: currentSample.deviceTime,
					clientTime: currentSample.clientTime,
					renderTime: now,
					age: (now - currentSample.clientTime).toFixed(1) + 'ms',
					packetRate: $stabilogramStore.packetRate + 'Hz'
				});

				console.log('🔧 Фильтры:', {
					interpolator: interpolatorDebug,
					velocity: { vx: velocity.x.toFixed(1), vy: velocity.y.toFixed(1) },
					speed: speed.toFixed(1)
				});

				// Проверяем, есть ли "jump to center" - когда render позиция сильно ближе к центру чем mm позиция
				const jumpToCenter = mmDistance > 30 && renderDistance < mmDistance * 0.7;
				if (jumpToCenter) {
					console.error('🚨 ДЕТЕКТИРОВАН "JUMP TO CENTER"!', {
						mmPos: `(${currentSample.mm.x.toFixed(1)}, ${currentSample.mm.y.toFixed(1)})`,
						renderPos: `(${renderPos.x.toFixed(1)}, ${renderPos.y.toFixed(1)})`,
						ratio: (renderDistance / mmDistance).toFixed(2)
					});
				}

				console.groupEnd();
			}
		}
		// ✅ ДИАГНОСТИКА КАЖДЫЕ 2 СЕКУНДЫ
		if (now - lastDiagnosticTime > 2000) {
			const moved = Math.sqrt(
				(renderPos.x - lastRenderPosition.x) ** 2 + (renderPos.y - lastRenderPosition.y) ** 2
			);

			console.log('🎨 Canvas diagnostic:', {
				frameCount,
				fps: Math.round(frameCount / 2),
				renderPos,
				moved: moved.toFixed(2),
				isStoreInitialized,
				storeState: {
					isConnected: $stabilogramStore.isWsConnected,
					isCalibrated: $stabilogramStore.isCalibrated,
					currentSample: !!$stabilogramStore.currentSample,
					packetRate: $stabilogramStore.packetRate
				}
			});

			frameCount = 0;
			lastDiagnosticTime = now;
			lastRenderPosition = { ...renderPos };
		}

		if (medicalMode) {
			updateMedicalMetrics(renderPos);
		} else {
			// ✅ ИСПРАВЛЕНИЕ: Обновляем trail для игрового режима
			if ($stabilogramStore.currentSample) {
				trail.push({ ...renderPos });
				if (trail.length > maxTrailLength) trail.shift();
			}
		}

		draw(renderPos);
		animationId = requestAnimationFrame(animate);
	}

	function updateMedicalMetrics(pos: Vector2D) {
		positionHistory.push({ x: pos.x, y: pos.y });
		if (positionHistory.length > 1000) {
			positionHistory.shift();
		}

		if (lastPosition) {
			const distance = Math.sqrt(
				Math.pow(pos.x - lastPosition.x, 2) + Math.pow(pos.y - lastPosition.y, 2)
			);
			totalDistance += distance;
		}
		lastPosition = { x: pos.x, y: pos.y };

		const recentHistory = positionHistory.slice(-250);
		if (recentHistory.length > 1) {
			let recentDistance = 0;
			for (let i = 1; i < recentHistory.length; i++) {
				const d = Math.sqrt(
					Math.pow(recentHistory[i].x - recentHistory[i - 1].x, 2) +
						Math.pow(recentHistory[i].y - recentHistory[i - 1].y, 2)
				);
				recentDistance += d;
			}
			averageSpeed = (recentDistance / 5) * 50;
		}

		const distanceFromCenter = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
		const speedFactor = Math.min(averageSpeed / 50, 1);
		stabilityScore = Math.max(0, 100 - distanceFromCenter * 2 - speedFactor * 30);
	}

	function draw(pos: Vector2D) {
		ctx.fillStyle = medicalMode ? '#ffffff' : '#0f0f1a';
		ctx.fillRect(0, 0, width, height);

		const cx = width / 2;
		const cy = height / 2;

		if (medicalMode) {
			drawMedicalGrid(cx, cy);
			drawStabilityZones(cx, cy);
			drawPositionHistory(cx, cy);
			drawPatientPosition(cx + pos.x * scale, cy - pos.y * scale);
			drawMedicalMetrics();
		} else {
			drawGameGrid(cx, cy);
			drawGameTrail(cx, cy);
			drawGameCharacter(cx + pos.x * scale, cy - pos.y * scale);
		}

		if (showDebug) drawDebugInfo(pos);
	}

	function drawMedicalGrid(cx: number, cy: number) {
		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;

		const spacing = 10 * scale;
		for (let x = cx % spacing; x < width; x += spacing) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		}
		for (let y = cy % spacing; y < height; y += spacing) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}

		ctx.strokeStyle = '#9ca3af';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(cx, 0);
		ctx.lineTo(cx, height);
		ctx.moveTo(0, cy);
		ctx.lineTo(width, cy);
		ctx.stroke();

		ctx.fillStyle = '#6b7280';
		ctx.font = '12px Arial';
		ctx.textAlign = 'center';
		ctx.fillText('Медиально ← → Латерально', cx, height - 10);

		ctx.save();
		ctx.translate(15, cy);
		ctx.rotate(-Math.PI / 2);
		ctx.fillText('Назад ← → Вперед', 0, 0);
		ctx.restore();
	}

	function drawStabilityZones(cx: number, cy: number) {
		ctx.strokeStyle = '#10b981';
		ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, comfortZone * scale, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.strokeStyle = '#f59e0b';
		ctx.fillStyle = 'rgba(245, 158, 11, 0.05)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, warningZone * scale, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.fillStyle = '#10b981';
		ctx.font = '11px Arial';
		ctx.fillText(`Зона комфорта (${comfortZone}мм)`, cx + comfortZone * scale + 10, cy);

		ctx.fillStyle = '#f59e0b';
		ctx.fillText(`Зона контроля (${warningZone}мм)`, cx + warningZone * scale + 10, cy + 15);
	}

	function drawPositionHistory(cx: number, cy: number) {
		if (positionHistory.length < 2) return;

		ctx.strokeStyle = '#6366f1';
		ctx.lineWidth = 1;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		ctx.beginPath();
		const start = Math.max(0, positionHistory.length - 200);
		for (let i = start; i < positionHistory.length; i++) {
			const p = positionHistory[i];
			const x = cx + p.x * scale;
			const y = cy - p.y * scale;

			if (i === start) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}
		ctx.stroke();
	}

	function drawPatientPosition(x: number, y: number) {
		const distanceFromCenter =
			Math.sqrt(Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2)) / scale;

		let color = '#ef4444';
		if (distanceFromCenter <= comfortZone) {
			color = '#10b981';
		} else if (distanceFromCenter <= warningZone) {
			color = '#f59e0b';
		}

		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(x, y, 8, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(x, y, 8, 0, Math.PI * 2);
		ctx.stroke();

		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x - 12, y);
		ctx.lineTo(x + 12, y);
		ctx.moveTo(x, y - 12);
		ctx.lineTo(x, y + 12);
		ctx.stroke();
	}

	function drawMedicalMetrics() {
		const metrics = [
			{
				label: 'Оценка стабильности',
				value: `${stabilityScore.toFixed(0)}%`,
				color: stabilityScore > 70 ? '#10b981' : stabilityScore > 40 ? '#f59e0b' : '#ef4444'
			},
			{ label: 'Средняя скорость', value: `${averageSpeed.toFixed(1)} мм/с`, color: '#6b7280' },
			{
				label: 'Общее расстояние',
				value: `${(totalDistance / 1000).toFixed(2)} м`,
				color: '#6b7280'
			},
			{
				label: 'Время сессии',
				value: `${((performance.now() - sessionStartTime) / 1000).toFixed(0)} с`,
				color: '#6b7280'
			},
			// ✅ НОВАЯ МЕТРИКА: Пакеты в секунду
			{
				label: 'Частота данных',
				value: `${$stabilogramStore.packetRate} Гц`,
				color: $stabilogramStore.packetRate > 20 ? '#10b981' : '#f59e0b'
			}
		];

		ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
		ctx.fillRect(10, 10, 220, metrics.length * 25 + 20);

		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;
		ctx.strokeRect(10, 10, 220, metrics.length * 25 + 20);

		ctx.font = '13px Arial';
		metrics.forEach((metric, i) => {
			ctx.fillStyle = '#374151';
			ctx.textAlign = 'left';
			ctx.fillText(metric.label + ':', 20, 30 + i * 25);

			ctx.fillStyle = metric.color;
			ctx.textAlign = 'right';
			ctx.fillText(metric.value, 220, 30 + i * 25);
		});
	}

	function drawGameGrid(cx: number, cy: number) {
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.lineWidth = 1;

		const spacing = 10 * scale;
		for (let x = cx % spacing; x < width; x += spacing) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		}
		for (let y = cy % spacing; y < height; y += spacing) {
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}

		ctx.strokeStyle = 'rgba(255,255,255,0.3)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(cx, 0);
		ctx.lineTo(cx, height);
		ctx.moveTo(0, cy);
		ctx.lineTo(width, cy);
		ctx.stroke();

		ctx.strokeStyle = 'rgba(74,158,255,0.1)';
		ctx.lineWidth = 1;
		for (let r = 50; r < Math.max(width, height); r += 50) {
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	function drawGameTrail(cx: number, cy: number) {
		if (trail.length < 2) return;

		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		for (let i = 1; i < trail.length; i++) {
			const alpha = (i / trail.length) * 0.8;
			const lw = 1 + (i / trail.length) * 3;

			ctx.beginPath();
			ctx.strokeStyle = `rgba(74,158,255,${alpha})`;
			ctx.lineWidth = lw;

			const prev = trail[i - 1];
			const curr = trail[i];

			ctx.moveTo(cx + prev.x * scale, cy - prev.y * scale);
			ctx.lineTo(cx + curr.x * scale, cy - curr.y * scale);
			ctx.stroke();
		}
	}

	function drawGameCharacter(x: number, y: number) {
		const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
		const r = 20 + Math.min(speed * 0.5, 10);

		// Glow
		const glow = ctx.createRadialGradient(x, y, 0, x, y, r + 20);
		glow.addColorStop(0, 'rgba(74,158,255,0.5)');
		glow.addColorStop(0.5, 'rgba(74,158,255,0.2)');
		glow.addColorStop(1, 'rgba(74,158,255,0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(x, y, r + 20, 0, Math.PI * 2);
		ctx.fill();

		// Main
		const main = ctx.createRadialGradient(x - r / 3, y - r / 3, 0, x, y, r);
		main.addColorStop(0, '#6ee7ff');
		main.addColorStop(0.7, '#4a9eff');
		main.addColorStop(1, '#2563eb');
		ctx.fillStyle = main;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();

		// Highlight
		ctx.fillStyle = 'rgba(255,255,255,0.4)';
		ctx.beginPath();
		ctx.arc(x - r / 3, y - r / 3, r / 4, 0, Math.PI * 2);
		ctx.fill();

		// Direction
		if (speed > 1) {
			const angle = Math.atan2(-velocity.y, velocity.x);
			ctx.strokeStyle = 'rgba(255,255,255,0.6)';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
			ctx.lineTo(x + Math.cos(angle) * (r + 15), y + Math.sin(angle) * (r + 15));
			ctx.stroke();
		}
	}

	function drawDebugInfo(pos: Vector2D) {
		ctx.font = '12px monospace';
		ctx.fillStyle = medicalMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)';

		const lines = [
			`Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}) mm`,
			`Velocity: (${velocity.x.toFixed(1)}, ${velocity.y.toFixed(1)}) mm/s`,
			`Scale: ${scale.toFixed(1)} px/mm`,
			`Store init: ${isStoreInitialized}`, // ✅ ИСПРАВЛЕНО
			`Connected: WS=${isConnected} DEV=${$stabilogramStore.isDeviceConnected}`,
			`Calibrated: ${$stabilogramStore.isCalibrated}`,
			`Packet rate: ${$stabilogramStore.packetRate} Hz`,
			`Mode: ${medicalMode ? 'Medical' : 'Game'}`,
			`Trail: ${trail.length} points`
		];

		lines.forEach((line, i) => {
			ctx.fillText(line, 10, height - 140 + i * 15);
		});
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		stabilogramStore.setScale(scale * delta);
	}

	function resetMetrics() {
		stabilityScore = 0;
		averageSpeed = 0;
		totalDistance = 0;
		positionHistory = [];
		trail = [];
		lastPosition = null;
		sessionStartTime = performance.now();
		console.log('📊 Medical metrics reset');
	}

	export function exportSessionData() {
		const data = {
			positionHistory,
			trail,
			metrics: {
				stabilityScore,
				averageSpeed,
				totalDistance,
				sessionDuration: (performance.now() - sessionStartTime) / 1000
			},
			timestamp: new Date().toISOString()
		};

		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = `stabilogram_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);

		URL.revokeObjectURL(url);
		console.log('💾 Данные экспортированы:', data);
	}
</script>

<div class="canvas-container">
	<canvas bind:this={canvas} {width} {height} on:wheel={handleWheel} on:dblclick={resetMetrics} />

	<div class="canvas-controls">
		<button on:click={resetMetrics} class="control-btn"> Сброс метрик </button>

		<button on:click={() => (medicalMode = !medicalMode)} class="control-btn">
			{medicalMode ? 'Игровой режим' : 'Медицинский режим'}
		</button>

		<button on:click={() => (showDebug = !showDebug)} class="control-btn">
			{showDebug ? 'Скрыть отладку' : 'Показать отладку'}
		</button>

		<button on:click={exportSessionData} class="control-btn"> Экспорт данных </button>
	</div>
</div>

<style>
	.canvas-container {
		position: relative;
		display: inline-block;
	}

	canvas {
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		border: 2px solid #e5e7eb;
	}

	.canvas-controls {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.control-btn {
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid #d1d5db;
		border-radius: 4px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.control-btn:hover {
		background: white;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}
</style>
