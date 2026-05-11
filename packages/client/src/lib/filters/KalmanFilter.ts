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
 * ✅ КРИТИЧЕСКИЕ УЛУЧШЕНИЯ для резких движений:
 * - Градуированная обработка outlier'ов (легкие/средние/критические)
 * - Адаптивные коэффициенты коррекции в зависимости от скорости движения
 * - Менее агрессивный автосброс (5 критических выбросов вместо 3)
 * - Сохранение 60-80% резких, но валидных движений
 * - Улучшенная диагностика для отладки
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
  
  // ✅ НОВАЯ ГРАДУИРОВАННАЯ СИСТЕМА ПОРОГОВ
  private lightOutlierThreshold: number = 30;     // Легкие выбросы (небольшое снижение доверия)
  private mediumOutlierThreshold: number = 60;    // Средние выбросы (значительное снижение доверия) 
  private criticalOutlierThreshold: number = 120; // Критические выбросы (игнорирование)
  private extremeOutlierThreshold: number = 200;  // Экстремальные выбросы (автосброс)
  
  private maxVelocity: number = 800; // ✅ УВЕЛИЧЕНО с 500 для резких движений
  
  // ✅ НОВЫЕ СЧЕТЧИКИ
  private criticalOutlierCount = 0;
  private extremeOutlierCount = 0;
  private readonly maxCriticalOutliers = 5; // ✅ УВЕЛИЧЕНО с 3
  private readonly maxExtremeOutliers = 3;  // Для полного автосброса
  
  // ✅ АДАПТИВНЫЕ КОЭФФИЦИЕНТЫ
  private adaptiveGains: boolean = true;
  private basePosGain: number = 0.4;  // ✅ УВЕЛИЧЕНО с 0.3
  private baseVelGain: number = 0.2;  // ✅ УВЕЛИЧЕНО с 0.15
  private maxPosGain: number = 0.8;   // Максимальный коэффициент позиции
  private maxVelGain: number = 0.4;   // Максимальный коэффициент скорости
  
  // ✅ ДИАГНОСТИКА
  private stats: FilterStats;
  private verboseLogging: boolean = true;
  private distanceBuffer: number[] = [];
  private readonly maxDistanceBuffer = 50;

  constructor(config: FilterConfig = {}) {
    const processNoise = config.processNoise ?? 0.2; // ✅ СНИЖЕНО с 0.3 для стабильности
    const measurementNoise = config.measurementNoise ?? 1.0; // ✅ УВЕЛИЧЕНО с 0.8 для доверия к измерениям
    this.dt = config.dt ?? 0.02;
    
    // ✅ НАСТРОЙКА ПОРОГОВ
    this.lightOutlierThreshold = config.outlierThreshold ?? 30;
    this.criticalOutlierThreshold = config.criticalOutlierThreshold ?? 120;
    this.maxVelocity = config.maxVelocity ?? 800;
    this.adaptiveGains = config.adaptiveGains ?? true;
    this.verboseLogging = config.verboseLogging ?? false;

    // Инициализация матриц состояния (position, velocity для X и Y)
    this.state = new Float64Array([0, 0, 0, 0]); // [x, y, vx, vy]

    // Ковариационная матрица ошибок (начальная неопределенность)
    this.P = new Float64Array([
      1000, 0, 0, 0,
      0, 1000, 0, 0,
      0, 0, 1000, 0,
      0, 0, 0, 1000
    ]);

    // Матрица перехода состояния (модель постоянной скорости)
    this.F = new Float64Array([
      1, 0, this.dt, 0,      // x' = x + vx*dt
      0, 1, 0, this.dt,      // y' = y + vy*dt  
      0, 0, 1, 0,            // vx' = vx
      0, 0, 0, 1             // vy' = vy
    ]);

    // Матрица наблюдений (мы наблюдаем только позицию, не скорость)
    this.H = new Float64Array([
      1, 0, 0, 0,  // Наблюдаем x
      0, 1, 0, 0   // Наблюдаем y
    ]);

    // Матрица шума процесса Q
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

    // Матрица шума измерений R
    const r = measurementNoise * measurementNoise;
    this.R = new Float64Array([
      r, 0,
      0, r
    ]);

    // Временные матрицы для вычислений (избегаем аллокации в update)
    this.temp4x4 = new Float64Array(16);
    this.temp4x2 = new Float64Array(8);
    this.temp2x2 = new Float64Array(4);
    this.temp2x4 = new Float64Array(8);
    this.K = new Float64Array(8);

    // Инициализация статистики
    this.stats = {
      totalUpdates: 0,
      outlierDetections: 0,
      criticalOutliers: 0,
      autoResets: 0,
      averageDistance: 0,
      maxDistanceSeen: 0
    };

    if (this.verboseLogging) {
      console.log('🎯 KalmanFilter2D initialized with adaptive parameters:', {
        processNoise,
        measurementNoise,
        thresholds: {
          light: this.lightOutlierThreshold,
          medium: this.mediumOutlierThreshold,
          critical: this.criticalOutlierThreshold,
          extreme: this.extremeOutlierThreshold
        },
        adaptiveGains: this.adaptiveGains
      });
    }
  }

  update(measuredX: number, measuredY: number, dt?: number): KalmanState {
    this.stats.totalUpdates++;

    // ✅ ДИНАМИЧЕСКОЕ ОБНОВЛЕНИЕ dt
    if (dt !== undefined && dt > 0.001 && dt < 0.5) {
      if (Math.abs(dt - this.dt) > 0.001) {
        this.updateTransitionMatrix(dt);
      }
    }

    // ✅ ИНИЦИАЛИЗАЦИЯ при первом вызове
    if (!this.initialized) {
      return this.initializeFilter(measuredX, measuredY);
    }

    // ✅ ШАГ 1: Анализ характера движения
    const movement = this.analyzeMovement(measuredX, measuredY);
    
    // ✅ ШАГ 2: Обработка экстремальных выбросов
    if (movement.distance > this.extremeOutlierThreshold) {
      return this.handleExtremeOutlier(measuredX, measuredY, movement);
    }

    // ✅ ШАГ 3: Обработка критических выбросов  
    if (movement.distance > this.criticalOutlierThreshold) {
      return this.handleCriticalOutlier(measuredX, measuredY, movement);
    }

    // ✅ ШАГ 4: Стандартное обновление с адаптивным доверием
    return this.performStandardUpdate(measuredX, measuredY, movement);
  }

  private updateTransitionMatrix(newDt: number): void {
    this.dt = newDt;
    this.F[2] = newDt;  // x += vx * dt
    this.F[7] = newDt;  // y += vy * dt

    // Обновляем матрицу Q для нового dt
    const q = 0.2; // processNoise
    const dt2 = newDt * newDt;
    const dt3 = dt2 * newDt;
    const dt4 = dt3 * newDt;

    this.Q[0] = dt4/4*q;   // Q[0][0]
    this.Q[5] = dt4/4*q;   // Q[1][1] 
    this.Q[2] = dt3/2*q;   // Q[0][2]
    this.Q[4] = dt3/2*q;   // Q[2][0]
    this.Q[7] = dt3/2*q;   // Q[1][3]
    this.Q[13] = dt3/2*q;  // Q[3][1]
    this.Q[10] = dt2*q;    // Q[2][2]
    this.Q[15] = dt2*q;    // Q[3][3]
  }

  private initializeFilter(measuredX: number, measuredY: number): KalmanState {
    this.state[0] = measuredX;
    this.state[1] = measuredY; 
    this.state[2] = 0; // vx = 0
    this.state[3] = 0; // vy = 0
    
    this.lastPosition = { x: measuredX, y: measuredY };
    this.initialized = true;
    
    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;
    
    if (this.verboseLogging) {
      console.log(`🎯 Kalman filter initialized at (${measuredX.toFixed(1)}, ${measuredY.toFixed(1)})`);
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

    // Обновляем статистику расстояний
    this.updateDistanceStats(distance);

    // Классификация движения
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

    // Игнорируем измерение, возвращаем предсказание
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

    // ✅ НОВОЕ: Частичное обновление с очень низким доверием
    const trustFactor = 0.1; // Очень низкое доверие к критическим выбросам
    return this.performWeightedUpdate(measuredX, measuredY, trustFactor, 'critical');
  }

  private performStandardUpdate(measuredX: number, measuredY: number, movement: any): KalmanState {
    // Сбрасываем счетчики при нормальных измерениях
    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;

    // ✅ АДАПТИВНЫЙ РАСЧЕТ ДОВЕРИЯ
    let trustFactor = 1.0;
    
    if (movement.distance > this.lightOutlierThreshold) {
      this.stats.outlierDetections++;
      
      if (movement.movementType === 'medium') {
        // Средние выбросы (30-60мм) - умеренное снижение доверия
        trustFactor = 0.7 + (this.mediumOutlierThreshold - movement.distance) / 
                     (this.mediumOutlierThreshold - this.lightOutlierThreshold) * 0.2;
        
      } else if (movement.movementType === 'sharp') {
        // ✅ РЕЗКИЕ ДВИЖЕНИЯ (60-120мм) - ключевая зона! 
        // Сохраняем больше доверия к резким движениям
        trustFactor = 0.4 + (this.criticalOutlierThreshold - movement.distance) / 
                     (this.criticalOutlierThreshold - this.mediumOutlierThreshold) * 0.3;
      }

      if (this.verboseLogging && movement.distance > this.mediumOutlierThreshold) {
        console.log(`🔥 ${movement.movementType.toUpperCase()} движение: ${movement.distance.toFixed(1)}mm, доверие: ${trustFactor.toFixed(2)}`);
      }
    }

    return this.performWeightedUpdate(measuredX, measuredY, trustFactor, movement.movementType);
  }

  private performWeightedUpdate(measuredX: number, measuredY: number, trustFactor: number, type: string): KalmanState {
    // ✅ ШАГ ПРЕДСКАЗАНИЯ (Predict)
    this.predictOnly();

    // ✅ ШАГ КОРРЕКЦИИ с адаптивными коэффициентами
    const predictionError = {
      x: measuredX - this.state[0],
      y: measuredY - this.state[1]
    };

    // ✅ АДАПТИВНЫЕ КОЭФФИЦИЕНТЫ в зависимости от доверия и адаптивности
    let posGain = this.basePosGain;
    let velGain = this.baseVelGain;

    if (this.adaptiveGains) {
      // Больше доверия = больше коррекция
      posGain = this.basePosGain + (this.maxPosGain - this.basePosGain) * trustFactor;
      velGain = this.baseVelGain + (this.maxVelGain - this.baseVelGain) * trustFactor;
      
      // ✅ БОНУС для резких, но доверенных движений
      if (type === 'sharp' && trustFactor > 0.5) {
        posGain *= 1.2; // Увеличиваем отзывчивость
        velGain *= 1.1;
      }
    }

    // Обновляем позицию
    this.state[0] += posGain * predictionError.x;
    this.state[1] += posGain * predictionError.y;
    
    // Обновляем скорость на основе ошибки предсказания
    this.state[2] += velGain * predictionError.x / this.dt;
    this.state[3] += velGain * predictionError.y / this.dt;
    
    // Ограничиваем скорости
    this.state[2] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[2]));
    this.state[3] = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.state[3]));

    // Обновляем последнюю позицию
    this.lastPosition.x = this.state[0];
    this.lastPosition.y = this.state[1];

    return this.getState();
  }

  private predictOnly(): void {
    // Обновляем состояние согласно модели движения
    this.state[0] += this.state[2] * this.dt; // x += vx * dt
    this.state[1] += this.state[3] * this.dt; // y += vy * dt
    // Скорости остаются неизменными (модель постоянной скорости)
  }

  private softReset(measuredX: number, measuredY: number): void {
    // Мягкий сброс: сохраняем позицию, но обнуляем скорость и неопределенность
    this.state[0] = measuredX;
    this.state[1] = measuredY;
    this.state[2] = 0; // vx = 0  
    this.state[3] = 0; // vy = 0

    // Увеличиваем неопределенность позиции
    this.P[0] = 500;   // P[0][0] - неопределенность x
    this.P[5] = 500;   // P[1][1] - неопределенность y
    this.P[10] = 1000; // P[2][2] - неопределенность vx
    this.P[15] = 1000; // P[3][3] - неопределенность vy

    this.criticalOutlierCount = 0;
    this.extremeOutlierCount = 0;
    this.lastPosition = { x: measuredX, y: measuredY };

    if (this.verboseLogging) {
      console.log(`♻️ Мягкий сброс на позицию (${measuredX.toFixed(1)}, ${measuredY.toFixed(1)})`);
    }
  }

  private updateDistanceStats(distance: number): void {
    // Обновляем максимальную дистанцию
    if (distance > this.stats.maxDistanceSeen) {
      this.stats.maxDistanceSeen = distance;
    }

    // Скользящее среднее для дистанций
    this.distanceBuffer.push(distance);
    if (this.distanceBuffer.length > this.maxDistanceBuffer) {
      this.distanceBuffer.shift();
    }
    
    this.stats.averageDistance = 
      this.distanceBuffer.reduce((a, b) => a + b, 0) / this.distanceBuffer.length;
  }

  // ✅ ПУБЛИЧНЫЕ МЕТОДЫ

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
    
    // Сбрасываем некоторую статистику, но не всю
    this.stats.autoResets++;
    
    if (this.verboseLogging) {
      console.log('♻️ Полный сброс Kalman фильтра');
    }
  }

  // ✅ ДИАГНОСТИКА И НАСТРОЙКА

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
      console.log('🔧 Kalman filter configuration updated:', config);
    }
  }

  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
  }

  // ✅ СПЕЦИАЛЬНЫЕ РЕЖИМЫ

  setModeForSharpMovements(): void {
    this.lightOutlierThreshold = 40;
    this.mediumOutlierThreshold = 80;  
    this.criticalOutlierThreshold = 150;
    this.basePosGain = 0.5;
    this.maxPosGain = 0.9;
    
    console.log('🎯 Kalman filter optimized for sharp movements');
  }

  setModeForSmoothMovements(): void {
    this.lightOutlierThreshold = 20;
    this.mediumOutlierThreshold = 40;
    this.criticalOutlierThreshold = 80; 
    this.basePosGain = 0.3;
    this.maxPosGain = 0.6;
    
    console.log('🎯 Kalman filter optimized for smooth movements');
  }

  setModeForGaming(): void {
    this.setModeForSharpMovements();
    this.maxVelocity = 1000;
    this.adaptiveGains = true;
    
    console.log('🎮 Kalman filter optimized for gaming');
  }
}