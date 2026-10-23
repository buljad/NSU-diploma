import { writable, derived } from 'svelte/store';
import { TypedRingBuffer } from '@stabilometer/shared';
import type {
	StabilogramSample,
	CalibrationData,
	AxisConfiguration,
	Vector2D
} from '@stabilometer/shared';
import { KalmanFilter2D } from '../filters/KalmanFilter';
import { PositionInterpolator } from '../rendering/PositionInterpolator';

function createStabilogramStore() {
	const state = writable({
		isWsConnected: false,
		isDeviceConnected: false,
		isCalibrated: false,
		demo: false,
		port: '',
		currentSample: null as StabilogramSample | null,
		filteredPosition: { x: 0, y: 0 },
		interpolatedPosition: { x: 0, y: 0 },
		velocity: { x: 0, y: 0 },
		scale: 3,
		fps: 0,
		latency: 0,
		packetRate: 0
	});
	const calibration = writable<CalibrationData | null>(null);
	const axisConfig = writable<AxisConfiguration>({
		swapXY: true,
		invertX: false,
		invertY: false,
		rotationDeg: 0
	});
	const history = new TypedRingBuffer<StabilogramSample>(500);
	const listeners = new Set<(sample: StabilogramSample) => void>();
	const kalman = new KalmanFilter2D({
		processNoise: 400,
		measurementNoise: 1.2,
		verboseLogging: false
	});
	const interpolator = new PositionInterpolator();
	let lastTime = 0,
		receivedTime = -Infinity,
		lastNotify = -Infinity;
	let deviceConnected = false,
		validInput = false,
		gameMode = false;
	const times = new Float64Array(1024);
	let head = 0,
		count = 0;
	const position = { x: 0, y: 0 };
	function resetMotion() {
		kalman.reset();
		interpolator.reset();
		history.clear();
		lastTime = 0;
		receivedTime = -Infinity;
		validInput = false;
		head = 0;
		count = 0;
	}
	function processSample(sample: StabilogramSample) {
		const now = performance.now();
		receivedTime = now;
		validInput =
			sample.isValid !== false && Number.isFinite(sample.mm.x) && Number.isFinite(sample.mm.y);
		history.push(sample);
		for (const listener of listeners) listener(sample);
		times[head] = now;
		head = (head + 1) % times.length;
		count = Math.min(count + 1, times.length);
		if (validInput) {
			const dt = lastTime ? (sample.clientTime - lastTime) / 1000 : 0.02;
			if (dt < 0 || dt > 0.5) kalman.reset();
			const filtered = kalman.update(sample.mm.x, sample.mm.y, Math.max(0.001, Math.min(0.5, dt)));
			position.x = filtered.x;
			position.y = filtered.y;
			interpolator.addSample(position, sample.clientTime, now);
		}
		lastTime = sample.clientTime;
		if (now - lastNotify >= 100) {
			let rate = 0;
			for (let i = 0; i < count; i++)
				if (now - times[(head - 1 - i + times.length) % times.length] <= 1000) rate++;
			state.update((s) => ({
				...s,
				currentSample: sample,
				packetRate: rate,
				latency: Math.max(0, now - sample.clientTime)
			}));
			lastNotify = now;
		}
	}
	function setDeviceConnected(connected: boolean) {
		deviceConnected = connected;
		resetMotion();
		state.update((s) => ({
			...s,
			isDeviceConnected: connected,
			currentSample: null,
			packetRate: 0
		}));
	}
	function setWsConnected(connected: boolean) {
		if (!connected) setDeviceConnected(false);
		state.update((s) => ({ ...s, isWsConnected: connected }));
	}
	function setCalibration(data: CalibrationData | null) {
		calibration.set(data);
		resetMotion();
		state.update((s) => ({ ...s, isCalibrated: !!data?.isValid }));
	}
	return {
		subscribe: state.subscribe,
		processSample,
		initialize: (_viewport: Vector2D) => {},
		initializeGameMode: (_viewport: Vector2D) => {
			resetMotion();
			gameMode = true;
			kalman.setModeForSharpMovements();
			interpolator.setModeForSharpMovements();
		},
		resetGameMode: () => {
			gameMode = false;
			kalman.setModeForGentleMovements();
			interpolator.setModeForGentleMovements();
		},
		getRenderPosition: () => interpolator.getInterpolatedPosition(),
		getRenderVelocity: () => interpolator.getVelocity(),
		isStreamFresh: (now = performance.now()) =>
			deviceConnected && validInput && now - receivedTime <= 500,
		getInterpolatorDebug: () => interpolator.getDebugInfo(),
		getSampleHistory: (n = 100) => {
			const out: StabilogramSample[] = [];
			for (let i = Math.max(0, history.length - n); i < history.length; i++) {
				const s = history.peek(i);
				if (s) out.push(s);
			}
			return out;
		},
		observeSamples: (listener: (s: StabilogramSample) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setWsConnected,
		setDeviceConnected,
		setCalibration,
		setConnectionDetails: (demo: boolean, port: string) =>
			state.update((s) => ({ ...s, demo, port })),
		setAxisConfig: (config: AxisConfiguration) => {
			axisConfig.set(config);
			resetMotion();
		},
		updateFps: (fps: number) => state.update((s) => ({ ...s, fps })),
		setScale: (scale: number) =>
			state.update((s) => ({ ...s, scale: Math.max(0.5, Math.min(10, scale)) })),
		calibration: { subscribe: calibration.subscribe },
		axisConfig: { subscribe: axisConfig.subscribe },
		isReady: derived(state, (s) => s.isDeviceConnected && (s.isCalibrated || s.demo)),
		position: derived(state, (s) => s.interpolatedPosition),
		get isInitialized() {
			return true;
		},
		get isGameModeInitialized() {
			return gameMode;
		},
		get sampleCount() {
			return history.length;
		}
	};
}
export const stabilogramStore = createStabilogramStore();
export const currentPosition = derived(stabilogramStore, (s) => s.interpolatedPosition);
export const isStabilogramReady = stabilogramStore.isReady;
export const connectionStatus = derived(stabilogramStore, (s) => ({
	ws: s.isWsConnected,
	device: s.isDeviceConnected,
	calibrated: s.isCalibrated
}));
