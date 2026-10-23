import type { RecordedSample, SessionMetrics } from './types';

export const ANALYSIS_METHOD =
	'centered CoP in mm, before server/client display filters; acquisition timestamps in ms; path and observed time exclude invalid/no-load samples, nonpositive intervals and gaps >250 ms; arithmetic sample mean, sample covariance (n−1); ellipse area = π × 5.991464547 × sqrt(det(covariance)); no normative interpretation';
export const GAP_THRESHOLD_MS = 250;

/** Online Welford covariance and path accumulation. No dependency on rendering or nominal Hz. */
export class MetricsAccumulator {
	private count = 0;
	private n = 0;
	private meanX = 0;
	private meanY = 0;
	private m2X = 0;
	private m2Y = 0;
	private cross = 0;
	private minX = Infinity;
	private maxX = -Infinity;
	private minY = Infinity;
	private maxY = -Infinity;
	private path = 0;
	private observedMs = 0;
	private durationMs = 0;
	private previous: RecordedSample | null = null;

	add(point: RecordedSample): void {
		this.count++;
		this.durationMs = Math.max(this.durationMs, point.timeMs);
		const { x, y } = point.sample.centered;
		if (point.valid) {
			this.n++;
			const dx = x - this.meanX;
			const dy = y - this.meanY;
			this.meanX += dx / this.n;
			this.meanY += dy / this.n;
			this.m2X += dx * (x - this.meanX);
			this.m2Y += dy * (y - this.meanY);
			this.cross += dx * (y - this.meanY);
			this.minX = Math.min(this.minX, x);
			this.maxX = Math.max(this.maxX, x);
			this.minY = Math.min(this.minY, y);
			this.maxY = Math.max(this.maxY, y);
			if (this.previous?.valid && !point.breakBefore) {
				const dt = point.timeMs - this.previous.timeMs;
				if (dt > 0 && dt <= GAP_THRESHOLD_MS) {
					this.path += Math.hypot(
						x - this.previous.sample.centered.x,
						y - this.previous.sample.centered.y
					);
					this.observedMs += dt;
				}
			}
		}
		this.previous = point;
	}

	snapshot(): SessionMetrics {
		const varianceX = this.n > 1 ? Math.max(0, this.m2X / (this.n - 1)) : 0;
		const varianceY = this.n > 1 ? Math.max(0, this.m2Y / (this.n - 1)) : 0;
		const covarianceXY = this.n > 1 ? this.cross / (this.n - 1) : 0;
		return {
			sampleCount: this.count,
			validCount: this.n,
			durationSeconds: this.durationMs / 1000,
			observedSeconds: this.observedMs / 1000,
			pathLengthMm: this.path,
			meanVelocityMmS: this.observedMs ? (this.path * 1000) / this.observedMs : 0,
			meanX: this.meanX,
			meanY: this.meanY,
			stdX: Math.sqrt(varianceX),
			stdY: Math.sqrt(varianceY),
			rangeX: this.n ? this.maxX - this.minX : 0,
			rangeY: this.n ? this.maxY - this.minY : 0,
			covarianceXY,
			ellipse95Mm2:
				Math.PI * 5.991464547 * Math.sqrt(Math.max(0, varianceX * varianceY - covarianceXY ** 2))
		};
	}
}

export function calculateMetrics(samples: readonly RecordedSample[]): SessionMetrics {
	const accumulator = new MetricsAccumulator();
	for (const point of samples) accumulator.add(point);
	return accumulator.snapshot();
}
