// packages/shared/src/RingBuffer.ts

export class RingBuffer<T> {
  private buffer: T[];
  private head: number = 0;
  private tail: number = 0;
  private _length: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): boolean {
    const wasOverflow = this._length === this.capacity;

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;

    if (wasOverflow) {
      this.tail = (this.tail + 1) % this.capacity;
    } else {
      this._length++;
    }

    return wasOverflow;
  }

  shift(): T | undefined {
    if (this._length === 0) return undefined;

    const item = this.buffer[this.tail];
    this.tail = (this.tail + 1) % this.capacity;
    this._length--;

    return item;
  }

  get(index: number): T | undefined {
    if (index < 0 || index >= this._length) return undefined;
    return this.buffer[(this.tail + index) % this.capacity];
  }

  getLast(): T | undefined {
    if (this._length === 0) return undefined;
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity];
  }

  getLastN(n: number): T[] {
    const count = Math.min(n, this._length);
    const result: T[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const idx = (this.head - count + i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx];
    }

    return result;
  }

  toArray(): T[] {
    const result: T[] = new Array(this._length);
    for (let i = 0; i < this._length; i++) {
      result[i] = this.buffer[(this.tail + i) % this.capacity];
    }
    return result;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this._length = 0;
  }

  get length(): number {
    return this._length;
  }

  get isFull(): boolean {
    return this._length === this.capacity;
  }

  get isEmpty(): boolean {
    return this._length === 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this._length; i++) {
      yield this.buffer[(this.tail + i) % this.capacity]!;
    }
  }
}

export class ByteRingBuffer {
  private buffer: Uint8Array;
  private head: number = 0;
  private tail: number = 0;
  private _length: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Uint8Array(capacity);
  }

  write(data: Uint8Array | number[]): number {
    const toWrite = Math.min(data.length, this.capacity - this._length);

    for (let i = 0; i < toWrite; i++) {
      this.buffer[this.head] = data[i];
      this.head = (this.head + 1) % this.capacity;
    }

    this._length += toWrite;
    return toWrite;
  }

  read(count: number): Uint8Array {
    const toRead = Math.min(count, this._length);
    const result = new Uint8Array(toRead);

    for (let i = 0; i < toRead; i++) {
      result[i] = this.buffer[this.tail];
      this.tail = (this.tail + 1) % this.capacity;
    }

    this._length -= toRead;
    return result;
  }

  peek(count: number): Uint8Array {
    const toPeek = Math.min(count, this._length);
    const result = new Uint8Array(toPeek);

    for (let i = 0; i < toPeek; i++) {
      result[i] = this.buffer[(this.tail + i) % this.capacity];
    }

    return result;
  }

  indexOf(byte: number, startOffset: number = 0): number {
    for (let i = startOffset; i < this._length; i++) {
      if (this.buffer[(this.tail + i) % this.capacity] === byte) {
        return i;
      }
    }
    return -1;
  }

  skip(count: number): number {
    const toSkip = Math.min(count, this._length);
    this.tail = (this.tail + toSkip) % this.capacity;
    this._length -= toSkip;
    return toSkip;
  }

  get length(): number {
    return this._length;
  }

  get available(): number {
    return this.capacity - this._length;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this._length = 0;
  }
}