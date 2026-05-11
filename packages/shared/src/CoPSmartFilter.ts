// packages/shared/src/CoPSmartFilter.ts

import type { Coordinates } from "./types.js";

interface FilteredCoP {
  x: number;
  y: number;
  wasFiltered: boolean;
  confidence: number;
}

export class CoPSmartFilter {
  private readonly bufferSize = 5; // медианное окно
  private buffer: Array<{ x: number; y: number; t: number }> = [];
  private head = 0;

  private lastOutputCoP: { x: number; y: number } | null = null;
  private frozenCount = 0;
  private readonly frozenThreshold = 10; // 10 пакетов подряд = замирание
  private readonly epsilon = 0.05; // 0.05mm = почти неподвижно

  private readonly maxJumpMm = 40; // ПОРОГ ВЫБРОСА

  private stats = {
    totalSamples: 0,
    filtered: 0,
    frozenDetected: 0,
    outliersDetected: 0,
  };

  filter(cop: Coordinates, timestamp: number): FilteredCoP {
    this.stats.totalSamples++;

    // Добавляем в буфер
    this.addToBuffer(cop.x, cop.y, timestamp);

    // Недостаточно данных - осторожный старт
    if (this.buffer.length < 3) {
      const result = { x: cop.x, y: cop.y, wasFiltered: false, confidence: 0.7 };
      this.lastOutputCoP = { x: cop.x, y: cop.y };
      return result;
    }

    // Медианная фильтрация
    const medianX = this.getMedianX();
    const medianY = this.getMedianY();

    let outputX = medianX;
    let outputY = medianY;
    let wasFiltered = false;
    let confidence = 1.0;

    // ✅ ДЕТЕКЦИЯ ВЫБРОСОВ
    if (this.lastOutputCoP) {
      const jump = Math.sqrt(
        (medianX - this.lastOutputCoP.x) ** 2 +
        (medianY - this.lastOutputCoP.y) ** 2
      );

      if (jump > this.maxJumpMm) {
        this.stats.outliersDetected++;

        // АГРЕССИВНОЕ СГЛАЖИВАНИЕ
        const smoothFactor = Math.min(this.maxJumpMm / jump, 0.3);
        outputX = this.lastOutputCoP.x + (medianX - this.lastOutputCoP.x) * smoothFactor;
        outputY = this.lastOutputCoP.y + (medianY - this.lastOutputCoP.y) * smoothFactor;
        
        wasFiltered = true;
        confidence = smoothFactor;
      }
    }

    // ✅ ДЕТЕКЦИЯ ЗАМИРАНИЯ CoP
    const isFrozen = this.detectFreezing(outputX, outputY);
    if (isFrozen) {
      this.stats.frozenDetected++;
      // Добавляем микроскопический шум для "оживления"
      const noise = 0.1;
      outputX += (Math.random() - 0.5) * noise;
      outputY += (Math.random() - 0.5) * noise;
      wasFiltered = true;
      confidence = 0.5;
    }

    if (wasFiltered) {
      this.stats.filtered++;
    }

    this.lastOutputCoP = { x: outputX, y: outputY };

    return { x: outputX, y: outputY, wasFiltered, confidence };
  }

  private addToBuffer(x: number, y: number, t: number): void {
    if (this.buffer.length < this.bufferSize) {
      this.buffer.push({ x, y, t });
    } else {
      this.buffer[this.head] = { x, y, t };
      this.head = (this.head + 1) % this.bufferSize;
    }
  }

  private getMedianX(): number {
    const values = this.buffer.map(p => p.x).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }

  private getMedianY(): number {
    const values = this.buffer.map(p => p.y).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }

  private detectFreezing(x: number, y: number): boolean {
    if (!this.lastOutputCoP) {
      this.frozenCount = 0;
      return false;
    }

    const distance = Math.sqrt(
      (x - this.lastOutputCoP.x) ** 2 + (y - this.lastOutputCoP.y) ** 2
    );

    if (distance < this.epsilon) {
      this.frozenCount++;
      return this.frozenCount >= this.frozenThreshold;
    } else {
      this.frozenCount = 0;
      return false;
    }
  }

  getStats() {
    return {
      ...this.stats,
      filterRate: this.stats.totalSamples > 0
        ? ((this.stats.filtered / this.stats.totalSamples) * 100).toFixed(1) + "%"
        : "0%",
    };
  }

  reset(): void {
    this.buffer = [];
    this.head = 0;
    this.lastOutputCoP = null;
    this.frozenCount = 0;
  }
}