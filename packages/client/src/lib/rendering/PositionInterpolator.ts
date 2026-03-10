// packages/client/src/lib/rendering/PositionInterpolator.ts

import type { Vector2D } from '@stabilometer/shared';

interface SamplePoint {
  position: Vector2D;
  velocity: Vector2D;
  timestamp: number;
}

export class PositionInterpolator {
  private samples: SamplePoint[] = [];
  private readonly maxSamples = 5;
  private currentPosition: Vector2D = { x: 0, y: 0 };
  private currentVelocity: Vector2D = { x: 0, y: 0 };
  private smoothingFactor = 0.3;

  addSample(position: Vector2D, timestamp: number): void {
    let velocity: Vector2D = { x: 0, y: 0 };

    if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1];
      const dt = (timestamp - last.timestamp) / 1000;

      if (dt > 0 && dt < 0.5) {
        velocity = {
          x: (position.x - last.position.x) / dt,
          y: (position.y - last.position.y) / dt
        };
      }
    }

    this.samples.push({ position, velocity, timestamp });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getInterpolatedPosition(renderTime: number = performance.now()): Vector2D {
    if (this.samples.length === 0) {
      return this.currentPosition;
    }

    const latest = this.samples[this.samples.length - 1];
    const timeSince = renderTime - latest.timestamp;

    let target: Vector2D;

    if (timeSince <= 40) {
      const dt = timeSince / 1000;
      target = {
        x: latest.position.x + latest.velocity.x * dt,
        y: latest.position.y + latest.velocity.y * dt
      };
    } else {
      target = latest.position;
    }

    this.currentPosition = {
      x: this.currentPosition.x + (target.x - this.currentPosition.x) * this.smoothingFactor,
      y: this.currentPosition.y + (target.y - this.currentPosition.y) * this.smoothingFactor
    };

    this.currentVelocity = {
      x: this.currentVelocity.x + (latest.velocity.x - this.currentVelocity.x) * this.smoothingFactor,
      y: this.currentVelocity.y + (latest.velocity.y - this.currentVelocity.y) * this.smoothingFactor
    };

    return this.currentPosition;
  }

  getVelocity(): Vector2D {
    return this.currentVelocity;
  }

  reset(): void {
    this.samples = [];
    this.currentPosition = { x: 0, y: 0 };
    this.currentVelocity = { x: 0, y: 0 };
  }
}