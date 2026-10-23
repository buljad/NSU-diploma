import { calculateMetrics } from './metrics';
import type { MeasurementSession, Participant, SessionBackup } from './types';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Некорректный архив: ${message}`);
}
const object = (v: unknown): v is Record<string, any> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const string = (v: unknown, max = 10000): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => string(v, 200) && v.length > 0;

export function validateParticipant(value: unknown): asserts value is Participant {
	assert(
		object(value) &&
			id(value.id) &&
			string(value.name, 200) &&
			value.name.trim().length > 0 &&
			string(value.notes) &&
			finite(value.createdAt),
		'карточка участника'
	);
}

export function validateSession(value: unknown): asserts value is MeasurementSession {
	assert(object(value), 'формат сессии');
	const s = value;
	assert(
		s.schemaVersion === 1 && id(s.id) && id(s.participantId),
		'версия или идентификатор сессии'
	);
	assert(
		typeof s.demo === 'boolean' && finite(s.startedAt) && (s.endedAt === null || finite(s.endedAt)),
		'даты сессии'
	);
	assert(
		['recording', 'completed', 'interrupted'].includes(s.status) &&
			string(s.stopReason) &&
			string(s.notes),
		'статус сессии'
	);
	assert(
		object(s.protocol) &&
			id(s.protocol.id) &&
			string(s.protocol.name, 200) &&
			['open', 'closed', 'unspecified'].includes(s.protocol.eyes),
		'протокол'
	);
	assert(
		s.protocol.durationSeconds === undefined ||
			(finite(s.protocol.durationSeconds) && s.protocol.durationSeconds > 0),
		'длительность протокола'
	);
	assert(s.protocol.notes === undefined || string(s.protocol.notes), 'примечания протокола');
	assert(s.protocol.stance === undefined || string(s.protocol.stance, 1000), 'положение стоп');
	const m = s.metadata;
	assert(
		object(m) &&
			m.algorithmVersion === 'cop-acquisition-v1' &&
			m.coordinateSource === 'centered' &&
			string(m.appVersion, 50) &&
			string(m.method) &&
			m.gapThresholdMs === 250,
		'метод расчёта'
	);
	assert(
		object(m.axes) &&
			['swapXY', 'invertX', 'invertY'].every((k) => typeof m.axes[k] === 'boolean') &&
			finite(m.axes.rotationDeg),
		'настройка осей'
	);
	if (m.calibration !== null) {
		const c = m.calibration;
		assert(
			object(c) &&
				object(c.sensorOffsets) &&
				['d1', 'd2', 'd3', 'd4'].every((k) => finite(c.sensorOffsets[k])) &&
				object(c.platformSize) &&
				finite(c.platformSize.width) &&
				c.platformSize.width > 0 &&
				finite(c.platformSize.height) &&
				c.platformSize.height > 0 &&
				object(c.sensorDistance) &&
				finite(c.sensorDistance.x) &&
				c.sensorDistance.x > 0 &&
				finite(c.sensorDistance.y) &&
				c.sensorDistance.y > 0 &&
				finite(c.timestamp) &&
				finite(c.sampleCount) &&
				typeof c.isValid === 'boolean',
			'калибровка'
		);
	}
	assert(Array.isArray(s.samples) && s.samples.length <= 5_000_000, 'массив отсчётов');
	let previousTime = -1;
	for (const p of s.samples) {
		assert(
			object(p) &&
				finite(p.timeMs) &&
				p.timeMs >= 0 &&
				p.timeMs >= previousTime &&
				finite(p.receivedAt) &&
				typeof p.valid === 'boolean' &&
				typeof p.breakBefore === 'boolean' &&
				['device', 'server', 'receipt'].includes(p.timestampSource) &&
				object(p.sample),
			'временные метки отсчёта'
		);
		previousTime = p.timeMs;
		const sample = p.sample;
		for (const [field, keys] of Object.entries({
			sensors: ['d1', 'd2', 'd3', 'd4'],
			raw: ['x', 'y', 'z', 'f'],
			centered: ['x', 'y', 'z', 'f'],
			filtered: ['x', 'y', 'z', 'f'],
			mm: ['x', 'y']
		})) {
			assert(object(sample[field]), `поле ${field}`);
			assert(
				keys.every((k) => finite(sample[field][k]) || (!p.valid && sample[field][k] === null)),
				`числа ${field}`
			);
		}
		assert(
			finite(sample.packetNumber) || (!p.valid && sample.packetNumber === null),
			'номер пакета'
		);
		// A missing device clock can coexist with valid coordinates (server/receipt time is the fallback).
		assert(
			['deviceTime', 'clientTime'].every((k) => finite(sample[k]) || sample[k] == null),
			'время пакета'
		);
		assert(!p.valid || sample.centered.f > 0, 'нагрузка валидного отсчёта');
		assert(
			sample.isValid === undefined || typeof sample.isValid === 'boolean',
			'валидность серверного измерения'
		);
		assert(!p.valid || sample.isValid !== false, 'измерение исключено сервером');
		assert(
			sample.invalidReason === undefined || string(sample.invalidReason, 1000),
			'причина исключения измерения'
		);
	}
	assert(
		Array.isArray(s.quality) &&
			s.quality.every(
				(q: unknown) =>
					object(q) &&
					['gap', 'invalid', 'clock-fallback', 'clock-reset', 'no-load', 'interrupted'].includes(
						q.code
					) &&
					finite(q.atMs) &&
					q.atMs >= 0 &&
					string(q.detail)
			),
		'события качества'
	);
	assert(
		s.gameResult === undefined ||
			(object(s.gameResult) &&
				Object.values(s.gameResult).every(
					(v) => finite(v) || typeof v === 'boolean' || string(v, 1000)
				)),
		'результат игры'
	);
	// Recompute, never trust imported derived metrics.
	s.metrics = calculateMetrics(s.samples);
}

export function parseBackup(text: string): SessionBackup {
	assert(text.length <= 200_000_000, 'размер превышает 200 МБ');
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('Файл не является корректным JSON.');
	}
	assert(
		object(data) &&
			data.format === 'stabilometer-backup' &&
			data.version === 1 &&
			finite(data.exportedAt) &&
			Array.isArray(data.participants) &&
			Array.isArray(data.sessions),
		'формат резервной копии'
	);
	const participantIds = new Set<string>();
	for (const p of data.participants) {
		validateParticipant(p);
		assert(!participantIds.has(p.id), 'повтор идентификатора участника');
		participantIds.add(p.id);
	}
	const sessionIds = new Set<string>();
	for (const s of data.sessions) {
		validateSession(s);
		assert(participantIds.has(s.participantId), 'не найден участник сессии');
		assert(!sessionIds.has(s.id), 'повтор идентификатора сессии');
		sessionIds.add(s.id);
		if (s.status === 'recording') {
			s.status = 'interrupted';
			s.stopReason = 'Восстановлено из резервной копии незавершённой записи';
			s.endedAt = s.startedAt + s.metrics.durationSeconds * 1000;
		}
	}
	return data as unknown as SessionBackup;
}
