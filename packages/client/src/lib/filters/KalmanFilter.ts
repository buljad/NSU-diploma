export interface Vector2D {
	x: number;
	y: number;
}
export interface KalmanState extends Vector2D {
	vx: number;
	vy: number;
}
export interface FilterConfig {
	/** Acceleration variance, mm²/s⁴. */
	processNoise?: number;
	/** Measurement standard deviation, mm. */
	measurementNoise?: number;
	dt?: number;
	outlierThreshold?: number;
	criticalOutlierThreshold?: number;
	maxVelocity?: number;
	adaptiveGains?: boolean;
	verboseLogging?: boolean;
}
export interface FilterStats {
	totalUpdates: number;
	outlierDetections: number;
	criticalOutliers: number;
	autoResets: number;
	averageDistance: number;
	maxDistanceSeen: number;
}

/**
 * Constant-velocity Kalman estimator for display. Two independent [position,
 * velocity] axes share a symmetric 2×2 covariance. Gains are calculated from
 * that covariance and measurement variance on each sample, not fixed weights.
 * Results are borrowed vectors; this class does not alter source measurements.
 */
export class KalmanFilter2D {
	private readonly state: KalmanState = { x: 0, y: 0, vx: 0, vy: 0 };
	private initialized = false;
	private dt = 0.02;
	private processNoise = 400;
	private measurementNoise = 1.2;
	private outlierThreshold = 40;
	private criticalOutlierThreshold = 150;
	private maxVelocity = 800;
	private adaptiveGains = true;
	// Symmetric covariance of position and velocity (shared by independent axes).
	private p00 = 1.44;
	private p01 = 0;
	private p11 = 1000;
	private positionGain = 0;
	private velocityGain = 0;
	private rejectedCount = 0;
	private rejectedX = 0;
	private rejectedY = 0;
	private distanceCount = 0;
	private readonly stats: FilterStats = {
		totalUpdates: 0,
		outlierDetections: 0,
		criticalOutliers: 0,
		autoResets: 0,
		averageDistance: 0,
		maxDistanceSeen: 0
	};

	constructor(config: FilterConfig = {}) {
		this.updateConfiguration(config);
	}

	update(measuredX: number, measuredY: number, dt = this.dt): KalmanState {
		if (
			!Number.isFinite(measuredX) ||
			!Number.isFinite(measuredY) ||
			!Number.isFinite(dt) ||
			dt <= 0
		)
			return this.state;
		this.stats.totalUpdates++;
		if (!this.initialized || dt > 0.5) {
			if (this.initialized) this.stats.autoResets++;
			return this.initialize(measuredX, measuredY);
		}
		// Do not create huge velocity corrections for duplicate batch timestamps.
		if (dt < 0.001) return this.state;
		this.dt = dt;
		const predictedX = this.state.x + this.state.vx * dt;
		const predictedY = this.state.y + this.state.vy * dt;
		const dx = measuredX - predictedX;
		const dy = measuredY - predictedY;
		const distance = Math.hypot(dx, dy);
		this.distanceCount++;
		this.stats.averageDistance += (distance - this.stats.averageDistance) / this.distanceCount;
		this.stats.maxDistanceSeen = Math.max(this.stats.maxDistanceSeen, distance);

		if (distance > this.criticalOutlierThreshold) {
			this.stats.criticalOutliers++;
			this.stats.outlierDetections++;
			this.rejectedCount =
				Math.hypot(measuredX - this.rejectedX, measuredY - this.rejectedY) <= this.outlierThreshold
					? this.rejectedCount + 1
					: 1;
			this.rejectedX = measuredX;
			this.rejectedY = measuredY;
			// A sustained relocation may be real; isolated or alternating spikes are not.
			if (this.rejectedCount >= 5) {
				this.stats.autoResets++;
				return this.initialize(measuredX, measuredY);
			}
			this.state.vx = this.state.vy = 0;
			return this.state;
		}
		this.rejectedCount = 0;
		if (distance > this.outlierThreshold) this.stats.outlierDetections++;

		// P- = F P F' + G q G', G=[dt²/2, dt].
		const dt2 = dt * dt;
		const q = this.processNoise;
		const a = this.p00 + 2 * dt * this.p01 + dt2 * this.p11 + (q * dt2 * dt2) / 4;
		const b = this.p01 + dt * this.p11 + (q * dt2 * dt) / 2;
		const c = this.p11 + q * dt2;
		const inflation = this.adaptiveGains ? Math.max(1, distance / this.outlierThreshold) : 1;
		const r = this.measurementNoise * this.measurementNoise * inflation * inflation;
		const innovationVariance = a + r;
		const k0 = a / innovationVariance;
		const k1 = b / innovationVariance;
		this.positionGain = k0;
		this.velocityGain = k1;
		this.state.x = predictedX + k0 * dx;
		this.state.y = predictedY + k0 * dy;
		this.state.vx = Math.max(
			-this.maxVelocity,
			Math.min(this.maxVelocity, this.state.vx + k1 * dx)
		);
		this.state.vy = Math.max(
			-this.maxVelocity,
			Math.min(this.maxVelocity, this.state.vy + k1 * dy)
		);

		// Joseph covariance update: (I-KH)P-(I-KH)' + K R K'.
		const u = 1 - k0;
		this.p00 = u * u * a + k0 * k0 * r;
		this.p01 = u * (b - k1 * a) + k0 * k1 * r;
		this.p11 = Math.max(0, c - 2 * k1 * b + k1 * k1 * a + k1 * k1 * r);
		return this.state;
	}

	private initialize(x: number, y: number): KalmanState {
		this.state.x = x;
		this.state.y = y;
		this.state.vx = this.state.vy = 0;
		this.p00 = this.measurementNoise * this.measurementNoise;
		this.p01 = 0;
		this.p11 = 1000;
		this.rejectedCount = 0;
		this.initialized = true;
		return this.state;
	}

	getState(): KalmanState {
		return this.state;
	}

	reset(): void {
		this.initialized = false;
		this.state.x = this.state.y = this.state.vx = this.state.vy = 0;
		this.p00 = this.measurementNoise * this.measurementNoise;
		this.p01 = 0;
		this.p11 = 1000;
		this.rejectedCount = 0;
	}

	getStats(): FilterStats {
		return { ...this.stats };
	}

	getConfiguration() {
		return {
			model: 'constant-velocity-kalman',
			processNoise: this.processNoise,
			measurementNoise: this.measurementNoise,
			thresholds: { light: this.outlierThreshold, critical: this.criticalOutlierThreshold },
			gains: { position: this.positionGain, velocity: this.velocityGain },
			adaptiveGains: this.adaptiveGains,
			maxVelocity: this.maxVelocity
		};
	}

	updateConfiguration(config: Partial<FilterConfig>): void {
		if (Number.isFinite(config.processNoise) && config.processNoise! >= 0)
			this.processNoise = config.processNoise!;
		if (Number.isFinite(config.measurementNoise) && config.measurementNoise! > 0)
			this.measurementNoise = config.measurementNoise!;
		if (Number.isFinite(config.dt) && config.dt! >= 0.001 && config.dt! <= 0.5)
			this.dt = config.dt!;
		if (Number.isFinite(config.outlierThreshold) && config.outlierThreshold! > 0)
			this.outlierThreshold = config.outlierThreshold!;
		if (Number.isFinite(config.criticalOutlierThreshold) && config.criticalOutlierThreshold! > 0)
			this.criticalOutlierThreshold = config.criticalOutlierThreshold!;
		if (Number.isFinite(config.maxVelocity) && config.maxVelocity! > 0)
			this.maxVelocity = config.maxVelocity!;
		if (config.adaptiveGains !== undefined) this.adaptiveGains = config.adaptiveGains;
	}

	/** Retained for callers; high-frequency logging is intentionally disabled. */
	setVerboseLogging(_enabled: boolean): void {}

	setModeForGentleMovements(): void {
		this.updateConfiguration({
			processNoise: 400,
			measurementNoise: 1.2,
			outlierThreshold: 50,
			criticalOutlierThreshold: 180
		});
	}

	setModeForSharpMovements(): void {
		this.updateConfiguration({
			processNoise: 2500,
			measurementNoise: 1.2,
			outlierThreshold: 40,
			criticalOutlierThreshold: 150
		});
	}

	setModeForGaming(): void {
		this.setModeForSharpMovements();
		this.maxVelocity = 1000;
	}
}
