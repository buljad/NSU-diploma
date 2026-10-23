<script lang="ts">
	import { onMount } from 'svelte';
	import { stabilogramStore } from '../stores/stabilogram';
	import { wsClient } from '../websocket/client';
	export let locked = false;
	let ports: Array<{ path: string; manufacturer?: string }> = [];
	let selectedPort = '',
		baud = 115200,
		demo = false,
		calibrating = false,
		progress = 0,
		total = 200,
		error = '';
	const axis = stabilogramStore.axisConfig;
	let axes = { swapXY: true, invertX: false, invertY: false, rotationDeg: 0 };
	$: connected = $stabilogramStore.isDeviceConnected;
	$: axes = { ...$axis };
	onMount(() => {
		const subscriptions = [
			wsClient.on('PORTS_LIST', (data) => {
				ports = data.ports;
				if (!selectedPort && ports.length) selectedPort = ports[0].path;
			}),
			wsClient.on('WS_CONNECTED', () => wsClient.listPorts()),
			wsClient.on('CONNECTED', (data) => {
				calibrating = !!data.isCalibrating;
				progress = data.calibrationProgress ?? 0;
			}),
			wsClient.on('CALIBRATION_CANCELLED', () => (calibrating = false)),
			wsClient.on('CALIBRATION_STARTED', () => {
				calibrating = true;
				progress = 0;
			}),
			wsClient.on('CALIBRATION_PROGRESS', (data) => {
				progress = data.progress;
				total = data.total;
			}),
			wsClient.on('CALIBRATION_COMPLETE', () => (calibrating = false)),
			wsClient.on('SERIAL_DISCONNECTED', () => (calibrating = false)),
			wsClient.on('ERROR', (data) => {
				error = data.error;
				calibrating = false;
			})
		];
		if (wsClient.getConnectionState()) wsClient.listPorts();
		return () => subscriptions.forEach((unsubscribe) => unsubscribe());
	});
</script>

<div class="device-grid">
	<section class="card">
		<div class="section-label">01 · СОЕДИНЕНИЕ</div>
		<h2>Платформа</h2>
		<p class="muted">Подключите USB-кабель и выберите устройство.</p>
		{#if error}<div class="notice danger" role="alert">{error}</div>{/if}
		<label class="check"
			><input type="checkbox" bind:checked={demo} disabled={connected || locked} /> Демонстрация без оборудования</label
		>
		{#if !demo}<label
				>COM-порт
				<div class="input-row">
					<select bind:value={selectedPort} disabled={connected || locked}
						><option value="">Выберите порт</option>{#each ports as p}<option value={p.path}
								>{p.path} {p.manufacturer ?? ''}</option
							>{/each}</select
					><button
						class="button"
						on:click={() => wsClient.listPorts()}
						disabled={!$stabilogramStore.isWsConnected || locked}>Обновить</button
					>
				</div></label
			>
			<label
				>Скорость передачи<select bind:value={baud} disabled={connected || locked}
					><option value={115200}>115200 бод</option><option value={57600}>57600 бод</option><option
						value={9600}>9600 бод</option
					></select
				></label
			>{/if}
		{#if connected}<div class="notice">
				{$stabilogramStore.demo
					? 'Демонстрационный поток'
					: `Подключено: ${$stabilogramStore.port}`}
			</div>
			<button class="button" disabled={locked} on:click={() => wsClient.disconnectDevice()}
				>Отключить платформу</button
			>
		{:else}<button
				class="button primary"
				disabled={locked || !$stabilogramStore.isWsConnected || (!demo && !selectedPort)}
				on:click={() => {
					error = '';
					wsClient.connectDevice(selectedPort, baud, demo);
				}}>Подключить {demo ? 'демонстрацию' : 'платформу'}</button
			>{/if}
	</section>
	<section class="card">
		<div class="section-label">02 · ПОДГОТОВКА</div>
		<h2>Калибровка нуля</h2>
		<p class="muted">
			Освободите платформу. Во время калибровки не касайтесь её и не меняйте положение.
		</p>
		<div class="calibration-status">
			{$stabilogramStore.isCalibrated
				? 'Калибровка сохранена'
				: $stabilogramStore.demo
					? 'В демонстрации калибровка не требуется'
					: 'Требуется калибровка'}
		</div>
		{#if calibrating}<progress max={total} value={progress}></progress>
			<p>{progress} / {total} измерений</p>{/if}
		<button
			class="button primary"
			disabled={locked || !connected || $stabilogramStore.demo || calibrating}
			on:click={() => wsClient.calibrateZero()}
			>{calibrating ? 'Калибровка…' : 'Калибровать пустую платформу'}</button
		>
		<p class="small muted">
			Калибровка не является центрированием положения участника. Проверьте ориентацию осей после
			установки оборудования.
		</p>
	</section>
	<section class="card">
		<div class="section-label">03 · ОРИЕНТАЦИЯ</div>
		<h2>Оси координат</h2>
		<p class="muted">Настройки фиксируются в каждой записи. Во время измерения менять их нельзя.</p>
		<label class="check"
			><input
				type="checkbox"
				bind:checked={axes.swapXY}
				disabled={locked}
				on:change={() => wsClient.configureAxes(axes)}
			/> Поменять X и Y</label
		>
		<label class="check"
			><input
				type="checkbox"
				bind:checked={axes.invertX}
				disabled={locked}
				on:change={() => wsClient.configureAxes(axes)}
			/> Инвертировать X</label
		>
		<label class="check"
			><input
				type="checkbox"
				bind:checked={axes.invertY}
				disabled={locked}
				on:change={() => wsClient.configureAxes(axes)}
			/> Инвертировать Y</label
		>
		<label
			>Поворот<select
				bind:value={axes.rotationDeg}
				disabled={locked}
				on:change={() => wsClient.configureAxes(axes)}
				>{#each [0, 90, 180, 270] as angle}<option value={angle}>{angle}°</option>{/each}</select
			></label
		>
	</section>
</div>

<style>
	.device-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
		gap: 20px;
	}
	.device-grid section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
	}
	.device-grid label {
		width: 100%;
	}
	.input-row {
		display: flex;
		gap: 8px;
	}
	.input-row select {
		min-width: 0;
	}
	.calibration-status {
		font-size: 14px;
		color: #52716a;
		border: 1px solid #dce5e2;
		background: #f4f8f6;
		padding: 16px;
		border-radius: 10px;
		width: 100%;
	}
	progress {
		width: 100%;
		accent-color: #168b76;
	}
</style>
