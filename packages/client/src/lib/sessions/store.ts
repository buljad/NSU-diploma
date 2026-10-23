import { get, writable } from 'svelte/store';
import type { StabilogramSample } from '@stabilometer/shared';
import { SessionRecorder, newId } from './recorder';
import { SessionRepository, summary } from './repository';
import { parseBackup, validateParticipant } from './validation';
import type {
	BeginSessionOptions,
	MeasurementSession,
	Participant,
	SessionBackup,
	SessionSummary
} from './types';

export interface SessionsState {
	initialized: boolean;
	participants: Participant[];
	sessions: SessionSummary[];
	active: SessionSummary | null;
	selected: MeasurementSession | null;
	error: string | null;
	saving: boolean;
	lastSavedAt: number | null;
}

function createSessionStore() {
	const state = writable<SessionsState>({
		initialized: false,
		participants: [],
		sessions: [],
		active: null,
		selected: null,
		error: null,
		saving: false,
		lastSavedAt: null
	});
	const repository = new SessionRepository();
	let recorder: SessionRecorder | null = null;
	let lastSession: MeasurementSession | null = null;
	let initial: Promise<void> | null = null;
	let autosave: ReturnType<typeof setInterval> | null = null;
	let publisher: ReturnType<typeof setInterval> | null = null;
	let queue = Promise.resolve();
	let releaseOwnership: (() => void) | null = null;
	const savedCounts = new Map<string, number>();
	const deletedParticipants = new Set<string>();

	async function acquireOwnership(): Promise<void> {
		if (releaseOwnership) return;
		if (typeof navigator === 'undefined' || !navigator.locks) {
			throw new Error(
				'Для безопасного локального архива нужен современный браузер и адрес localhost. Блокировка хранилища недоступна.'
			);
		}
		await new Promise<void>((resolve, reject) => {
			void navigator.locks
				.request('stabilometer-archive-v1', { ifAvailable: true }, async (lock) => {
					if (!lock) {
						reject(new Error('Архив открыт в другой вкладке. Закройте её и повторите действие.'));
						return;
					}
					await new Promise<void>((release) => {
						releaseOwnership = release;
						resolve();
					});
				})
				.catch(reject);
		});
	}

	function fail(error: unknown): void {
		state.update((s) => ({
			...s,
			error: error instanceof Error ? error.message : String(error),
			saving: false
		}));
	}
	async function refresh(): Promise<void> {
		const [participants, sessions] = await Promise.all([
			repository.listParticipants(),
			repository.listSessions()
		]);
		state.update((s) => ({
			...s,
			participants: participants.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
			sessions
		}));
	}
	function publish(): void {
		if (!recorder) return;
		recorder.updateMetrics();
		state.update((s) => ({ ...s, active: summary(recorder!.session) }));
	}
	function persist(session: MeasurementSession): Promise<void> {
		const task = queue
			.catch(() => {})
			.then(async () => {
				// A queued autosave must never recreate data after the user deletes the participant.
				if (deletedParticipants.has(session.participantId)) return;
				state.update((s) => ({ ...s, saving: true }));
				if (recorder?.session === session) recorder.updateMetrics();
				const count = session.samples.length;
				await repository.saveSession(session, savedCounts.get(session.id) ?? 0);
				savedCounts.set(session.id, count);
				state.update((s) => ({ ...s, saving: false, lastSavedAt: Date.now() }));
			});
		queue = task;
		return task.catch((error) => {
			fail(error);
			throw error;
		});
	}
	async function initialize(): Promise<void> {
		if (initial) return initial;
		initial = (async () => {
			await acquireOwnership();
			const drafts = (await repository.listSessions()).filter((s) => s.status === 'recording');
			for (const header of drafts) {
				const session = await repository.loadSession(header.id);
				if (!session) continue;
				session.status = 'interrupted';
				session.stopReason = 'Восстановлена незавершённая запись после закрытия приложения';
				session.endedAt = session.startedAt + session.metrics.durationSeconds * 1000;
				session.quality.push({
					code: 'interrupted',
					atMs: session.metrics.durationSeconds * 1000,
					detail: session.stopReason
				});
				await repository.saveSession(session, session.samples.length);
			}
			await refresh();
			state.update((s) => ({ ...s, initialized: true }));
		})().catch((error) => {
			releaseOwnership?.();
			releaseOwnership = null;
			initial = null;
			fail(error);
			throw error;
		});
		return initial;
	}
	async function saveParticipant(input: {
		id?: string;
		name: string;
		notes?: string;
	}): Promise<Participant> {
		await initialize();
		const existing = get(state).participants.find((p) => p.id === input.id);
		const participant: Participant = {
			id: input.id ?? newId(),
			name: input.name.trim(),
			notes: input.notes ?? '',
			createdAt: existing?.createdAt ?? Date.now()
		};
		validateParticipant(participant);
		try {
			await repository.saveParticipant(participant);
			await refresh();
			return participant;
		} catch (error) {
			fail(error);
			throw error;
		}
	}
	async function begin(options: BeginSessionOptions): Promise<void> {
		await initialize();
		if (recorder) throw new Error('Сначала завершите текущую запись.');
		if (!get(state).participants.some((p) => p.id === options.participantId))
			throw new Error('Выберите участника.');
		if (deletedParticipants.has(options.participantId))
			throw new Error('Участник удаляется. Выберите другого участника.');
		const created = new SessionRecorder(options);
		recorder = created;
		lastSession = created.session;
		publish();
		state.update((s) => ({ ...s, selected: null, error: null }));
		try {
			await persist(created.session);
		} catch (error) {
			recorder = null;
			state.update((s) => ({ ...s, active: null }));
			throw error;
		}
		if (recorder !== created) return;
		publisher = setInterval(publish, 200);
		autosave = setInterval(() => {
			void flush().catch(() => {});
		}, 2000);
	}
	function ingest(sample: StabilogramSample, receivedAt?: number): void {
		recorder?.ingest(sample, receivedAt);
	}
	async function flush(): Promise<void> {
		if (recorder) recorder.updateMetrics();
		const session = recorder?.session ?? lastSession;
		if (session) await persist(session);
	}
	async function stop(
		reason = '',
		gameResult?: Record<string, number | string | boolean>
	): Promise<MeasurementSession | null> {
		if (!recorder) return null;
		if (autosave) clearInterval(autosave);
		if (publisher) clearInterval(publisher);
		autosave = publisher = null;
		const session = recorder.stop(reason, gameResult);
		recorder = null;
		lastSession = session;
		state.update((s) => ({ ...s, active: null, selected: structuredClone(session) }));
		await persist(session);
		await refresh();
		return session;
	}
	async function select(id: string): Promise<void> {
		if (recorder) throw new Error('Просмотр архива доступен после завершения записи.');
		try {
			const selected = await repository.loadSession(id);
			if (!selected) throw new Error('Запись не найдена.');
			state.update((s) => ({ ...s, selected }));
		} catch (error) {
			fail(error);
			throw error;
		}
	}
	async function deleteSession(id: string): Promise<void> {
		if (recorder) throw new Error('Удаление доступно после завершения записи.');
		try {
			await queue.catch(() => {});
			await repository.deleteSession(id);
			if (lastSession?.id === id) lastSession = null;
			savedCounts.delete(id);
			state.update((s) => ({ ...s, selected: s.selected?.id === id ? null : s.selected }));
			await refresh();
		} catch (error) {
			fail(error);
			throw error;
		}
	}
	async function deleteParticipant(id: string): Promise<void> {
		if (recorder) throw new Error('Завершите запись перед удалением участника.');
		await initialize();
		if (deletedParticipants.has(id)) return;
		deletedParticipants.add(id);
		const previousLast = lastSession?.participantId === id ? lastSession : null;
		if (previousLast) lastSession = null;
		const task = queue
			.catch(() => {})
			.then(async () => {
				state.update((s) => ({ ...s, saving: true }));
				await repository.deleteParticipant(id);
				for (const session of get(state).sessions) {
					if (session.participantId === id) savedCounts.delete(session.id);
				}
				state.update((s) => ({
					...s,
					saving: false,
					selected: s.selected?.participantId === id ? null : s.selected
				}));
				await refresh();
			});
		queue = task;
		try {
			await task;
		} catch (error) {
			deletedParticipants.delete(id);
			if (!lastSession && !recorder) lastSession = previousLast;
			fail(error);
			throw error;
		}
	}
	async function setNotes(notes: string): Promise<void> {
		if (notes.length > 10000) throw new Error('Примечание не должно превышать 10000 символов.');
		if (recorder) {
			recorder.session.notes = notes;
			publish();
			return;
		}
		const selected = get(state).selected;
		if (!selected) return;
		const session = { ...selected, notes };
		lastSession = session;
		state.update((s) => ({ ...s, selected: session }));
		await persist(session);
		await refresh();
	}
	async function exportBackup(): Promise<string> {
		await initialize();
		await flush();
		const participants = await repository.listParticipants();
		const sessions: MeasurementSession[] = [];
		for (const header of await repository.listSessions()) {
			const session = await repository.loadSession(header.id);
			if (session) sessions.push(session);
		}
		const backup: SessionBackup = {
			format: 'stabilometer-backup',
			version: 1,
			exportedAt: Date.now(),
			participants,
			sessions
		};
		return JSON.stringify(backup);
	}
	async function importBackup(text: string): Promise<void> {
		if (recorder) throw new Error('Завершите запись перед восстановлением архива.');
		const backup = parseBackup(text); // Fully validate before the first database mutation.
		await initialize();
		try {
			await queue.catch(() => {});
			await repository.importBackup(backup);
			savedCounts.clear();
			deletedParticipants.clear();
			lastSession = null;
			state.update((s) => ({ ...s, selected: null }));
			await refresh();
		} catch (error) {
			fail(error);
			throw error;
		}
	}
	return {
		subscribe: state.subscribe,
		initialize,
		saveParticipant,
		begin,
		ingest,
		stop,
		flush,
		select,
		deleteSession,
		deleteParticipant,
		setNotes,
		exportBackup,
		importBackup,
		clearError: () => state.update((s) => ({ ...s, error: null }))
	};
}

export const sessionStore = createSessionStore();
