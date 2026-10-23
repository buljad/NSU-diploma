import type { StabilogramSample } from '@stabilometer/shared';
import { ANALYSIS_METHOD, GAP_THRESHOLD_MS, MetricsAccumulator } from './metrics';
import type { BeginSessionOptions, MeasurementSession, QualityCode, RecordedSample } from './types';

const clone = <T>(value: T): T => structuredClone(value);
export function newId(): string {
	return crypto.randomUUID();
}

/** Owns acquisition data only: a Canvas or animation callback must never call ingest. */
export class SessionRecorder {
	readonly session: MeasurementSession;
	private accumulator = new MetricsAccumulator();
	private previous: { device: number; server: number; receipt: number } | null = null;
	private elapsed = 0;
	private previousSource = '';

	constructor(options: BeginSessionOptions, id = newId(), startedAt = Date.now()) {
		this.session = {
			schemaVersion: 1,
			id,
			participantId: options.participantId,
			protocol: clone(options.protocol),
			demo: options.demo,
			startedAt,
			endedAt: null,
			status: 'recording',
			stopReason: '',
			notes: '',
			metadata: {
				appVersion: '1.1.0',
				algorithmVersion: 'cop-acquisition-v1',
				coordinateSource: 'centered',
				method: ANALYSIS_METHOD,
				gapThresholdMs: GAP_THRESHOLD_MS,
				calibration: clone(options.calibration ?? null),
				axes: clone(
					options.axes ?? { swapXY: false, invertX: false, invertY: false, rotationDeg: 0 }
				)
			},
			samples: [],
			quality: [],
			metrics: this.accumulator.snapshot()
		};
	}

	private flag(code: QualityCode, detail: string): void {
		const last = this.session.quality.at(-1);
		// A continuous invalid run produces one event; sample counts remain in metrics.
		if (last?.code === code && this.elapsed - last.atMs < 1000) return;
		this.session.quality.push({ code, atMs: this.elapsed, detail });
	}

	ingest(input: StabilogramSample, receivedAt = performance.now()): void {
		if (this.session.status !== 'recording') return;
		const device = input.deviceTime;
		const server = (input as StabilogramSample & { serverTime?: number }).serverTime ?? NaN;
		const receipt = receivedAt;
		let source: RecordedSample['timestampSource'] = 'device';
		let dt = 0;
		let breakBefore = false;
		if (this.previous) {
			const dd = device - this.previous.device;
			const ds = server - this.previous.server;
			const dr = receipt - this.previous.receipt;
			if (Number.isFinite(dd) && dd > 0) dt = dd;
			else if (Number.isFinite(ds) && ds > 0) {
				dt = ds;
				source = 'server';
			} else {
				dt = Number.isFinite(dr) && dr > 0 ? dr : 0;
				source = 'receipt';
			}
			if (Number.isFinite(dd) && dd < 0) {
				breakBefore = true;
				this.flag(
					'clock-reset',
					'Время устройства сброшено; переход на резервные временные метки.'
				);
			}
			if (dt <= 0) breakBefore = true;
			if (source !== this.previousSource) breakBefore = true;
			this.elapsed += dt;
			if (dt > GAP_THRESHOLD_MS) {
				breakBefore = true;
				this.flag(
					'gap',
					`Интервал между отсчётами ${Math.round(dt)} мс; движение через разрыв исключено из скорости и пути.`
				);
			}
		} else if (!Number.isFinite(device) || device < 0) {
			source = Number.isFinite(server) ? 'server' : 'receipt';
		}
		if (source !== 'device' && source !== this.previousSource) {
			this.flag(
				'clock-fallback',
				'Время устройства недоступно или не возрастает; используется время сервера/получения. Интервалы внутри пакета не выдумываются.'
			);
		}
		this.previous = { device, server, receipt };
		this.previousSource = source;
		const coordinates = input.centered;
		const values = [
			input.raw?.x,
			input.raw?.y,
			input.raw?.z,
			input.raw?.f,
			coordinates?.x,
			coordinates?.y,
			coordinates?.z,
			coordinates?.f,
			input.filtered?.x,
			input.filtered?.y,
			input.filtered?.z,
			input.filtered?.f,
			input.mm?.x,
			input.mm?.y,
			input.packetNumber,
			input.sensors?.d1,
			input.sensors?.d2,
			input.sensors?.d3,
			input.sensors?.d4
		];
		const finite = values.every(Number.isFinite);
		const loaded = finite && coordinates.f > 0;
		const acquisitionValid = input.isValid !== false;
		if (!finite) this.flag('invalid', 'Нечисловое измерение исключено из расчётов.');
		else if (!acquisitionValid)
			this.flag(
				'invalid',
				`Измерение исключено сервером: ${input.invalidReason ?? 'причина не указана'}.`
			);
		else if (!loaded)
			this.flag('no-load', 'Нагрузка отсутствует; координаты исключены из расчётов.');
		// Keep raw evidence, but JSON cannot encode NaN: mark invalid and normalize nonfinite values to null at export.
		const point: RecordedSample = {
			timeMs: this.elapsed,
			timestampSource: source,
			receivedAt: receipt,
			sample: clone(input),
			valid: finite && loaded && acquisitionValid,
			breakBefore
		};
		this.session.samples.push(point);
		this.accumulator.add(point);
	}

	updateMetrics(): void {
		this.session.metrics = this.accumulator.snapshot();
	}

	stop(reason = '', gameResult?: Record<string, number | string | boolean>): MeasurementSession {
		if (this.session.status !== 'recording') return this.session;
		this.updateMetrics();
		this.session.endedAt = Date.now();
		this.session.status = reason ? 'interrupted' : 'completed';
		this.session.stopReason = reason;
		if (reason) this.flag('interrupted', reason);
		if (gameResult) this.session.gameResult = clone(gameResult);
		return this.session;
	}
}
