import type { AxisConfiguration, CalibrationData, StabilogramSample } from '@stabilometer/shared';

export interface Participant {
	id: string;
	name: string;
	notes: string;
	createdAt: number;
}

export interface Protocol {
	id: string;
	name: string;
	eyes: 'open' | 'closed' | 'unspecified';
	durationSeconds?: number;
	stance?: string;
	notes?: string;
}

export type QualityCode =
	| 'gap'
	| 'invalid'
	| 'clock-fallback'
	| 'clock-reset'
	| 'no-load'
	| 'interrupted';
export interface QualityEvent {
	code: QualityCode;
	atMs: number;
	detail: string;
}

/** Elapsed acquisition time; coordinates are calibrated/axis-transformed, before visual filtering. */
export interface RecordedSample {
	timeMs: number;
	timestampSource: 'device' | 'server' | 'receipt';
	receivedAt: number;
	sample: StabilogramSample;
	valid: boolean;
	breakBefore: boolean;
}

export interface SessionMetrics {
	sampleCount: number;
	validCount: number;
	durationSeconds: number;
	observedSeconds: number;
	pathLengthMm: number;
	meanVelocityMmS: number;
	meanX: number;
	meanY: number;
	stdX: number;
	stdY: number;
	rangeX: number;
	rangeY: number;
	covarianceXY: number;
	ellipse95Mm2: number;
}

export interface SessionMetadata {
	appVersion: string;
	algorithmVersion: string;
	coordinateSource: 'centered';
	method: string;
	gapThresholdMs: number;
	calibration: CalibrationData | null;
	axes: AxisConfiguration;
}

export interface MeasurementSession {
	schemaVersion: 1;
	id: string;
	participantId: string;
	protocol: Protocol;
	demo: boolean;
	startedAt: number;
	endedAt: number | null;
	status: 'recording' | 'completed' | 'interrupted';
	stopReason: string;
	notes: string;
	metadata: SessionMetadata;
	samples: RecordedSample[];
	quality: QualityEvent[];
	metrics: SessionMetrics;
	gameResult?: Record<string, number | string | boolean>;
}

export type SessionSummary = Omit<MeasurementSession, 'samples'>;
export interface BeginSessionOptions {
	participantId: string;
	protocol: Protocol;
	demo: boolean;
	calibration?: CalibrationData | null;
	axes?: AxisConfiguration;
}

export interface SessionBackup {
	format: 'stabilometer-backup';
	version: 1;
	exportedAt: number;
	participants: Participant[];
	sessions: MeasurementSession[];
}
