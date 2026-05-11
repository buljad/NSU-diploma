// packages/client/src/lib/filters/KalmanFilter.ts

export interface Vector2D {
  x: number;
  y: number;
}

export interface KalmanState extends Vector2D {
  vx: number;
  vy: number;
}

export interface FilterConfig {
  processNoise?: number;
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
 * Адаптивный Kalman фильтр для CoP данных v2.3+
 * 
 * ✅ ИСПРАВЛЕНО для плавных движений:
 * - Менее агрессивная коррекция для gentle и medium движений
 * - Улучшенное сглаживание переходов между типами движений
 * - Защита от рывков при малых изменениях
 */
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
  private lastPosition: Vector2D = { x: 0, y: 0 };
  
  // ✅ ИСПРАВЛЕННЫЕ пороги для плавных движений
  private lightOutlierThreshold: number = 40;     // Было 30 → стало 40
  private mediumOutlierThreshold: number = 80;    // Было 60 → стало 80  
  private criticalOutlierThreshold: number = 150; // Было 120 → стало 150
  private extremeOutlierThreshold: number = 250;  // Было 200 → стало 250
  
  private maxVelocity: number = 800;
  
  private criticalOutlierCount = 0;
  private extremeOutlierCount = 0;
  private readonly maxCriticalOutliers = 5;
  private readonly maxExtremeOutliers = 3;
  
  // ✅ ИСПРАВЛЕННЫЕ коэффициенты для плавных движений
  private adaptiveGains: boolean = true;
  private basePosGain: number = 0.25;  // Было 0.4 → стало 0.25 (менее агрессивно)
  private baseVelGain: number = 0.15;  // Было 0.2 → стало 0.15
  private maxPosGain: number = 0.7;    // Было 0.8 → стало 0.7
  private maxVelGain: number = 0.35;   // Было 0.4 → стало 0.35
  
  private stats: FilterStats;
  private verboseLogging: boolean = false;
  private distanceBuffer: number[] = [];
  private readonly maxDistanceBuffer = 50;

  constructor(config: FilterConfig = {}) {
    const processNoise = config.processNoise ?? 0.05; // Было 0.2 → стало 0.15
    const measurementNoise = config.measurementNoise ?? 2.0; // Было 1.0 → стало 1.2
    this.dt = config.dt ?? 0.02;
    
    this.lightOutlierThreshold = config.outlierThreshold ?? 30;
    this.criticalOutlierThreshold = config.criticalOutlierThreshold ?? 150;
    this.maxVelocity = config.maxVelocity ?? 800;
    this.adaptiveGains = config.adaptiveGains ?? true;
    this.verboseLogging = config.verboseLogging ?? false;

    // Инициализация матриц состояния
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

    this.H = new Float64Array([
      1, 0, 0, 0,
      0, 1, 0, 0
    ]);

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

    const r = measurementNoise * measurementNoise;
    this.R = new Float64Array([
      r, 0,
      0, r
    ]);

    this.temp4x4 = new Float64Array(16);
    this.temp4x2 = new Float64Array(8);
    this.temp2x2 = new Float64Array(4);
    this.temp2x4 = new Float64Array(8);
    this.K = new Float64Array(8);

    this.stats = {
      totalUpdates: 0,
      outlierDetections: 0,
      criticalOutliers: 0,
      autoResets: 0,
      averageDistance: 0,
      maxDistanceSeen: 0
    };

    if (this.verboseLogging) {
      console.log('🎯 KalmanFilter2D v2.3+ initialized (gentle movement optimized):', {
        processNoise,
        measurementNoise,
        thresholds: {
          light: this.lightOutlierThreshold,
          medium: this.mediumOutlierThreshold,
          critical: this.criticalOutlierThreshold,
          extreme: this.extremeOutlierThreshold
        },
        gains: {
          base: { pos: this.basePosGain, vel: this.baseVelGain },
          max: { pos: this.maxPosGain, vel: this.maxVelGain }
        }
      });
    }
  }

  update(measuredX: number, measuredY: number, dt?: number): KalmanState {
    this.stats.totalUpdates++;

    if (dt !== undefined && dt > 0.001 && dt < 0.5) {
      if (Math.abs(dt - this.dt) > 0.001) {
        this.updateTransitionMatrix(dt);
      }
    }

    if (!this.initialized) {
      return this.initializeFilter(measuredX, measuredY);
    }

    const movement = this.analyzeMovement(measuredX, measuredY);
    
    if (movement.distance > this.extremeOutlierThreshold) {
      return this.handleExtremeOutlier(measuredX, measuredY, movement);
    }

    if (movement.distance > this.criticalOutlierThreshold) {
      return this.handleCriticalOutlier(measuredX, measuredY, movement);
    }

    return this.performStandardUpdate(measuredX, measuredY, movement);
  }

  private updateTransitionMatrix(newDt: number): void {
    this.dt = newDt;
    this.F[2] = newDt;
    this.F[7] = newDt;

    const q = 0.15;
    const dt2 = newDt * newDt;
    const dt3 = dt2 * newDt;
    const dt4 = dt3 * newDt;

    this.Q[0] = dt4/4*q;
    this.Q[5] = dt4/4*q;
    this.Q[2] = dt3/2*q;
    this.Q[4] = dt3/2*q;
    this.Q[7] = dt3/2*q;
    this.Q[13] = dt3/2*q;
    this.Q[10] = dt2*q;
    this.Q[15] = dt2*q;
  }

  private initializeFilter(measuredX: number, measuredY: number): KalmanState {
    this.state[0] = measuredX;
    this.state[1] = measuredY;
    this.state[2] = 0;
    this.state[3] = 0;
    
    this.lastPosition = { x: measuredX, y: measuredY };
    this.initialized = true;
    
    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;
    
    if (this.verboseLogging) {
      console.log(`🎯 Kalman filter v2.3+ initialized at (${measuredX.toFixed(1)}, ${measuredY.toFixed(1)})`);
    }
    
    return this.getState();
  }

  private analyzeMovement(measuredX: number, measuredY: number): {
    distance: number;
    velocity: number;
    deltaX: number; 
    deltaY: number;
    movementType: 'gentle' | 'medium' | 'sharp' | 'critical' | 'extreme';
  } {
    const deltaX = measuredX - this.lastPosition.x;
    const deltaY = measuredY - this.lastPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / this.dt;

    this.updateDistanceStats(distance);

    let movementType: 'gentle' | 'medium' | 'sharp' | 'critical' | 'extreme';
    
    if (distance <= this.lightOutlierThreshold) {
      movementType = 'gentle';
    } else if (distance <= this.mediumOutlierThreshold) {
      movementType = 'medium';  
    } else if (distance <= this.criticalOutlierThreshold) {
      movementType = 'sharp';
    } else if (distance <= this.extremeOutlierThreshold) {
      movementType = 'critical';
    } else {
      movementType = 'extreme';
    }

    return { distance, velocity, deltaX, deltaY, movementType };
  }

  private handleExtremeOutlier(measuredX: number, measuredY: number, movement: any): KalmanState {
    this.extremeOutlierCount++;
    this.stats.criticalOutliers++;

    if (this.verboseLogging) {
      console.error(`🚨 ЭКСТРЕМАЛЬНЫЙ ВЫБРОС: ${movement.distance.toFixed(1)}mm (серия: ${this.extremeOutlierCount})`);
    }

    if (this.extremeOutlierCount >= this.maxExtremeOutliers) {
      console.warn('♻️ ПОЛНЫЙ АВТОСБРОС фильтра из-за серии экстремальных выбросов');
      this.reset();
      this.stats.autoResets++;
      return this.initializeFilter(measuredX, measuredY);
    }

    this.predictOnly();
    return this.getState();
  }

  private handleCriticalOutlier(measuredX: number, measuredY: number, movement: any): KalmanState {
    this.criticalOutlierCount++;
    this.stats.criticalOutliers++;

    if (this.verboseLogging) {
      console.warn(`🔶 Критический выброс: ${movement.distance.toFixed(1)}mm (серия: ${this.criticalOutlierCount})`);
    }

    if (this.criticalOutlierCount >= this.maxCriticalOutliers) {
      console.warn('♻️ МЯГКИЙ АВТОСБРОС фильтра из-за серии критических выбросов');
      this.softReset(measuredX, measuredY);
      this.stats.autoResets++;
      return this.getState();
    }

    const trustFactor = 0.1;
    return this.performWeightedUpdate(measuredX, measuredY, trustFactor, 'critical');
  }

  private performStandardUpdate(measuredX: number, measuredY: number, movement: any): KalmanState {
    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;

    // ✅ УЛУЧШЕННЫЙ расчет доверия для плавных движений
    let trustFactor = 1.0;
    
    if (movement.distance > this.lightOutlierThreshold) {
      this.stats.outlierDetections++;
      
      if (movement.movementType === 'medium') {
        // ✅ ПЛАВНЫЕ СКАЧКИ: высокое доверие
        trustFactor = 0.8 + (this.mediumOutlierThreshold - movement.distance) / 
                     (this.mediumOutlierThreshold - this.lightOutlierThreshold) * 0.15;
        
      } else if (movement.movementType === 'sharp') {
        // ✅ РЕЗКИЕ ДВИЖЕНИЯ: среднее доверие
        trustFactor = 0.5 + (this.criticalOutlierThreshold - movement.distance) / 
                     (this.criticalOutlierThreshold - this.mediumOutlierThreshold) * 0.3;
      }

      if (this.verboseLogging && movement.distance > this.mediumOutlierThreshold) {
        console.log(`🔥 ${movement.movementType.toUpperCase()} движение: ${movement.distance.toFixed(1)}mm, доверие: ${trustFactor.toFixed(2)}`);
      }
    }

    return this.performWeightedUpdate(measuredX, measuredY, trustFactor, movement.movementType);
  }

  private performWeightedUpdate(measuredX: number, measuredY: number, trustFactor: number, type: string): KalmanState {
    this.predictOnly();

    const predictionError = {
      x: measuredX - this.state[0],
      y: measuredY - this.state[1]
    };

    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Менее агрессивные коэффициенты для плавных движений
    let posGain = this.basePosGain;
    let velGain = this.baseVelGain;

    if (this.adaptiveGains) {
      posGain = this.basePosGain + (this.maxPosGain - this.basePosGain) * trustFactor;
      velGain = this.baseVelGain + (this.maxVelGain - this.baseVelGain) * trustFactor;
      
      // ✅ НОВАЯ ЛОГИКА: Снижаем агрессивность для плавных и средних движений
      if (type === 'gentle') {
        posGain *= 0.4; // 60% снижение коррекции для плавных движений
        velGain *= 0.3; // 70% снижение коррекции скорости
        
      } else if (type === 'medium') {
        posGain *= 0.7; // 30% снижение для средних движений
        velGain *= 0.6; // 40% снижение
        
      } else if (type === 'sharp' && trustFactor > 0.6) {
        posGain *= 1.1; // Небольшое увеличение для доверенных резких движений
        velGain *= 1.05;
      }
    }

    // Обновляем позицию
    this.state[0] += posGain * predictionError.x;
    this.state[1] += posGain * predictionError.y;
    
    // Обновляем скорость
    this.state[2] += velGain * predictionError.x / this.dt;
    this.state[3] += velGain * predictionError.y / this.dt;
    
    // Ограничиваем скорости
    this.state[2] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[2]));
    this.state[3] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[3]));

    this.lastPosition.x = this.state[0];
    this.lastPosition.y = this.state[1];

    return this.getState();
  }

  private predictOnly(): void {
    this.state[0] += this.state[2] * this.dt;
    this.state[1] += this.state[3] * this.dt;
  }

  private softReset(measuredX: number, measuredY: number): void {
    this.state[0] = measuredX;
    this.state[1] = measuredY;
    this.state[2] = 0;
    this.state[3] = 0;

    this.P[0] = 500;
    this.P[5] = 500;
    this.P[10] = 1000;
    this.P[15] = 1000;

    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;
    this.lastPosition = { x: measuredX, y: measuredY };

    if (this.verboseLogging) {
      console.log(`♻️ Мягкий сброс на позицию (${measuredX.toFixed(1)}, ${measuredY.toFixed(1)})`);
    }
  }

  private updateDistanceStats(distance: number): void {
    if (distance > this.stats.maxDistanceSeen) {
      this.stats.maxDistanceSeen = distance;
    }

    this.distanceBuffer.push(distance);
    if (this.distanceBuffer.length > this.maxDistanceBuffer) {
      this.distanceBuffer.shift();
    }
    
    this.stats.averageDistance = 
      this.distanceBuffer.reduce((a, b) => a + b, 0) / this.distanceBuffer.length;
  }

  // ✅ ПУБЛИЧНЫЕ МЕТОДЫ (без изменений)

  getState(): KalmanState {
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
    this.extremeOutlierCount = 0;
    this.distanceBuffer = [];
    
    this.stats.autoResets++;
    
    if (this.verboseLogging) {
      console.log('♻️ Полный сброс Kalman фильтра v2.3+');
    }
  }

  getStats(): FilterStats {
    return { ...this.stats };
  }

  getConfiguration(): {
    thresholds: { light: number; medium: number; critical: number; extreme: number };
    gains: { basePos: number; baseVel: number; maxPos: number; maxVel: number };
    adaptiveGains: boolean;
    maxVelocity: number;
  } {
    return {
      thresholds: {
        light: this.lightOutlierThreshold,
        medium: this.mediumOutlierThreshold,  
        critical: this.criticalOutlierThreshold,
        extreme: this.extremeOutlierThreshold
      },
      gains: {
        basePos: this.basePosGain,
        baseVel: this.baseVelGain,
        maxPos: this.maxPosGain,
        maxVel: this.maxVelGain
      },
      adaptiveGains: this.adaptiveGains,
      maxVelocity: this.maxVelocity
    };
  }

  updateConfiguration(config: Partial<FilterConfig>): void {
    if (config.outlierThreshold !== undefined) {
      this.lightOutlierThreshold = config.outlierThreshold;
    }
    if (config.criticalOutlierThreshold !== undefined) {
      this.criticalOutlierThreshold = config.criticalOutlierThreshold;
    }
    if (config.maxVelocity !== undefined) {
      this.maxVelocity = config.maxVelocity;
    }
    if (config.adaptiveGains !== undefined) {
      this.adaptiveGains = config.adaptiveGains;
    }
    if (config.verboseLogging !== undefined) {
      this.verboseLogging = config.verboseLogging;
    }

    if (this.verboseLogging) {
      console.log('🔧 Kalman filter v2.3+ configuration updated:', config);
    }
  }

  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
  }

  // ✅ СПЕЦИАЛЬНЫЕ РЕЖИМЫ (обновлены для плавных движений)

  setModeForGentleMovements(): void {
    this.lightOutlierThreshold = 50;     // Увеличены пороги
    this.mediumOutlierThreshold = 100;   
    this.criticalOutlierThreshold = 180;  
    this.basePosGain = 0.2;              // Снижена агрессивность
    this.maxPosGain = 0.5;
    this.baseVelGain = 0.1;
    this.maxVelGain = 0.25;
    
    console.log('🎯 Kalman filter v2.3+ optimized for gentle movements');
  }

  setModeForSharpMovements(): void {
    this.lightOutlierThreshold = 40;
    this.mediumOutlierThreshold = 80;  
    this.criticalOutlierThreshold = 150;
    this.basePosGain = 0.4;
    this.maxPosGain = 0.8;
    this.baseVelGain = 0.2;
    this.maxVelGain = 0.4;
    
    console.log('🎯 Kalman filter v2.3+ optimized for sharp movements');
  }

  setModeForGaming(): void {
    this.setModeForSharpMovements();
    this.maxVelocity = 1000;
    this.adaptiveGains = true;
    
    console.log('🎮 Kalman filter v2.3+ optimized for gaming');
  }
}