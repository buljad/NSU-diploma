import type { Vector2D } from '@stabilometer/shared';

interface SamplePoint {
	position: Vector2D;
	velocity: Vector2D;
	timestamp: number;
}

/** Display-only interpolation. Never use its predictions to calculate measurement metrics. */
export class PositionInterpolator {
	private readonly samples: SamplePoint[] = Array.from({ length: 16 }, () => ({
		position: { x: 0, y: 0 },
		velocity: { x: 0, y: 0 },
		timestamp: 0
	}));
	private writeIndex = 0;
	private sampleCount = 0;
	private readonly currentPosition: Vector2D = { x: 0, y: 0 };
	private readonly currentVelocity: Vector2D = { x: 0, y: 0 };
	private smoothingFactor = 0.3;
	private interpolationDelayMs = 42;
	private maxExtrapolationTime = 80;
	private readonly streamTimeoutMs = 500;
	private lastDataReceiveTime = -Infinity;

	/** timestamp and receiveTime use the browser monotonic clock, in milliseconds. */
	addSample(position: Vector2D, timestamp: number, receiveTime = performance.now()): void {
		if (
			!Number.isFinite(position.x) ||
			!Number.isFinite(position.y) ||
			!Number.isFinite(timestamp) ||
			!Number.isFinite(receiveTime)
		)
			return;
		const previous = this.sampleCount ? this.latest() : null;
		// Serial chunks may contain distinct measurements stamped in the same server
		// millisecond. Replace that endpoint during the same receive burst, but never
		// extend freshness on a duplicate (a replay must not revive a stalled stream).
		if (previous && timestamp === previous.timestamp) {
			const receiveDelta = receiveTime - this.lastDataReceiveTime;
			if (receiveDelta < 0 || receiveDelta > 20) return;
			previous.position.x = position.x;
			previous.position.y = position.y;
			const before =
				this.sampleCount > 1
					? this.samples[(this.writeIndex - 2 + this.samples.length) % this.samples.length]
					: null;
			const dt = before ? (timestamp - before.timestamp) / 1000 : 0;
			previous.velocity.x =
				before && dt > 0 && dt <= 0.5
					? Math.max(-600, Math.min(600, (position.x - before.position.x) / dt))
					: 0;
			previous.velocity.y =
				before && dt > 0 && dt <= 0.5
					? Math.max(-600, Math.min(600, (position.y - before.position.y) / dt))
					: 0;
			return;
		}
		if (previous && timestamp < previous.timestamp) return;
		const next = this.samples[this.writeIndex];
		const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
		next.velocity.x =
			dt > 0 && dt <= 0.5 && previous
				? Math.max(-600, Math.min(600, (position.x - previous.position.x) / dt))
				: 0;
		next.velocity.y =
			dt > 0 && dt <= 0.5 && previous
				? Math.max(-600, Math.min(600, (position.y - previous.position.y) / dt))
				: 0;
		// Copy the input: callers may reuse their own pooled vectors.
		next.position.x = position.x;
		next.position.y = position.y;
		next.timestamp = timestamp;
		this.writeIndex = (this.writeIndex + 1) % this.samples.length;
		this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
		this.lastDataReceiveTime = receiveTime;
	}

	/** The result is a borrowed, preallocated vector; copy it if retaining a history. */
	getInterpolatedPosition(renderTime = performance.now()): Vector2D {
		if (!this.sampleCount || !Number.isFinite(renderTime)) return this.currentPosition;
		const targetTime = renderTime - this.interpolationDelayMs;
		let previous =
			this.samples[
				(this.writeIndex - this.sampleCount + this.samples.length) % this.samples.length
			];
		this.currentVelocity.x = 0;
		this.currentVelocity.y = 0;
		if (targetTime <= previous.timestamp) {
			this.currentPosition.x = previous.position.x;
			this.currentPosition.y = previous.position.y;
			return this.currentPosition;
		}
		for (let i = 1; i < this.sampleCount; i++) {
			const next =
				this.samples[
					(this.writeIndex - this.sampleCount + i + this.samples.length) % this.samples.length
				];
			if (targetTime <= next.timestamp) {
				const elapsed = next.timestamp - previous.timestamp;
				const fraction = (targetTime - previous.timestamp) / elapsed;
				this.currentPosition.x =
					previous.position.x + (next.position.x - previous.position.x) * fraction;
				this.currentPosition.y =
					previous.position.y + (next.position.y - previous.position.y) * fraction;
				if (this.isFresh(renderTime)) {
					this.currentVelocity.x = (next.position.x - previous.position.x) / (elapsed / 1000);
					this.currentVelocity.y = (next.position.y - previous.position.y) / (elapsed / 1000);
				}
				return this.currentPosition;
			}
			previous = next;
		}
		// A short, bounded prediction reaches a fixed endpoint. Missing data never moves
		// the marker back to the centre or invents continuing movement.
		const age = Math.max(0, targetTime - previous.timestamp);
		const seconds = Math.min(age, this.maxExtrapolationTime) / 1000;
		this.currentPosition.x = previous.position.x + previous.velocity.x * seconds;
		this.currentPosition.y = previous.position.y + previous.velocity.y * seconds;
		if (age < this.maxExtrapolationTime && this.isFresh(renderTime)) {
			this.currentVelocity.x = previous.velocity.x;
			this.currentVelocity.y = previous.velocity.y;
		}
		return this.currentPosition;
	}

	isFresh(now = performance.now()): boolean {
		return (
			this.sampleCount > 0 &&
			now >= this.lastDataReceiveTime &&
			now - this.lastDataReceiveTime <= this.streamTimeoutMs
		);
	}

	getVelocity(): Vector2D {
		return this.currentVelocity;
	}

	reset(): void {
		this.writeIndex = this.sampleCount = 0;
		this.currentPosition.x = this.currentPosition.y = 0;
		this.currentVelocity.x = this.currentVelocity.y = 0;
		this.lastDataReceiveTime = -Infinity;
	}

	getDebugInfo() {
		const now = performance.now();
		const latest = this.sampleCount ? this.latest() : null;
		return {
			isStreamActive: this.isFresh(now),
			timeSinceLastData: now - this.lastDataReceiveTime,
			samplesCount: this.sampleCount,
			currentPosition: this.currentPosition,
			currentVelocity: this.currentVelocity,
			latestSample: latest,
			thresholds: {
				maxExtrapolation: this.maxExtrapolationTime,
				streamTimeout: this.streamTimeoutMs
			},
			smoothingFactor: this.smoothingFactor
		};
	}

	updateSettings(settings: {
		smoothingFactor?: number;
		maxExtrapolationTime?: number;
		/** @deprecated Missing samples are frozen; fade-to-zero is intentionally disabled. */
		fadeToZeroTime?: number;
	}): void {
		if (Number.isFinite(settings.smoothingFactor)) {
			this.smoothingFactor = Math.max(0.1, Math.min(0.8, settings.smoothingFactor!));
			this.interpolationDelayMs = 60 * (1 - this.smoothingFactor);
		}
		if (Number.isFinite(settings.maxExtrapolationTime)) {
			this.maxExtrapolationTime = Math.max(0, Math.min(100, settings.maxExtrapolationTime!));
		}
	}

	setModeForGentleMovements(): void {
		this.updateSettings({ smoothingFactor: 0.2, maxExtrapolationTime: 60 });
	}

	setModeForSharpMovements(): void {
		this.updateSettings({ smoothingFactor: 0.5, maxExtrapolationTime: 80 });
	}

	private latest(): SamplePoint {
		return this.samples[(this.writeIndex - 1 + this.samples.length) % this.samples.length];
	}
}
