// packages/client/src/lib/stores/stabilogram.ts

import { writable, derived, get } from 'svelte/store';
import {
  RingBuffer,
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

// ✅ ДОБАВЛЕНО: Предаллоцированный вектор для fallback (zero-GC)
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
  let sampleHistory: RingBuffer<StabilogramSample> | null = null;

  let lastPacketTime = 0;
  let packetTimes: number[] = [];

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
    if (!kalmanFilter) {
      kalmanFilter = new KalmanFilter2D({ processNoise: 0.1, measurementNoise: 2 });
      interpolator = new PositionInterpolator();
      sampleHistory = new RingBuffer(DEFAULT_CONFIG.maxSampleHistory);
      console.log('✅ Stabilogram store initialized');
    }
  }

  function processSample(sample: StabilogramSample): void {
    const now = performance.now();

    packetTimes.push(now);
    packetTimes = packetTimes.filter(t => now - t < 1000);
    
    sampleHistory?.push(sample);

    let filteredPosition = sample.mm;
    if (kalmanFilter) {
      const dt = lastPacketTime > 0 ? (now - lastPacketTime) / 1000 : 0.02;
      const res = kalmanFilter.update(sample.mm.x, sample.mm.y, dt);
      filteredPosition = { x: res.x, y: res.y };
    }

    let interpolatedPosition = filteredPosition;
    if (interpolator) {
      interpolator.addSample(filteredPosition, now);
      interpolatedPosition = interpolator.getInterpolatedPosition(now);
    }

    const velocity = interpolator?.getVelocity() ?? { x: 0, y: 0 };
    const latency = now - sample.clientTime;
    
    lastPacketTime = now;

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

  function getRenderPosition(): Vector2D {
    if (interpolator) {
      return interpolator.getInterpolatedPosition();
    }
    return get(state).filteredPosition;
  }

  // ✅ ДОБАВЛЕНО: Получение скорости для render loop (zero-GC)
  // Возвращает ссылку на внутренний мутируемый объект интерполятора.
  // НЕ создаёт новый объект. Безопасно вызывать каждый кадр.
  function getRenderVelocity(): Vector2D {
    if (interpolator) {
      return interpolator.getVelocity();
    }
    return ZERO_VELOCITY;
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
    processSample,
    getRenderPosition,
    getRenderVelocity,   // ✅ ДОБАВЛЕНО
    setCalibration,
    setAxisConfig,
    setWsConnected,
    setDeviceConnected,
    updateFps,
    setScale,
    calibration: { subscribe: calibrationStore.subscribe },
    axisConfig: { subscribe: axisConfigStore.subscribe },
    isReady: derived(state, s => s.isDeviceConnected && s.isCalibrated),
    position: derived(state, s => s.interpolatedPosition)
  };
}

export const stabilogramStore = createStabilogramStore();