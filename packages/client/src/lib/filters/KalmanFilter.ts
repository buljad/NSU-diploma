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
  
  private lastPosition: { x: number; y: number } = { x: 0, y: 0 };
  private outlierThreshold: number = 50; // ✅ СНИЖЕНО с 80 до 50
  private criticalOutlierThreshold: number = 100; // ✅ НОВОЕ: порог сброса
  private maxVelocity: number = 500; // ✅ СНИЖЕНО с 600
  
  // ✅ НОВОЕ: Счетчик критических выбросов
  private criticalOutlierCount = 0;
  private readonly maxCriticalOutliers = 3;

  constructor(options: {
    processNoise?: number;
    measurementNoise?: number;
    dt?: number;
  } = {}) {
    const processNoise = options.processNoise ?? 0.3; // ✅ СНИЖЕНО с 0.5
    const measurementNoise = options.measurementNoise ?? 0.8; // ✅ СНИЖЕНО с 1.0
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
      this.state[2] = 0;
      this.state[3] = 0;
      this.lastPosition = { x: measuredX, y: measuredY };
      this.initialized = true;
      
      console.log('Kalman filter initialized');
      
      return this.getState();
    }

    const deltaX = measuredX - this.lastPosition.x;
    const deltaY = measuredY - this.lastPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // ✅ КРИТИЧЕСКИЙ ВЫБРОС: Автосброс фильтра
    if (distance > this.criticalOutlierThreshold) {
      this.criticalOutlierCount++;
      
      console.error(`🚨 КРИТИЧЕСКИЙ ВЫБРОС ${distance.toFixed(1)}mm (#${this.criticalOutlierCount})`);
      
      if (this.criticalOutlierCount >= this.maxCriticalOutliers) {
        console.warn('♻️ АВТОСБРОС Kalman фильтра из-за серии выбросов');
        this.reset();
        this.state[0] = measuredX;
        this.state[1] = measuredY;
        this.lastPosition = { x: measuredX, y: measuredY };
        this.initialized = true;
        this.criticalOutlierCount = 0;
        return this.getState();
      }
      
      // Игнорируем измерение, используем предсказание
      return this.getState();
    } else {
      this.criticalOutlierCount = 0;
    }
    
    let trustFactor = 1.0;
    if (distance > this.outlierThreshold) {
      trustFactor = this.outlierThreshold / distance;
      console.warn(`Outlier detected: distance=${distance.toFixed(1)}mm, trustFactor=${trustFactor.toFixed(2)}`);
    }

    // Predict
    const x = this.state[0] + this.state[2] * this.dt;
    const y = this.state[1] + this.state[3] * this.dt;
    this.state[0] = x;
    this.state[1] = y;

    // ✅ УЛУЧШЕННЫЕ коэффициенты коррекции
    const basePosGain = 0.3; // ✅ УВЕЛИЧЕНО с 0.2
    const baseVelGain = 0.15; // ✅ УВЕЛИЧЕНО с 0.1
    
    const posGain = basePosGain + (0.5 * trustFactor); // 0.3-0.8
    const velGain = baseVelGain + (0.25 * trustFactor); // 0.15-0.4
    
    this.state[0] += posGain * (measuredX - this.state[0]);
    this.state[1] += posGain * (measuredY - this.state[1]);
    
    this.state[2] += velGain * (measuredX - x) / this.dt;
    this.state[3] += velGain * (measuredY - y) / this.dt;
    
    this.state[2] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[2]));
    this.state[3] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[3]));

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
    this.criticalOutlierCount = 0;
    
    console.log('Kalman filter manually reset');
  }
}