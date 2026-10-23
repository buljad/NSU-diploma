import type { MeasurementSession, Participant, SessionBackup, SessionSummary } from './types';

const DB_NAME = 'stabilometer-sessions-v1';
const HEADER = 'sessions';
const POINTS = 'samples';
const PEOPLE = 'participants';
// Chunking avoids rewriting an entire growing record at every autosave.
const CHUNK = 256;

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error('Операция сохранения отменена.'));
		tx.onerror = () => reject(tx.error ?? new Error('Ошибка локального хранилища.'));
	});
}
function result<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
export function summary(session: MeasurementSession): SessionSummary {
	const { samples: _, ...header } = session;
	return structuredClone(header);
}

export class SessionRepository {
	private database: Promise<IDBDatabase> | null = null;
	private open(): Promise<IDBDatabase> {
		if (!this.database)
			this.database = new Promise((resolve, reject) => {
				if (typeof indexedDB === 'undefined') {
					reject(new Error('Браузер не поддерживает IndexedDB. Сохранение недоступно.'));
					return;
				}
				const request = indexedDB.open(DB_NAME, 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					db.createObjectStore(HEADER, { keyPath: 'id' });
					db.createObjectStore(POINTS, { keyPath: ['sessionId', 'index'] });
					db.createObjectStore(PEOPLE, { keyPath: 'id' });
				};
				request.onerror = () => {
					this.database = null;
					reject(request.error);
				};
				request.onblocked = () => {
					this.database = null;
					reject(new Error('Закройте другие вкладки приложения для обновления хранилища.'));
				};
				request.onsuccess = () => {
					request.result.onversionchange = () => {
						request.result.close();
						this.database = null;
					};
					resolve(request.result);
				};
			});
		return this.database;
	}

	async listParticipants(): Promise<Participant[]> {
		const db = await this.open();
		return result(db.transaction(PEOPLE).objectStore(PEOPLE).getAll());
	}
	async saveParticipant(participant: Participant): Promise<void> {
		const db = await this.open();
		const tx = db.transaction(PEOPLE, 'readwrite');
		const completed = done(tx);
		tx.objectStore(PEOPLE).put(participant);
		await completed;
	}
	async listSessions(): Promise<SessionSummary[]> {
		const db = await this.open();
		const rows: SessionSummary[] = await result(
			db.transaction(HEADER).objectStore(HEADER).getAll()
		);
		return rows.sort((a, b) => b.startedAt - a.startedAt);
	}
	async loadSession(id: string): Promise<MeasurementSession | null> {
		const db = await this.open();
		const tx = db.transaction([HEADER, POINTS]);
		const [header, chunks] = await Promise.all([
			result<SessionSummary | undefined>(tx.objectStore(HEADER).get(id)),
			result<Array<{ index: number; points: MeasurementSession['samples'] }>>(
				tx.objectStore(POINTS).getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
			)
		]);
		if (!header) return null;
		chunks.sort((a, b) => a.index - b.index);
		return { ...header, samples: chunks.flatMap((c) => c.points) };
	}
	async saveSession(session: MeasurementSession, savedCount = 0): Promise<void> {
		const header = summary(session);
		const chunks: Array<{
			sessionId: string;
			index: number;
			points: MeasurementSession['samples'];
		}> = [];
		for (
			let start = Math.floor(savedCount / CHUNK) * CHUNK;
			start < session.samples.length;
			start += CHUNK
		) {
			chunks.push({
				sessionId: session.id,
				index: start / CHUNK,
				points: session.samples.slice(start, start + CHUNK)
			});
		}
		const db = await this.open();
		const tx = db.transaction([HEADER, POINTS], 'readwrite');
		const completed = done(tx);
		tx.objectStore(HEADER).put(header);
		for (const chunk of chunks) tx.objectStore(POINTS).put(chunk);
		await completed;
	}
	async deleteSession(id: string): Promise<void> {
		const db = await this.open();
		const tx = db.transaction([HEADER, POINTS], 'readwrite');
		const completed = done(tx);
		tx.objectStore(HEADER).delete(id);
		tx.objectStore(POINTS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
		await completed;
	}
	/** Delete a participant and all their records in one transaction, leaving other people untouched. */
	async deleteParticipant(id: string): Promise<void> {
		const db = await this.open();
		const tx = db.transaction([PEOPLE, HEADER, POINTS], 'readwrite');
		const completed = done(tx);
		tx.objectStore(PEOPLE).delete(id);
		const cursor = tx.objectStore(HEADER).openCursor();
		cursor.onsuccess = () => {
			const row = cursor.result;
			if (!row) return;
			const session = row.value as SessionSummary;
			if (session.participantId === id) {
				row.delete();
				tx.objectStore(POINTS).delete(
					IDBKeyRange.bound([session.id, 0], [session.id, Number.MAX_SAFE_INTEGER])
				);
			}
			row.continue();
		};
		await completed;
	}
	/** Caller validates the whole archive first. All replacement writes commit together or none do. */
	async importBackup(backup: SessionBackup): Promise<void> {
		const db = await this.open();
		const tx = db.transaction([HEADER, POINTS, PEOPLE], 'readwrite');
		const completed = done(tx);
		try {
			for (const person of backup.participants) tx.objectStore(PEOPLE).put(person);
			for (const session of backup.sessions) {
				tx.objectStore(HEADER).put(summary(session));
				tx.objectStore(POINTS).delete(
					IDBKeyRange.bound([session.id, 0], [session.id, Number.MAX_SAFE_INTEGER])
				);
				for (let start = 0; start < session.samples.length; start += CHUNK) {
					tx.objectStore(POINTS).put({
						sessionId: session.id,
						index: start / CHUNK,
						points: session.samples.slice(start, start + CHUNK)
					});
				}
			}
		} catch (error) {
			tx.abort();
			await completed.catch(() => {});
			throw error;
		}
		await completed;
	}
}
