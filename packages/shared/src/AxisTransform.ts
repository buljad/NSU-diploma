// packages/shared/src/AxisTransform.ts

import type { Coordinates, AxisConfiguration } from './types.js';

export class AxisTransform {
  private config: AxisConfiguration;
  private sinRot: number = 0;
  private cosRot: number = 1;

  constructor(config: AxisConfiguration) {
    this.config = { ...config };
    this.updateRotationCache();
  }

  updateConfig(config: AxisConfiguration): void {
    this.config = { ...config };
    this.updateRotationCache();
  }

  private updateRotationCache(): void {
    const radians = (this.config.rotationDeg * Math.PI) / 180;
    this.sinRot = Math.sin(radians);
    this.cosRot = Math.cos(radians);
  }

  transform(coords: Coordinates): Coordinates {
    let x = coords.x;
    let y = coords.y;

    if (this.config.swapXY) {
      [x, y] = [y, x];
    }

    if (this.config.rotationDeg !== 0) {
      const newX = x * this.cosRot - y * this.sinRot;
      const newY = x * this.sinRot + y * this.cosRot;
      x = newX;
      y = newY;
    }

    if (this.config.invertX) x = -x;
    if (this.config.invertY) y = -y;

    return { x, y, z: coords.z, f: coords.f };
  }

  inverse(coords: Coordinates): Coordinates {
    let x = coords.x;
    let y = coords.y;

    if (this.config.invertX) x = -x;
    if (this.config.invertY) y = -y;

    if (this.config.rotationDeg !== 0) {
      const newX = x * this.cosRot + y * this.sinRot;
      const newY = -x * this.sinRot + y * this.cosRot;
      x = newX;
      y = newY;
    }

    if (this.config.swapXY) {
      [x, y] = [y, x];
    }

    return { x, y, z: coords.z, f: coords.f };
  }

  getConfig(): AxisConfiguration {
    return { ...this.config };
  }
}