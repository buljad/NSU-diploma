// packages/shared/src/TypedRingBuffer.ts

import { ByteRingBuffer } from './RingBuffer.js';

/**
 * ✅ НОВОЕ: Типизированный буфер для объектов (не байтов)
 */
export class TypedRingBuffer<T> {
  private items: Array<T | undefined>;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private capacity: number;

  constructor(size: number) {
    this.capacity = size;
    this.items = new Array(size);
  }

  push(item: T): boolean {
    if (this.count >= this.capacity) {
      return false; // Буфер полон
    }

    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    this.count++;
    return true;
  }

  pop(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }

    const item = this.items[this.tail];
    this.items[this.tail] = undefined;
    this.tail = (this.tail + 1) % this.capacity;
    this.count--;
    return item;
  }

  peek(offset: number = 0): T | undefined {
    if (offset >= this.count || offset < 0) {
      return undefined;
    }

    const index = (this.tail + offset) % this.capacity;
    return this.items[index];
  }

  get length(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count >= this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.peek(i);
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }
}