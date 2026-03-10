// packages/client/src/lib/filters/KalmanFilter.ts
// (Копируем содержимое из shared или импортируем, но для клиента лучше иметь свою копию)

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

  constructor(options: {
    processNoise?: number;
    measurementNoise?: number;
    dt?: number;
  } = {}) {
    const processNoise = options.processNoise ?? 0.1;
    const measurementNoise = options.measurementNoise ?? 2;
    this.dt = options.dt ?? 0.02;

    this.state = new Float64Array([0, 0, 0, 0]);

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
      this.initialized = true;
      return this.getState();
    }

    // Predict
    const x = this.state[0] + this.state[2] * this.dt;
    const y = this.state[1] + this.state[3] * this.dt;
    this.state[0] = x;
    this.state[1] = y;

    // Simplified update (for performance)
    const kx = 0.3;
    const ky = 0.3;
    
    this.state[0] += kx * (measuredX - this.state[0]);
    this.state[1] += ky * (measuredY - this.state[1]);
    this.state[2] += kx * 0.5 * (measuredX - x) / this.dt;
    this.state[3] += ky * 0.5 * (measuredY - y) / this.dt;

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
  }
}