import type { MeasurementSession, Participant } from './types';

export function sessionToJSON(session: MeasurementSession): string {
	return JSON.stringify(session, null, 2);
}

function csvCell(value: string | number | boolean | null | undefined): string {
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
	let text = value == null ? '' : String(value);
	// Spreadsheet formula injection protection for text fields; numerical negative values remain numbers.
	if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
	return `"${text.replace(/"/g, '""')}"`;
}

export function sessionToCSV(session: MeasurementSession): string {
	const rows: Array<Array<string | number | boolean | undefined>> = [
		[
			'session_id',
			'demo',
			'protocol_id',
			'elapsed_ms',
			'timestamp_source',
			'received_at_ms',
			'device_time_ms',
			'server_time_ms',
			'packet_number',
			'valid',
			'break_before',
			'd1',
			'd2',
			'd3',
			'd4',
			'raw_x_mm',
			'raw_y_mm',
			'raw_f_sensor_units',
			'centered_x_mm',
			'centered_y_mm',
			'centered_f_sensor_units',
			'display_filtered_x_mm',
			'display_filtered_y_mm'
		]
	];
	for (const point of session.samples) {
		const s = point.sample;
		rows.push([
			session.id,
			session.demo,
			session.protocol.id,
			point.timeMs,
			point.timestampSource,
			point.receivedAt,
			s.deviceTime,
			(s as typeof s & { serverTime?: number }).serverTime,
			s.packetNumber,
			point.valid,
			point.breakBefore,
			s.sensors.d1,
			s.sensors.d2,
			s.sensors.d3,
			s.sensors.d4,
			s.raw.x,
			s.raw.y,
			s.raw.f,
			s.centered.x,
			s.centered.y,
			s.centered.f,
			s.filtered.x,
			s.filtered.y
		]);
	}
	return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function comparisonWarnings(a: MeasurementSession, b: MeasurementSession): string[] {
	const warnings: string[] = [];
	if (a.participantId !== b.participantId) warnings.push('Разные участники.');
	if (a.demo !== b.demo) warnings.push('Демонстрационная и реальная записи.');
	if (JSON.stringify(a.protocol) !== JSON.stringify(b.protocol))
		warnings.push('Различаются протокол или условия проведения.');
	if (
		a.metadata.algorithmVersion !== b.metadata.algorithmVersion ||
		a.metadata.coordinateSource !== b.metadata.coordinateSource ||
		a.metadata.method !== b.metadata.method
	)
		warnings.push('Различаются алгоритмы обработки.');
	if (JSON.stringify(a.metadata.axes) !== JSON.stringify(b.metadata.axes))
		warnings.push('Различаются настройки осей.');
	const ac = a.metadata.calibration;
	const bc = b.metadata.calibration;
	if (
		JSON.stringify(ac?.sensorDistance) !== JSON.stringify(bc?.sensorDistance) ||
		JSON.stringify(ac?.platformSize) !== JSON.stringify(bc?.platformSize)
	)
		warnings.push('Различается геометрия платформы.');
	if (
		Math.abs(a.metrics.durationSeconds - b.metrics.durationSeconds) >
		Math.max(0.1, Math.max(a.metrics.durationSeconds, b.metrics.durationSeconds) * 0.05)
	)
		warnings.push('Длительность записей отличается более чем на 5%.');
	if (a.status !== 'completed' || b.status !== 'completed')
		warnings.push('Есть прерванная запись.');
	if (a.quality.length || b.quality.length) warnings.push('Есть замечания к качеству данных.');
	return warnings;
}

export function escapeHTML(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(character) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
	);
}

function trajectorySVG(session: MeasurementSession): string {
	const valid = session.samples.filter((point) => point.valid);
	if (!valid.length) return '<p>Нет валидных координат для построения траектории.</p>';
	let radius = 10;
	for (const point of valid)
		radius = Math.max(radius, Math.abs(point.sample.centered.x), Math.abs(point.sample.centered.y));
	const scale = 180 / radius;
	// Limit report size without joining across invalid data/gaps.
	const stride = Math.max(1, Math.ceil(session.samples.length / 4000));
	let path = '';
	let penDown = false;
	for (let i = 0; i < session.samples.length; i++) {
		const p = session.samples[i];
		if (!p.valid || p.breakBefore) penDown = false;
		if (!p.valid || (i % stride !== 0 && i !== session.samples.length - 1)) continue;
		path += `${penDown ? 'L' : 'M'}${(200 + p.sample.centered.x * scale).toFixed(2)},${(200 - p.sample.centered.y * scale).toFixed(2)} `;
		penDown = true;
	}
	return `<svg viewBox="0 0 400 400" role="img" aria-label="Траектория центра давления" xmlns="http://www.w3.org/2000/svg"><rect x="20" y="20" width="360" height="360" fill="#f8fafc" stroke="#cbd5e1"/><path d="M20 200H380M200 20V380" stroke="#cbd5e1"/><path d="${path}" fill="none" stroke="#0f766e" stroke-width="1.5"/><text x="205" y="36" font-size="12">Y, мм</text><text x="330" y="194" font-size="12">X, мм</text><text x="22" y="396" font-size="11">Диапазон осей: ±${radius.toFixed(1)} мм; траектория без визуального сглаживания</text></svg>`;
}

/** Standalone printable report. Use browser Print → Save as PDF. All user content is escaped. */
export function sessionReportHTML(session: MeasurementSession, participant?: Participant): string {
	const m = session.metrics;
	const n = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
	const rows = [
		['Длительность данных, с', n(m.durationSeconds)],
		['Наблюдаемое время без разрывов, с', n(m.observedSeconds)],
		['Отсчёты: всего / валидных', `${m.sampleCount} / ${m.validCount}`],
		['Длина траектории, мм', n(m.pathLengthMm)],
		['Средняя скорость, мм/с', n(m.meanVelocityMmS)],
		['Среднее X / Y, мм', `${n(m.meanX)} / ${n(m.meanY)}`],
		['Стандартное отклонение X / Y, мм', `${n(m.stdX)} / ${n(m.stdY)}`],
		['Размах X / Y, мм', `${n(m.rangeX)} / ${n(m.rangeY)}`],
		['Площадь ковариационного эллипса 95%, мм²', n(m.ellipse95Mm2)]
	];
	const quality = session.quality.length
		? session.quality
				.map((q) => `<li>${n(q.atMs / 1000)} с — ${escapeHTML(q.detail)}</li>`)
				.join('')
		: '<li>Событий качества не зарегистрировано.</li>';
	const eyes = { open: 'открыты', closed: 'закрыты', unspecified: 'не указано' }[
		session.protocol.eyes
	];
	return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Стабилометрия — отчёт</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#172033;max-width:950px;margin:32px auto;padding:0 24px}h1{font-size:28px}h2{font-size:20px;margin-top:28px}p{margin:8px 0}.muted{color:#475569}.badge{background:#fff3cd;padding:8px}table{width:100%;border-collapse:collapse}td{padding:9px;border-bottom:1px solid #dbe2ea}td:last-child{text-align:right}svg{display:block;width:400px;max-width:100%;margin:auto}.method{font-size:12px;overflow-wrap:anywhere}.notes{white-space:pre-wrap}button{padding:10px 18px;cursor:pointer}@media print{body{margin:0;max-width:none;padding:0}button{display:none}h2{break-after:avoid}table,svg{break-inside:avoid}@page{margin:16mm}}
</style></head><body><button onclick="window.print()">Печать / сохранить PDF</button><h1>Результат стабилометрической сессии</h1>
${session.demo ? '<p class="badge">ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ — искусственный сигнал</p>' : ''}
<p><strong>Участник:</strong> ${escapeHTML(participant?.name ?? session.participantId)}</p>
<p><strong>Дата:</strong> ${escapeHTML(new Date(session.startedAt).toLocaleString('ru-RU'))}</p>
<p><strong>Протокол:</strong> ${escapeHTML(session.protocol.name)}. Глаза: ${eyes}. Положение стоп: ${escapeHTML(session.protocol.stance ?? 'не указано')}.</p>
<p><strong>Состояние:</strong> ${session.status === 'completed' ? 'завершена' : session.status === 'recording' ? 'идёт запись' : 'прервана'} ${escapeHTML(session.stopReason)}</p>
<h2>Показатели</h2><table><tbody>${rows.map(([label, value]) => `<tr><td>${escapeHTML(label)}</td><td>${escapeHTML(value)}</td></tr>`).join('')}</tbody></table>
<h2>Траектория центра давления</h2>${trajectorySVG(session)}
${
	session.gameResult
		? `<h2>Результат тренировки</h2><table>${Object.entries(session.gameResult)
				.map(([key, value]) => `<tr><td>${escapeHTML(key)}</td><td>${escapeHTML(value)}</td></tr>`)
				.join('')}</table>`
		: ''
}
<h2>Качество записи</h2><ul>${quality}</ul><h2>Комментарий</h2><p class="notes">${escapeHTML(session.notes || 'Не указан.')}</p>
<h2>Метод расчёта</h2><p class="method">${escapeHTML(session.metadata.method)}</p>
<p class="method">Версия алгоритма: ${escapeHTML(session.metadata.algorithmVersion)}. Калибровка: ${session.metadata.calibration ? escapeHTML(new Date(session.metadata.calibration.timestamp).toLocaleString('ru-RU')) : 'не сохранена'}. Оси: ${escapeHTML(JSON.stringify(session.metadata.axes))}.</p>
<p class="muted method">Показатели описывают эту запись. Автоматическая оценка нормы и диагностическое заключение не выполняются. Идентификатор: ${escapeHTML(session.id)}.</p></body></html>`;
}
