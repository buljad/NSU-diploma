// packages/client/src/lib/filters/KalmanFilter.ts

export class KalmanFilter2D {
  private state: Float64Array;
  private P: Float64Array;
  private F: Float64Array;
  private H: Float64Array;
  private Q: Float64Array;
  private R: Float64Array;
  private temp4x4: Float64Array;
  private temp4x2: Float64Array;
  private temp2x2: Float64Array;
  private temp2x4: Float64Array;
  private K: Float64Array;
  private dt: number;
  private initialized: boolean = false;
  
  // ✅ ЗАЩИТА ОТ ВЫБРОСОВ
  private lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  private outlierThreshold: number = 80; // мм
  private maxVelocity: number = 600; // мм/с

  constructor(options: {
    processNoise?: number;
    measurementNoise?: number;
    dt?: number;
  } = {}) {
    // ✅ УЛУЧШЕННЫЕ ПАРАМЕТРЫ
    const processNoise = options.processNoise ?? 0.5;  // ✅ Было 0.1
    const measurementNoise = options.measurementNoise ?? 1.0;  // ✅ Было 2.0
    this.dt = options.dt ?? 0.02;

    this.state = new Float64Array([0, 0, 0, 0]); // [x, y, vx, vy]

    this.P = new Float64Array([
      1000, 0, 0, 0,
      0, 1000, 0, 0,
      0, 0, 1000, 0,
      0, 0, 0, 1000
    ]);

    this.F = new Float64Array([
      1, 0, this.dt, 0,
      0, 1, 0, this.dt,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);

    this.H = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0]);

    const q = processNoise;
    const dt2 = this.dt * this.dt;
    const dt3 = dt2 * this.dt;
    const dt4 = dt3 * this.dt;

    this.Q = new Float64Array([
      dt4/4*q, 0, dt3/2*q, 0,
      0, dt4/4*q, 0, dt3/2*q,
      dt3/2*q, 0, dt2*q, 0,
      0, dt3/2*q, 0, dt2*q
    ]);

    this.R = new Float64Array([
      measurementNoise * measurementNoise, 0,
      0, measurementNoise * measurementNoise
    ]);

    this.temp4x4 = new Float64Array(16);
    this.temp4x2 = new Float64Array(8);
    this.temp2x2 = new Float64Array(4);
    this.temp2x4 = new Float64Array(8);
    this.K = new Float64Array(8);
  }

  update(measuredX: number, measuredY: number, dt?: number): { x: number; y: number; vx: number; vy: number } {
    if (dt !== undefined && dt > 0 && Math.abs(dt - this.dt) > 0.0001) {
      this.dt = dt;
      this.F[2] = dt;
      this.F[7] = dt;
    }

    if (!this.initialized) {
      this.state[0] = measuredX;
      this.state[1] = measuredY;
      this.state[2] = 0;
      this.state[3] = 0;
      this.lastPosition = { x: measuredX, y: measuredY };
      this.initialized = true;
      return this.getState();
    }

    // ✅ ДЕТЕКЦИЯ ВЫБРОСОВ
    const deltaX = measuredX - this.lastPosition.x;
    const deltaY = measuredY - this.lastPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    let trustFactor = 1.0;
    if (distance > this.outlierThreshold) {
      trustFactor = this.outlierThreshold / distance;
      console.warn(`🚨 Выброс ${distance.toFixed(1)}mm, доверие: ${trustFactor.toFixed(2)}`);
    }

    // Predict
    const x = this.state[0] + this.state[2] * this.dt;
    const y = this.state[1] + this.state[3] * this.dt;
    this.state[0] = x;
    this.state[1] = y;

    // ✅ АДАПТИВНАЯ КОРРЕКЦИЯ вместо констант
    // Чем больше доверие к измерению, тем сильнее коррекция
    const basePosGain = 0.2;
    const baseVelGain = 0.1;
    
    const posGain = basePosGain + (0.4 * trustFactor);  // 0.2-0.6
    const velGain = baseVelGain + (0.2 * trustFactor);  // 0.1-0.3
    
    // Коррекция позиции
    this.state[0] += posGain * (measuredX - this.state[0]);
    this.state[1] += posGain * (measuredY - this.state[1]);
    
    // Коррекция скорости
    this.state[2] += velGain * (measuredX - x) / this.dt;
    this.state[3] += velGain * (measuredY - y) / this.dt;
    
    // ✅ ОГРАНИЧЕНИЕ СКОРОСТИ
    this.state[2] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[2]));
    this.state[3] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[3]));

    // Обновляем последнюю позицию
    this.lastPosition.x = this.state[0];
    this.lastPosition.y = this.state[1];

    return this.getState();
  }

  getState(): { x: number; y: number; vx: number; vy: number } {
    return {
      x: this.state[0],
      y: this.state[1],
      vx: this.state[2],
      vy: this.state[3]
    };
  }

  reset(): void {
    this.state.fill(0);
    this.initialized = false;
    this.lastPosition = { x: 0, y: 0 };
  }
}