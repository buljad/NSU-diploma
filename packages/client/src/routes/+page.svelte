<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { wsClient } from '$lib/websocket/client';
	import { stabilogramStore } from '$lib/stores/stabilogram';
	import { sessionStore } from '$lib/sessions/store';
	import {
		sessionToCSV,
		sessionToJSON,
		sessionReportHTML,
		comparisonWarnings
	} from '$lib/sessions/exports';
	import type { MeasurementSession, Protocol } from '$lib/sessions/types';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import MedicalStabilogramCanvas from '$lib/components/MedicalStabilogramCanvas.svelte';
	import BallCatcherCanvas from '$lib/components/BallCatcherCanvas.svelte';
	import SessionSignals from '$lib/components/SessionSignals.svelte';
	import { gameStateStore } from '$lib/stores/gameState';

	type View = 'measure' | 'training' | 'participants' | 'history' | 'device';
	let view: View = 'measure',
		participantId = '',
		newName = '',
		newNotes = '',
		search = '',
		filter = '',
		editingParticipantId = '';
	let error = '',
		busy = false,
		countdown = 0,
		difficulty = 1,
		protocolId = 'eyes-open',
		duration = 30,
		stance = 'Стопы параллельно';
	let comparison: MeasurementSession | null = null,
		compareId = '',
		note = '',
		reportHTML = '',
		noteId = '',
		savedNote = '';
	let fresh = false,
		elapsed = 0,
		recordingStarted = 0;
	let lastGameResult: Record<string, number | string | boolean> | undefined;
	const calibration = stabilogramStore.calibration,
		axes = stabilogramStore.axisConfig;
	const nav: Array<{ id: View; label: string; mark: string }> = [
		{ id: 'measure', label: 'Измерение', mark: '01' },
		{ id: 'training', label: 'Тренировка', mark: '02' },
		{ id: 'participants', label: 'Участники', mark: '03' },
		{ id: 'history', label: 'История', mark: '04' },
		{ id: 'device', label: 'Устройство', mark: '05' }
	];
	$: active = $sessionStore.active;
	$: selected = $sessionStore.selected;
	$: locked = !!active || countdown > 0 || busy || !$sessionStore.initialized;
	$: participant = $sessionStore.participants.find((p) => p.id === participantId);
	$: visibleParticipants = $sessionStore.participants.filter((p) =>
		(p.name + ' ' + p.notes).toLowerCase().includes(search.toLowerCase())
	);
	$: visibleSessions = $sessionStore.sessions.filter((s) => !filter || s.participantId === filter);
	$: metrics = active?.metrics ?? selected?.metrics;
	$: compareWarnings = selected && comparison ? comparisonWarnings(selected, comparison) : [];
	$: if (selected && (selected.id !== noteId || selected.notes !== savedNote)) {
		note = selected.notes;
		noteId = selected.id;
		savedNote = selected.notes;
	}
	function date(value: number) {
		return new Date(value).toLocaleString('ru-RU', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
	function name(id: string) {
		return $sessionStore.participants.find((p) => p.id === id)?.name ?? 'Участник';
	}
	function number(value: number | undefined) {
		return value === undefined ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
	}
	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	function download(text: string, filename: string, type = 'application/json') {
		const url = URL.createObjectURL(new Blob([text], { type }));
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function protocol(): Protocol {
		return {
			id: protocolId,
			name:
				protocolId === 'eyes-open'
					? 'Спокойная стойка · глаза открыты'
					: protocolId === 'eyes-closed'
						? 'Спокойная стойка · глаза закрыты'
						: 'Свободная запись',
			eyes:
				protocolId === 'eyes-open'
					? 'open'
					: protocolId === 'eyes-closed'
						? 'closed'
						: 'unspecified',
			durationSeconds: duration,
			stance
		};
	}
	async function begin(training = false) {
		if (!participantId) throw new Error('Сначала выберите или добавьте участника.');
		if (!stabilogramStore.isStreamFresh()) throw new Error('Ожидайте валидный сигнал платформы.');
		const s = get(stabilogramStore);
		if (!s.isCalibrated && !s.demo) throw new Error('Выполните калибровку пустой платформы.');
		recordingStarted = performance.now();
		elapsed = 0;
		lastGameResult = undefined;
		await sessionStore.begin({
			participantId,
			protocol: training
				? {
						id: 'ball-catcher',
						name: `Поймай мяч · ${['легко', 'средне', 'сложно'][difficulty]}`,
						eyes: 'open',
						notes: `Сложность ${difficulty}`
					}
				: protocol(),
			demo: s.demo,
			calibration: get(calibration),
			axes: get(axes)
		});
		if (training) {
			window.dispatchEvent(new CustomEvent('gameStart', { detail: { difficulty } }));
			if (!get(gameStateStore).isRunning) {
				await sessionStore.stop('Тренировка не запущена: нет свежего сигнала.');
				throw new Error('Дождитесь свежего сигнала и повторите запуск тренировки.');
			}
		}
	}
	async function prepare() {
		if (locked) return;
		error = '';
		if (!participantId || !fresh) {
			error = 'Выберите участника и подключите платформу с валидным сигналом.';
			return;
		}
		countdown = 3;
	}
	async function finish(reason = '') {
		if (!get(sessionStore).active) return;
		if (view === 'training') window.dispatchEvent(new CustomEvent('gameStop'));
		const result = await sessionStore.stop(reason, lastGameResult);
		if (result) {
			view = 'history';
			comparison = null;
			compareId = '';
		}
	}
	async function addParticipant() {
		await run(async () => {
			const p = await sessionStore.saveParticipant({
				id: editingParticipantId || undefined,
				name: newName,
				notes: newNotes
			});
			participantId = p.id;
			newName = '';
			newNotes = '';
			editingParticipantId = '';
			view = 'measure';
		});
	}
	async function removeParticipant(id: string) {
		if (
			!confirm('Удалить карточку участника и все связанные записи? Это действие нельзя отменить.')
		)
			return;
		await run(async () => {
			await sessionStore.deleteParticipant(id);
			if (participantId === id) participantId = '';
			if (filter === id) filter = '';
			comparison = null;
		});
	}
	async function removeSession() {
		if (!selected || !confirm('Удалить выбранную запись? Это действие нельзя отменить.')) return;
		const id = selected.id;
		await run(async () => {
			await sessionStore.deleteSession(id);
			comparison = null;
		});
	}
	async function openSession(id: string) {
		await run(async () => {
			await sessionStore.select(id);
			view = 'history';
			comparison = null;
			compareId = '';
		});
	}
	async function compare() {
		if (!compareId) {
			comparison = null;
			return;
		}
		await run(async () => {
			const id = selected?.id;
			await sessionStore.select(compareId);
			comparison = get(sessionStore).selected;
			if (id) await sessionStore.select(id);
		});
	}
	async function importArchive(event: Event) {
		const input = event.target as HTMLInputElement,
			file = input.files?.[0];
		if (!file) return;
		await run(async () => {
			if (file.size > 100 * 1024 * 1024) throw new Error('Архив больше 100 МБ.');
			await sessionStore.importBackup(await file.text());
			participantId = '';
			comparison = null;
		});
		input.value = '';
	}
	function exportSelected(format: 'csv' | 'json') {
		if (!selected) return;
		download(
			format === 'csv' ? sessionToCSV(selected) : sessionToJSON(selected),
			selected.id + '.' + format,
			format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'
		);
	}
	$: comparisonRows =
		selected && comparison
			? [
					{
						label: 'Длина, мм',
						a: selected.metrics.pathLengthMm,
						b: comparison.metrics.pathLengthMm
					},
					{
						label: 'Скорость, мм/с',
						a: selected.metrics.meanVelocityMmS,
						b: comparison.metrics.meanVelocityMmS
					},
					{
						label: 'Эллипс 95%, мм²',
						a: selected.metrics.ellipse95Mm2,
						b: comparison.metrics.ellipse95Mm2
					}
				]
			: [];
	function showReport() {
		if (selected)
			reportHTML = sessionReportHTML(
				selected,
				$sessionStore.participants.find((p) => p.id === selected?.participantId)
			);
	}
	onMount(() => {
		void sessionStore.initialize().catch((e) => (error = e.message));
		wsClient.setStore(stabilogramStore);
		void wsClient.connect().catch((e) => (error = e.message));
		const observers = [
			stabilogramStore.observeSamples((sample) => sessionStore.ingest(sample)),
			wsClient.on('ERROR', (data) => {
				error = data.error;
			}),
			wsClient.on('WS_CONNECTED', () => {
				error = '';
			})
		];
		let stopping = false,
			invalidSince = 0;
		let lastCountdown = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			fresh = stabilogramStore.isStreamFresh(now);
			if (countdown && now - lastCountdown >= 1000) {
				lastCountdown = now;
				countdown--;
				if (!countdown) void run(() => begin());
			}
			if (!countdown) lastCountdown = now;
			const current = get(sessionStore).active;
			if (current) {
				elapsed = (now - recordingStarted) / 1000;
				if (fresh) invalidSince = 0;
				else if (!invalidSince) invalidSince = now;
				const reason =
					invalidSince && now - invalidSince >= 1000
						? 'Нет валидного сигнала более секунды. Проверьте платформу.'
						: '';
				if (
					!stopping &&
					view === 'measure' &&
					(reason ||
						(current.protocol.durationSeconds && elapsed >= current.protocol.durationSeconds))
				) {
					stopping = true;
					void finish(reason)
						.catch((e) => (error = e.message))
						.finally(() => (stopping = false));
				}
			}
		}, 200);
		const completed = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			const result: Record<string, number | string | boolean> = {};
			for (const [key, value] of Object.entries(detail))
				if (['string', 'number', 'boolean'].includes(typeof value))
					result[key] = value as number | string | boolean;
			if (detail.stages) result.stages = JSON.stringify(detail.stages);
			void run(async () => {
				await sessionStore.stop('', result);
				view = 'history';
			});
		};
		const stopped = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			lastGameResult = {};
			for (const [key, value] of Object.entries(detail))
				if (['string', 'number', 'boolean'].includes(typeof value))
					lastGameResult[key] = value as number | string | boolean;
			if (detail.stages) lastGameResult.stages = JSON.stringify(detail.stages);
		};
		const unload = (event: BeforeUnloadEvent) => {
			if (get(sessionStore).active) {
				void sessionStore.flush();
				event.preventDefault();
				event.returnValue = '';
			}
		};
		const checkpoint = () => {
			void sessionStore.flush().catch(() => {});
		};
		window.addEventListener('gameStopped', stopped);
		window.addEventListener('gameCompleted', completed);
		window.addEventListener('beforeunload', unload);
		window.addEventListener('pagehide', checkpoint);
		return () => {
			clearInterval(timer);
			observers.forEach((u) => u());
			window.removeEventListener('gameStopped', stopped);
			window.removeEventListener('gameCompleted', completed);
			window.removeEventListener('beforeunload', unload);
			window.removeEventListener('pagehide', checkpoint);
			checkpoint();
			wsClient.disconnect();
		};
	});
</script>

<svelte:head
	><title>Stabilometer · Баланс и движение</title><meta
		name="description"
		content="Измерение центра давления, тренировка равновесия и локальная история результатов"
	/></svelte:head
>
<div class="app-shell">
	<aside class="navigation">
		<a class="brand" href="/" aria-label="Stabilometer"
			><span class="brand-icon">s<span>·</span></span>
			<div>stabilometer<small>БАЛАНС И ДВИЖЕНИЕ</small></div></a
		>
		<div class="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
		<nav aria-label="Разделы приложения">
			{#each nav as item}<button
					class:current={view === item.id}
					disabled={locked}
					on:click={() => {
						view = item.id;
						fresh = false;
						error = '';
					}}
					><span class="nav-mark">{item.mark}</span>{item.label}{#if item.id === 'history'}<span
							class="nav-count">{$sessionStore.sessions.length}</span
						>{/if}</button
				>{/each}
		</nav>
		<div class="nav-bottom">
			<span class="status-dot" class:online={$stabilogramStore.isWsConnected}
			></span>{$stabilogramStore.isWsConnected
				? 'Локальный сервер доступен'
				: 'Нет связи с сервером'}<small>Данные хранятся на этом компьютере</small><span
				class="version">Версия 1.1 · локальная работа</span
			>
		</div>
	</aside>
	<div class="workspace">
		<header class="topbar">
			<span
				>Рабочее пространство <span class="crumb">/ {nav.find((n) => n.id === view)?.label}</span
				></span
			>
			<div class="top-status">
				<span class="status-dot" class:online={fresh}></span>{fresh
					? 'Сигнал поступает'
					: $stabilogramStore.isDeviceConnected
						? 'Ожидание нагрузки'
						: 'Платформа не подключена'}{#if $stabilogramStore.demo}<span class="badge demo"
						>Демо</span
					>{/if}
			</div>
		</header>
		<main>
			{#if error || $sessionStore.error}<div class="notice danger alert" role="alert">
					<span>{error || $sessionStore.error}</span>{#if !$sessionStore.initialized}<button
							class="button"
							on:click={() => run(() => sessionStore.initialize())}>Повторить</button
						>{/if}<button
						aria-label="Закрыть сообщение"
						on:click={() => {
							error = '';
							sessionStore.clearError();
						}}>×</button
					>
				</div>{/if}
			{#if !$sessionStore.initialized}<div class="notice">Открываем локальный архив…</div>{/if}
			<div class="page-heading">
				<div>
					<div class="eyebrow">
						STABILOMETER / {view === 'measure'
							? 'ASSESSMENT'
							: view === 'training'
								? 'BIOFEEDBACK'
								: view === 'history'
									? 'RECORDS'
									: view === 'participants'
										? 'PARTICIPANTS'
										: 'SETUP'}
					</div>
					<h1>
						{view === 'measure'
							? 'Измерение равновесия'
							: view === 'training'
								? 'Тренировка с обратной связью'
								: view === 'participants'
									? 'Участники'
									: view === 'history'
										? 'История и результаты'
										: 'Подготовка устройства'}
					</h1>
					<p>
						{view === 'measure'
							? 'Подготовьте участника, проведите запись и сохраните результат.'
							: view === 'training'
								? 'Управляйте корзиной перемещением центра давления.'
								: view === 'participants'
									? 'Карточки участников и история их измерений.'
									: view === 'history'
										? 'Полные записи, показатели и сравнение сессий.'
										: 'Подключение, калибровка и ориентация платформы.'}
					</p>
				</div>
				{#if active}<span class="badge recording">● Запись · {Math.floor(elapsed)} с</span>{/if}
			</div>
			{#if view === 'device'}<ControlPanel {locked} />
			{:else if view === 'participants'}
				<div class="two-column">
					<section class="card">
						<div class="section-label">НОВЫЙ УЧАСТНИК</div>
						<h2>{editingParticipantId ? 'Редактирование карточки' : 'Карточка участника'}</h2>
						<form on:submit|preventDefault={addParticipant}>
							<label
								>Имя или код участника<input
									required
									maxlength="200"
									bind:value={newName}
									placeholder="Например, Участник 001"
								/></label
							><label
								>Примечание<textarea
									maxlength="10000"
									bind:value={newNotes}
									placeholder="Дополнительная информация"
								></textarea></label
							><button
								class="button primary"
								disabled={busy || !$sessionStore.initialized || !newName.trim()}
								>{editingParticipantId
									? 'Сохранить карточку'
									: 'Создать и перейти к измерению'}</button
							>{#if editingParticipantId}<button
									type="button"
									class="text-button"
									on:click={() => {
										editingParticipantId = '';
										newName = '';
										newNotes = '';
									}}>Отменить редактирование</button
								>{/if}
						</form>
					</section>
					<section class="card">
						<div class="section-label">ЛОКАЛЬНАЯ КАРТОТЕКА</div>
						<h2>Все участники <span class="muted">{$sessionStore.participants.length}</span></h2>
						<input
							aria-label="Поиск участника"
							bind:value={search}
							placeholder="Поиск по имени или примечанию"
						/>
						<div class="participant-list">
							{#each visibleParticipants as p}<div class="participant-row">
									<button
										class="participant-item"
										on:click={() => {
											participantId = p.id;
											view = 'measure';
										}}
										><span class="avatar">{p.name.slice(0, 1).toUpperCase()}</span><span
											><strong>{p.name}</strong><small>{p.notes || 'Без примечания'}</small></span
										><span class="muted">→</span></button
									>
									<div class="participant-actions">
										<button
											class="text-button"
											on:click={() => {
												editingParticipantId = p.id;
												newName = p.name;
												newNotes = p.notes;
											}}>Изменить</button
										><button
											class="text-button"
											disabled={busy}
											on:click={() => removeParticipant(p.id)}>Удалить</button
										>
									</div>
								</div>{:else}<div class="empty">
									Участников пока нет. Создайте первую карточку.
								</div>{/each}
						</div>
					</section>
				</div>
			{:else if view === 'measure' || view === 'training'}
				<div class="measurement-layout">
					<aside class="setup-stack">
						<section class="card">
							<div class="section-label">01 · УЧАСТНИК</div>
							<label
								>Выберите участника<select bind:value={participantId} disabled={locked}
									><option value="">Выберите из картотеки</option
									>{#each $sessionStore.participants as p}<option value={p.id}>{p.name}</option
										>{/each}</select
								></label
							><button
								class="text-button"
								disabled={locked}
								on:click={() => (view = 'participants')}>+ Добавить участника</button
							>{#if participant?.notes}<p class="small muted">{participant.notes}</p>{/if}
						</section>
						{#if view === 'measure'}<section class="card">
								<div class="section-label">02 · УСЛОВИЯ ЗАПИСИ</div>
								<label
									>Протокол<select bind:value={protocolId} disabled={locked}
										><option value="eyes-open">Стойка · глаза открыты</option><option
											value="eyes-closed">Стойка · глаза закрыты</option
										><option value="free">Свободная запись</option></select
									></label
								><label
									>Длительность<select bind:value={duration} disabled={locked}
										>{#each [30, 60, 120] as seconds}<option value={seconds}
												>{seconds} секунд</option
											>{/each}</select
									></label
								><label
									>Положение стоп<input
										bind:value={stance}
										maxlength="200"
										disabled={locked}
									/></label
								>
								<p class="small muted">
									Условия задаёт специалист. При обследовании экран с траекторией предназначен для
									оператора.
								</p>
							</section>
						{:else}<section class="card">
								<div class="section-label">02 · ПАРАМЕТРЫ ТРЕНИРОВКИ</div>
								<label
									>Сложность<select bind:value={difficulty} disabled={locked}
										><option value={0}>Легко</option><option value={1}>Средне</option><option
											value={2}>Сложно</option
										></select
									></label
								>
								<p class="small muted">
									Ловите целевые шары, удерживая корзину на цели. Этапы меняются автоматически.
									Тряска не отменяет удержание.
								</p>
							</section>{/if}
						<section class="card">
							<div class="section-label">03 · ГОТОВНОСТЬ</div>
							<div class="check-line">
								<span class="status-dot" class:online={!!participantId}></span>Участник выбран
							</div>
							<div class="check-line">
								<span
									class="status-dot"
									class:online={$stabilogramStore.isCalibrated || $stabilogramStore.demo}
								></span>{$stabilogramStore.demo
									? 'Демонстрационные данные'
									: 'Калибровка платформы'}
							</div>
							<div class="check-line">
								<span class="status-dot" class:online={fresh}></span>Валидный сигнал
							</div>
							{#if active}<button
									class="button danger"
									disabled={busy}
									on:click={() => run(() => finish('Остановлено оператором'))}
									>Остановить и сохранить</button
								>{#if view === 'training'}<button
										class="button"
										on:click={() => window.dispatchEvent(new CustomEvent('gamePause'))}
										>{$gameStateStore.isPaused ? 'Продолжить тренировку' : 'Пауза'}</button
									>{/if}
							{:else if countdown}<button class="button" on:click={() => (countdown = 0)}
									>Отменить старт · {countdown}</button
								>
							{:else}<button
									class="button primary"
									disabled={busy ||
										!$sessionStore.initialized ||
										!participantId ||
										!fresh ||
										(!$stabilogramStore.isCalibrated && !$stabilogramStore.demo)}
									on:click={() => (view === 'measure' ? prepare() : run(() => begin(true)))}
									>{view === 'measure' ? 'Начать измерение' : 'Начать тренировку'}
									<span>→</span></button
								>{/if}
							<button class="text-button" disabled={locked} on:click={() => (view = 'device')}
								>Настроить устройство</button
							>
						</section>
					</aside>
					<div class="visual-stack">
						{#if $stabilogramStore.demo}<div class="notice demo-notice">
								Демонстрация: искусственный сигнал. Такие записи отмечаются в архиве и отчётах.
							</div>{/if}
						{#if view === 'measure'}<MedicalStabilogramCanvas />{:else}<BallCatcherCanvas
								width={1000}
								height={650}
								showDebug={false}
								hideGameControls={true}
							/>{/if}
						{#if countdown}<div class="notice countdown">
								Подготовьтесь. Начало через {countdown}…
							</div>{/if}
						<div class="metric-grid">
							<div class="metric">
								<span>Длина траектории</span><strong
									>{number(active?.metrics.pathLengthMm)}<small>мм</small></strong
								>
							</div>
							<div class="metric">
								<span>Средняя скорость</span><strong
									>{number(active?.metrics.meanVelocityMmS)}<small>мм/с</small></strong
								>
							</div>
							<div class="metric">
								<span>Валидные отсчёты</span><strong>{active?.metrics.validCount ?? '—'}</strong>
							</div>
							<div class="metric">
								<span>Частота приёма</span><strong
									>{fresh ? $stabilogramStore.packetRate : '—'}<small>Гц</small></strong
								>
							</div>
						</div>
						<p class="small muted">
							Расчёт по отсчётам платформы до визуального сглаживания. Пропуски отмечаются и не
							соединяются в траектории.
						</p>
						{#if active}<div class="notice">
								{$sessionStore.saving
									? 'Сохранение контрольной точки…'
									: $sessionStore.lastSavedAt
										? `Автосохранение: ${new Date($sessionStore.lastSavedAt).toLocaleTimeString('ru-RU')}`
										: 'Подготовка записи'} · замечаний к качеству: {active.quality.length}
							</div>{/if}
					</div>
				</div>
			{:else if view === 'history'}
				<section class="card archive-toolbar">
					<label
						>Участник<select bind:value={filter}
							><option value="">Все участники</option>{#each $sessionStore.participants as p}<option
									value={p.id}>{p.name}</option
								>{/each}</select
						></label
					>
					<div class="actions">
						<button
							class="button"
							disabled={busy}
							on:click={() =>
								run(async () =>
									download(
										await sessionStore.exportBackup(),
										`stabilometer-backup-${new Date().toISOString().slice(0, 10)}.json`
									)
								)}>Резервная копия</button
						><label class="button file-button"
							>Восстановить архив<input
								type="file"
								accept="application/json,.json"
								disabled={busy}
								on:change={importArchive}
							/></label
						>
					</div>
				</section>
				<div class="records-layout">
					<section class="card record-list">
						<div class="section-label">ЗАПИСИ · {visibleSessions.length}</div>
						{#each visibleSessions as record}<button
								class="record-item"
								class:selected-record={selected?.id === record.id}
								on:click={() => openSession(record.id)}
								><div>
									<strong>{name(record.participantId)}</strong>{#if record.demo}<span
											class="badge demo">Демо</span
										>{/if}
								</div>
								<span>{record.protocol.name}</span><small
									>{date(record.startedAt)} · {number(record.metrics.durationSeconds)} с</small
								><small class:warn={record.status === 'interrupted'}
									>{record.status === 'completed' ? 'Завершена' : 'Прервана'} · {record.metrics
										.sampleCount} отсчётов</small
								></button
							>{:else}<div class="empty">
								Сохранённых записей пока нет. Проведите первое измерение.
							</div>{/each}
					</section>
					<div class="visual-stack">
						{#if selected}<section class="card result-heading">
								<div>
									<div class="section-label">РЕЗУЛЬТАТ СЕССИИ</div>
									<h2>{name(selected.participantId)}</h2>
									<p class="muted">{selected.protocol.name} · {date(selected.startedAt)}</p>
								</div>
								<div class="actions">
									<button class="button" on:click={() => exportSelected('csv')}>CSV</button><button
										class="button"
										on:click={() => exportSelected('json')}>JSON</button
									><button class="button primary" on:click={showReport}>Отчёт / PDF</button><button
										class="button danger"
										disabled={busy}
										on:click={removeSession}>Удалить</button
									>
								</div>
							</section>
							{#if selected.demo}<div class="notice demo-notice">
									Демонстрационная запись
								</div>{/if}{#if selected.status === 'interrupted'}<div class="notice warning">
									{selected.stopReason}
								</div>{/if}
							<MedicalStabilogramCanvas session={selected} /><SessionSignals session={selected}/>
							<div class="metric-grid">
								<div class="metric">
									<span>Длина траектории</span><strong
										>{number(selected.metrics.pathLengthMm)}<small>мм</small></strong
									>
								</div>
								<div class="metric">
									<span>Средняя скорость</span><strong
										>{number(selected.metrics.meanVelocityMmS)}<small>мм/с</small></strong
									>
								</div>
								<div class="metric">
									<span>Эллипс 95%</span><strong
										>{number(selected.metrics.ellipse95Mm2)}<small>мм²</small></strong
									>
								</div>
								<div class="metric">
									<span>Длительность данных</span><strong
										>{number(selected.metrics.durationSeconds)}<small>с</small></strong
									>
								</div>
							</div>
							<section class="card">
								<h3>Показатели и качество</h3>
								<dl class="details-grid">
									<div>
										<dt>Среднее X / Y, мм</dt>
										<dd>{number(selected.metrics.meanX)} / {number(selected.metrics.meanY)}</dd>
									</div>
									<div>
										<dt>Отклонение X / Y, мм</dt>
										<dd>{number(selected.metrics.stdX)} / {number(selected.metrics.stdY)}</dd>
									</div>
									<div>
										<dt>Размах X / Y, мм</dt>
										<dd>{number(selected.metrics.rangeX)} / {number(selected.metrics.rangeY)}</dd>
									</div>
									<div>
										<dt>Валидных / всего</dt>
										<dd>{selected.metrics.validCount} / {selected.metrics.sampleCount}</dd>
									</div>
								</dl>
								{#if selected.gameResult}<h3>Тренировка</h3>
									<div class="notice">
										Очки: {selected.gameResult.score ?? '—'} · поймано: {selected.gameResult
											.catchCount ?? '—'} · ошибок: {selected.gameResult.wrongCatchCount ?? '—'}
									</div>{/if}
								<details>
									<summary>Замечания к записи ({selected.quality.length})</summary
									>{#each selected.quality as q}<p class="small">
											{number(q.atMs / 1000)} с · {q.detail}
										</p>{:else}<p class="small muted">
											Событий качества не зарегистрировано.
										</p>{/each}
								</details>
								<details>
									<summary>Метод расчёта</summary>
									<p class="small muted">{selected.metadata.method}</p>
									<p class="small">Версия: {selected.metadata.algorithmVersion}</p>
								</details>
								<label
									>Комментарий специалиста<textarea bind:value={note} maxlength="10000"
									></textarea></label
								><button
									class="button"
									disabled={busy || note === selected.notes}
									on:click={() => run(() => sessionStore.setNotes(note))}
									>Сохранить комментарий</button
								>
							</section>
							<section class="card">
								<h3>Сравнение с другой записью</h3>
								<select aria-label="Запись для сравнения" bind:value={compareId} on:change={compare}
									><option value="">Выберите запись</option
									>{#each $sessionStore.sessions.filter((s) => s.id !== selected?.id && s.participantId === selected?.participantId) as record}<option
											value={record.id}>{date(record.startedAt)} · {record.protocol.name}</option
										>{/each}</select
								>
								{#if comparison}{#each compareWarnings as warning}<p class="small warn">
											{warning}
										</p>{/each}
									<div class="table-scroll">
										<table>
											<thead
												><tr
													><th>Показатель</th><th>Текущая</th><th>Сравнение</th><th>Разница</th></tr
												></thead
											><tbody
												>{#each comparisonRows as metric}<tr
														><td>{metric.label}</td><td>{number(metric.a)}</td><td
															>{number(metric.b)}</td
														><td>{number(metric.a - metric.b)}</td></tr
													>{/each}</tbody
											>
										</table>
									</div>
									<p class="small muted">
										Разница не является автоматическим заключением об улучшении или ухудшении.
									</p>{/if}
							</section>
						{:else}<div class="card empty large-empty">
								<div class="empty-symbol">↗</div>
								<h2>Выберите запись</h2>
								<p>Здесь появятся траектория, показатели и отчёт.</p>
							</div>{/if}
					</div>
				</div>
				<p class="small muted">
					Архив хранится в этом браузере для адреса приложения. Скачивайте резервную копию перед
					очисткой браузера или переносом на другой компьютер.
				</p>
			{/if}
		</main>
		<footer>
			<span>Stabilometer · измерения и тренировка равновесия</span><span
				>Локальный архив · автосохранение каждые 2 секунды</span
			>
		</footer>
	</div>
</div>
{#if reportHTML}<div
		class="report-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Отчёт сессии"
	>
		<div class="report-bar">
			<span>Отчёт · используйте «Печать / сохранить PDF» внутри документа</span><button
				class="button"
				on:click={() => (reportHTML = '')}>Закрыть</button
			>
		</div>
		<iframe title="Печатный отчёт сессии" srcdoc={reportHTML}></iframe>
	</div>{/if}
