// packages/client/src/lib/stores/stabilogram.ts

import { writable, derived, get } from 'svelte/store';
import {
  TypedRingBuffer,
  type StabilogramSample,
  type CalibrationData,
  type AxisConfiguration,
  type Vector2D
} from '@stabilometer/shared';
import { KalmanFilter2D } from '../filters/KalmanFilter';
import { PositionInterpolator } from '../rendering/PositionInterpolator';

const DEFAULT_CONFIG = {
  filterType: 'kalman',
  interpolationEnabled: true,
  maxSampleHistory: 500
} as const;

const ZERO_VELOCITY: Vector2D = { x: 0, y: 0 };

interface StabilogramState {
  isWsConnected: boolean;
  isDeviceConnected: boolean;
  isCalibrated: boolean;
  currentSample: StabilogramSample | null;
  filteredPosition: Vector2D;
  interpolatedPosition: Vector2D;
  velocity: Vector2D;
  scale: number;
  fps: number;
  latency: number;
  packetRate: number;
}

function createStabilogramStore() {
  let kalmanFilter: KalmanFilter2D | null = null;
  let interpolator: PositionInterpolator | null = null;
  let sampleHistory: TypedRingBuffer<StabilogramSample> | null = null;

  let lastPacketTime = 0;
  let packetTimes: number[] = [];

  let isInitialized = false;
  let isGameModeInitialized = false;

  const state = writable<StabilogramState>({
    isWsConnected: false,
    isDeviceConnected: false,
    isCalibrated: false,
    currentSample: null,
    filteredPosition: { x: 0, y: 0 },
    interpolatedPosition: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    scale: 5,
    fps: 0,
    latency: 0,
    packetRate: 0
  });

  const calibrationStore = writable<CalibrationData | null>(null);
  const axisConfigStore = writable<AxisConfiguration>({
    swapXY: false,
    invertX: false,
    invertY: false,
    rotationDeg: 0
  });

  function initialize(viewportSize: Vector2D): void {
    if (isInitialized) return;

    // ✅ ИНИЦИАЛИЗАЦИЯ с настройками для плавных движений
    kalmanFilter = new KalmanFilter2D({ 
      processNoise: 0.15, 
      measurementNoise: 1.2,
      verboseLogging: false  // Отключаем verbose для производительности
    });
    
    interpolator = new PositionInterpolator();
    
    // Настраиваем интерполятор для плавных движений
    interpolator.setModeForGentleMovements();
    
    sampleHistory = new TypedRingBuffer<StabilogramSample>(DEFAULT_CONFIG.maxSampleHistory);
    
    isInitialized = true;
    console.log('✅ Stabilogram store v2.3+ initialized (optimized for gentle movements)');
  }

  function initializeGameMode(viewportSize: Vector2D): void {
    if (!isInitialized) initialize(viewportSize);
    if (isGameModeInitialized) return;

    kalmanFilter?.reset();
    interpolator?.reset();
    
    // Переключаем на режим резких движений для игры
    kalmanFilter?.setModeForSharpMovements();
    interpolator?.setModeForSharpMovements();

    isGameModeInitialized = true;
    console.log('🎮 Game mode initialized with sharp movement optimization');
  }

  function resetGameMode(): void {
    isGameModeInitialized = false;
    
    // Возвращаем настройки для плавных движений
    kalmanFilter?.setModeForGentleMovements(); 
    interpolator?.setModeForGentleMovements();
    
    console.log('🏥 Returned to gentle movement mode');
  }

  function processSample(sample: StabilogramSample): void {
    if (!isInitialized) {
      initialize({ x: 800, y: 600 });
    }

    const validTime = sample.clientTime || performance.now();
    const currentRenderTime = performance.now();

    packetTimes.push(validTime);
    packetTimes = packetTimes.filter(t => currentRenderTime - t < 1000);
    
    sampleHistory?.push(sample);

    let filteredPosition = sample.mm;
    if (kalmanFilter) {
      const dt = lastPacketTime > 0 ? (validTime - lastPacketTime) / 1000 : 0.02;
      const res = kalmanFilter.update(sample.mm.x, sample.mm.y, dt);
      filteredPosition = { x: res.x, y: res.y };
    }

    let interpolatedPosition = filteredPosition;
    if (interpolator) {
      interpolator.addSample(filteredPosition, validTime);
      interpolatedPosition = interpolator.getInterpolatedPosition(currentRenderTime);
    }

    // ✅ ДИАГНОСТИКА ВНУТРИ СТОРА (только при больших скачках)
    const inputDistance = Math.sqrt(sample.mm.x ** 2 + sample.mm.y ** 2);
    const kalmanDistance = Math.sqrt(filteredPosition.x ** 2 + filteredPosition.y ** 2);
    const finalDistance = Math.sqrt(interpolatedPosition.x ** 2 + interpolatedPosition.y ** 2);
    
    const kalmanJump = Math.abs(inputDistance - kalmanDistance);
    const interpolatorJump = Math.abs(kalmanDistance - finalDistance);
    
    if (kalmanJump > 30 || interpolatorJump > 30) {
      console.warn('🔧 CLIENT FILTER JUMP v2.3+:', {
        input: inputDistance.toFixed(1) + 'mm',
        afterKalman: kalmanDistance.toFixed(1) + 'mm', 
        afterInterpolator: finalDistance.toFixed(1) + 'mm',
        kalmanJump: kalmanJump.toFixed(1) + 'mm',
        interpolatorJump: interpolatorJump.toFixed(1) + 'mm',
        dt: lastPacketTime > 0 ? ((validTime - lastPacketTime)).toFixed(1) + 'ms' : 'N/A'
      });
    }

    const velocity = interpolator?.getVelocity() ?? { x: 0, y: 0 };
    const latency = currentRenderTime - validTime;
    
    lastPacketTime = validTime;

    state.update(s => ({
      ...s,
      currentSample: sample,
      filteredPosition,
      interpolatedPosition,
      velocity,
      latency,
      packetRate: packetTimes.length
    }));
  }

  function getSampleHistory(count: number = 100): StabilogramSample[] {
    if (!sampleHistory) return [];
    const result: StabilogramSample[] = [];
    const maxCount = Math.min(count, sampleHistory.length);
    for (let i = 0; i < maxCount; i++) {
      const sample = sampleHistory.peek(sampleHistory.length - 1 - i);
      if (sample) result.unshift(sample);
    }
    return result;
  }

  function getRenderPosition(): Vector2D {
    if (interpolator) {
      return interpolator.getInterpolatedPosition();
    }
    return get(state).filteredPosition;
  }

  function getRenderVelocity(): Vector2D {
    if (interpolator) return interpolator.getVelocity();
    return ZERO_VELOCITY;
  }

  // ✅ НОВЫЙ МЕТОД: Диагностика интерполятора
  function getInterpolatorDebug() {
    return interpolator?.getDebugInfo() || null;
  }

  function setCalibration(data: CalibrationData): void {
    calibrationStore.set(data);
    state.update(s => ({ ...s, isCalibrated: true }));
  }

  function setAxisConfig(newConfig: AxisConfiguration): void {
    axisConfigStore.set(newConfig);
  }

  function setWsConnected(connected: boolean): void {
    state.update(s => ({ 
      ...s, 
      isWsConnected: connected,
      isDeviceConnected: connected ? s.isDeviceConnected : false 
    }));
  }

  function setDeviceConnected(connected: boolean): void {
    state.update(s => ({ ...s, isDeviceConnected: connected }));
    if (!connected) {
      kalmanFilter?.reset();
      interpolator?.reset();
      sampleHistory?.clear();
    }
  }

  function updateFps(fps: number): void {
    state.update(s => ({ ...s, fps }));
  }

  function setScale(scale: number): void {
    state.update(s => ({ ...s, scale: Math.max(1, Math.min(20, scale)) }));
  }

  return {
    subscribe: state.subscribe,
    initialize,
    initializeGameMode,
    resetGameMode,
    processSample,
    getSampleHistory,
    getRenderPosition,
    getRenderVelocity,
    getInterpolatorDebug, // ✅ НОВОЕ
    setCalibration,
    setAxisConfig,
    setWsConnected,
    setDeviceConnected,
    updateFps,
    setScale,
    calibration: { subscribe: calibrationStore.subscribe },
    axisConfig: { subscribe: axisConfigStore.subscribe },
    isReady: derived(state, s => s.isDeviceConnected && s.isCalibrated),
    position: derived(state, s => s.interpolatedPosition),
    
    get isGameModeInitialized() { return isGameModeInitialized; },
    get isInitialized() { return isInitialized; },
    get sampleCount() { return sampleHistory?.length ?? 0; }
  };
}

export const stabilogramStore = createStabilogramStore();

if (typeof window !== 'undefined') {
  (window as any).stabilogramStore = stabilogramStore;
}

export const currentPosition = derived(stabilogramStore, state => state.interpolatedPosition);
export const isStabilogramReady = derived(stabilogramStore, state => state.isDeviceConnected && state.isCalibrated);
export const connectionStatus = derived(stabilogramStore, state => ({
  ws: state.isWsConnected,
  device: state.isDeviceConnected,
  calibrated: state.isCalibrated
}));