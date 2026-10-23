<script lang="ts">
	import { onMount } from 'svelte';
	import { stabilogramStore } from '../stores/stabilogram';
	import type { MeasurementSession } from '../sessions/types';
	export let session: MeasurementSession | null = null;
	export let width = 900;
	export let height = 520;
	let canvas: HTMLCanvasElement;
	let fresh = false;
	const capacity = 1000;
	const xs = new Float64Array(capacity),
		ys = new Float64Array(capacity);
	let head = 0,
		count = 0;
	let ctx: CanvasRenderingContext2D | null = null;
	let zoom = 1;
	const gridColor = '#e4eae9',
		lineColor = '#d1dbd9';
	function draw() {
		if (!ctx) return;
		const scale = (Math.min(width, height) / 330) * zoom,
			cx = width / 2,
			cy = height / 2;
		ctx.fillStyle = '#fbfdfc';
		ctx.fillRect(0, 0, width, height);
		ctx.lineWidth = 1;
		ctx.strokeStyle = gridColor;
		for (let v = -150; v <= 150; v += 10) {
			ctx.beginPath();
			ctx.moveTo(cx + v * scale, 0);
			ctx.lineTo(cx + v * scale, height);
			ctx.moveTo(0, cy + v * scale);
			ctx.lineTo(width, cy + v * scale);
			ctx.stroke();
		}
		ctx.strokeStyle = lineColor;
		ctx.beginPath();
		ctx.moveTo(cx, 0);
		ctx.lineTo(cx, height);
		ctx.moveTo(0, cy);
		ctx.lineTo(width, cy);
		ctx.stroke();
		ctx.fillStyle = '#748580';
		ctx.font = '12px sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText('X, мм →', width - 68, cy - 10);
		ctx.fillText('Y, мм ↑', cx + 10, 20);
		ctx.strokeStyle = session?.demo ? '#8b70b5' : '#168b76';
		ctx.lineWidth = 1.7;
		ctx.beginPath();
		if (session) {
			let pen = false;
			for (let i = 0; i < session.samples.length; i++) {
				const entry = session.samples[i];
				if (!entry.valid) {
					pen = false;
					continue;
				}
				const p = entry.sample.centered,
					x = cx + p.x * scale,
					y = cy - p.y * scale;
				if (!pen || entry.breakBefore) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
				pen = true;
			}
		} else {
			for (let i = 0; i < count; i++) {
				const index = (head - count + i + capacity) % capacity,
					x = cx + xs[index] * scale,
					y = cy - ys[index] * scale;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
		}
		ctx.stroke();
		if (!session && stabilogramStore.isStreamFresh()) {
			const p = stabilogramStore.getRenderPosition();
			ctx.fillStyle = '#12836f';
			ctx.beginPath();
			ctx.arc(cx + p.x * scale, cy - p.y * scale, 6, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	onMount(() => {
		ctx = canvas.getContext('2d');
		const unsubscribe = stabilogramStore.observeSamples((s) => {
			if (s.isValid === false) return;
			xs[head] = s.centered.x;
			ys[head] = s.centered.y;
			head = (head + 1) % capacity;
			count = Math.min(count + 1, capacity);
		});
		let animation = 0;
		function frame() {
			draw();
			animation = requestAnimationFrame(frame);
		}
		frame();
		const timer = setInterval(() => {
			fresh = stabilogramStore.isStreamFresh();
		}, 200);
		return () => {
			unsubscribe();
			cancelAnimationFrame(animation);
			clearInterval(timer);
		};
	});
</script>

<div class="plot">
	<div class="plot-toolbar">
		<span>{session ? 'Траектория записи' : 'Центр давления · вид сверху'}</span>
		<div>
			<button aria-label="Уменьшить масштаб" on:click={() => (zoom = Math.max(0.5, zoom / 1.2))}
				>−</button
			><button on:click={() => (zoom = 1)}>1:1</button><button
				aria-label="Увеличить масштаб"
				on:click={() => (zoom = Math.min(4, zoom * 1.2))}>+</button
			>
		</div>
	</div>
	<canvas bind:this={canvas} {width} {height} aria-label="Траектория центра давления в миллиметрах"
	></canvas>
	{#if !session && !fresh}<div class="plot-empty">
			<span class="signal-dot"></span>Ожидание валидных измерений
		</div>{/if}
	<div class="plot-caption">
		<span>← Влево · Вправо →</span><span>Координаты до визуального сглаживания</span>
	</div>
</div>

<style>
	.plot {
		position: relative;
		border: 1px solid var(--border, #dce5e2);
		border-radius: 14px;
		overflow: hidden;
		background: #fbfdfc;
	}
	.plot-toolbar,
	.plot-caption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 13px 18px;
		font-size: 12px;
		color: #64766e;
		background: white;
		gap: 8px;
	}
	.plot-toolbar {
		border-bottom: 1px solid #e6ece9;
		font-weight: 600;
	}
	.plot-toolbar div {
		display: flex;
		gap: 4px;
	}
	.plot-toolbar button {
		padding: 3px 9px;
		border: 1px solid #dce5e2;
		border-radius: 5px;
		background: white;
		color: #50675f;
		cursor: pointer;
	}
	canvas {
		display: block;
		width: 100%;
		height: auto;
	}
	.plot-caption {
		border-top: 1px solid #e6ece9;
		font-size: 11px;
		flex-wrap: wrap;
	}
	.plot-empty {
		position: absolute;
		top: 56%;
		left: 50%;
		transform: translate(-50%, -50%);
		padding: 12px 18px;
		border-radius: 30px;
		box-shadow: 0 2px 18px #183c2210;
		background: #fffffff0;
		color: #708078;
		font-size: 13px;
		white-space: nowrap;
	}
	.signal-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #b4bdb9;
		margin-right: 7px;
	}
</style>
