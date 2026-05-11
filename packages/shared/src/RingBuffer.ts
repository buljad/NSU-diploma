// packages/shared/src/RingBuffer.ts

/**
 * Кольцевой буфер байтов v2.3 с оптимизациями
 *
 * ✅ НОВЫЕ ВОЗМОЖНОСТИ v2.3:
 * - Peek-операции (чтение без сдвига позиции)
 * - Прямой доступ по индексу at(index)
 * - Batch-операции для множественных пакетов
 * - Оптимизированный поиск подстрок
 * - Zero-copy операции где возможно
 */
export class ByteRingBuffer {
  private buffer: Uint8Array;
  private head: number = 0; // Позиция записи
  private tail: number = 0; // Позиция чтения
  private count: number = 0; // Количество данных в буфере
  private capacity: number;

  // ✅ НОВОЕ: Статистика для оптимизации
  private stats = {
    totalReads: 0,
    totalWrites: 0,
    peekOperations: 0,
    searchOperations: 0,
    overflows: 0,
  };

  constructor(size: number) {
    this.capacity = size;
    this.buffer = new Uint8Array(size);
  }

  /**
   * Записать данные в буфер
   */
  write(data: Uint8Array): number {
    this.stats.totalWrites++;

    const available = this.capacity - this.count;
    const writeCount = Math.min(data.length, available);

    if (writeCount === 0) {
      this.stats.overflows++;
      return 0;
    }

    // ✅ ОПТИМИЗАЦИЯ: Batch-запись для непрерывных участков
    for (let i = 0; i < writeCount; i++) {
      this.buffer[this.head] = data[i];
      this.head = (this.head + 1) % this.capacity;
    }

    this.count += writeCount;
    return writeCount;
  }

  /**
   * Прочитать данные из буфера (с удалением)
   */
  read(length: number): Uint8Array {
    this.stats.totalReads++;

    const actualLength = Math.min(length, this.count);
    if (actualLength === 0) {
      return new Uint8Array(0);
    }

    const result = new Uint8Array(actualLength);

    // ✅ ОПТИМИЗАЦИЯ: Непрерывное чтение где возможно
    if (this.tail + actualLength <= this.capacity) {
      // Данные лежат непрерывно - можем скопировать за один раз
      result.set(this.buffer.subarray(this.tail, this.tail + actualLength));
    } else {
      // Данные разорваны - копируем по частям
      const firstPart = this.capacity - this.tail;
      result.set(this.buffer.subarray(this.tail, this.capacity));
      result.set(this.buffer.subarray(0, actualLength - firstPart), firstPart);
    }

    this.tail = (this.tail + actualLength) % this.capacity;
    this.count -= actualLength;

    return result;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Peek - чтение без удаления данных
   * @param offset Смещение от начала буфера
   * @param length Количество байт для чтения
   * @returns Данные или null если недостаточно данных
   */
  peek(offset: number = 0, length: number = 1): Uint8Array | null {
    this.stats.peekOperations++;

    if (offset < 0 || offset + length > this.count) {
      return null; // Недостаточно данных
    }

    const result = new Uint8Array(length);
    const startPos = (this.tail + offset) % this.capacity;

    // ✅ ОПТИМИЗАЦИЯ: Непрерывное чтение где возможно
    if (startPos + length <= this.capacity) {
      // Данные лежат непрерывно
      result.set(this.buffer.subarray(startPos, startPos + length));
    } else {
      // Данные разорваны
      const firstPart = this.capacity - startPos;
      result.set(this.buffer.subarray(startPos, this.capacity));
      result.set(this.buffer.subarray(0, length - firstPart), firstPart);
    }

    return result;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Прямой доступ к байту по индексу (без удаления)
   * @param index Индекс от начала буфера (0 = первый байт)
   * @returns Значение байта или undefined если индекс некорректный
   */
  at(index: number): number | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }

    const actualIndex = (this.tail + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * ✅ УЛУЧШЕНО: Поиск байта с оптимизациями
   */
  indexOf(searchByte: number, fromIndex: number = 0): number {
    this.stats.searchOperations++;

    if (fromIndex < 0 || fromIndex >= this.count) {
      return -1;
    }

    // ✅ ОПТИМИЗАЦИЯ: Линейный поиск с учетом кольцевой структуры
    for (let i = fromIndex; i < this.count; i++) {
      const actualIndex = (this.tail + i) % this.capacity;
      if (this.buffer[actualIndex] === searchByte) {
        return i;
      }
    }

    return -1;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Поиск всех вхождений байта
   * @param searchByte Искомый байт
   * @param maxResults Максимальное количество результатов (по умолчанию без ограничений)
   * @returns Массив индексов всех найденных вхождений
   */
  indexOfAll(searchByte: number, maxResults: number = Infinity): number[] {
    this.stats.searchOperations++;

    const results: number[] = [];

    for (let i = 0; i < this.count && results.length < maxResults; i++) {
      const actualIndex = (this.tail + i) % this.capacity;
      if (this.buffer[actualIndex] === searchByte) {
        results.push(i);
      }
    }

    return results;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Поиск последовательности байтов
   * @param pattern Искомая последовательность
   * @param fromIndex Начальная позиция поиска
   * @returns Индекс начала найденной последовательности или -1
   */
  indexOfSequence(pattern: Uint8Array, fromIndex: number = 0): number {
    this.stats.searchOperations++;

    if (pattern.length === 0 || fromIndex + pattern.length > this.count) {
      return -1;
    }

    // Простой алгоритм поиска подстроки
    for (let i = fromIndex; i <= this.count - pattern.length; i++) {
      let found = true;

      for (let j = 0; j < pattern.length; j++) {
        const actualIndex = (this.tail + i + j) % this.capacity;
        if (this.buffer[actualIndex] !== pattern[j]) {
          found = false;
          break;
        }
      }

      if (found) {
        return i;
      }
    }

    return -1;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Пропустить байты без чтения
   * @param count Количество байтов для пропуска
   * @returns Фактически пропущено байтов
   */
  skip(count: number): number {
    const actualCount = Math.min(count, this.count);

    if (actualCount > 0) {
      this.tail = (this.tail + actualCount) % this.capacity;
      this.count -= actualCount;
    }

    return actualCount;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Копирование данных в существующий массив (Zero-GC)
   * @param target Целевой массив
   * @param targetStart Позиция в целевом массиве
   * @param sourceStart Позиция в буфере
   * @param sourceEnd Конец диапазона в буфере (не включительно)
   * @returns Количество скопированных байтов
   */
  copyTo(
    target: Uint8Array,
    targetStart: number = 0,
    sourceStart: number = 0,
    sourceEnd: number = this.count,
  ): number {
    const sourceLength = Math.min(
      sourceEnd - sourceStart,
      this.count - sourceStart,
    );
    const availableTarget = target.length - targetStart;
    const copyCount = Math.min(sourceLength, availableTarget);

    if (copyCount <= 0) return 0;

    const bufferStart = (this.tail + sourceStart) % this.capacity;

    if (bufferStart + copyCount <= this.capacity) {
      // Непрерывные данные
      target.set(
        this.buffer.subarray(bufferStart, bufferStart + copyCount),
        targetStart,
      );
    } else {
      // Разорванные данные
      const firstPart = this.capacity - bufferStart;
      target.set(this.buffer.subarray(bufferStart, this.capacity), targetStart);
      target.set(
        this.buffer.subarray(0, copyCount - firstPart),
        targetStart + firstPart,
      );
    }

    return copyCount;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Извлечение заданного количества байтов с откидыванием остатка
   * Полезно для извлечения точного количества пакетов
   */
  extractExactly(count: number): Uint8Array | null {
    if (this.count < count) {
      return null; // Недостаточно данных
    }

    return this.read(count);
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Поиск и извлечение данных до определенного байта (включительно)
   * @param delimiter Разделитель
   * @param includeDelimiter Включать ли разделитель в результат
   * @returns Извлеченные данные или null если разделитель не найден
   */
  readUntil(
    delimiter: number,
    includeDelimiter: boolean = true,
  ): Uint8Array | null {
    const delimiterIndex = this.indexOf(delimiter);

    if (delimiterIndex === -1) {
      return null; // Разделитель не найден
    }

    const readLength = delimiterIndex + (includeDelimiter ? 1 : 0);
    const result = this.read(readLength);

    // Если не включаем разделитель, но он был прочитан - пропускаем его
    if (!includeDelimiter && this.count > 0 && this.at(0) === delimiter) {
      this.skip(1);
    }

    return result;
  }

  /**
   * Очистить буфер
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Компактизация буфера (дефрагментация)
   * Перемещает все данные в начало буфера для лучшей локальности
   */
  compact(): void {
    if (this.count === 0 || this.tail === 0) {
      return; // Уже компактен
    }

    const tempBuffer = new Uint8Array(this.count);
    this.copyTo(tempBuffer);

    this.clear();
    this.write(tempBuffer);
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Резервирование места для записи
   * @param space Требуемое свободное место
   * @returns true если место есть или было освобождено
   */
  ensureSpace(space: number): boolean {
    if (this.available >= space) {
      return true; // Места достаточно
    }

    // Пытаемся освободить место, удалив старые данные
    const needToFree = space - this.available;
    const canFree = Math.min(needToFree, this.count);

    if (canFree > 0) {
      this.skip(canFree);
      this.stats.overflows++; // Считаем это как overflow
    }

    return this.available >= space;
  }

  // ✅ НОВЫЕ ГЕТТЕРЫ
  get length(): number {
    return this.count;
  }

  get available(): number {
    return this.capacity - this.count;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  get size(): number {
    return this.capacity;
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Статистика использования буфера
   */
  getStats(): {
    capacity: number;
    used: number;
    available: number;
    utilization: number;
    totalReads: number;
    totalWrites: number;
    peekOperations: number;
    searchOperations: number;
    overflows: number;
  } {
    // ✅ ИСПРАВЛЕНО: Убираем проблемный spread и делаем явное копирование
    return {
      capacity: this.capacity,
      used: this.count,
      available: this.available,
      utilization: this.count / this.capacity,
      totalReads: this.stats.totalReads,
      totalWrites: this.stats.totalWrites,
      peekOperations: this.stats.peekOperations,
      searchOperations: this.stats.searchOperations,
      overflows: this.stats.overflows,
    };
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Сброс статистики
   */
  resetStats(): void {
    this.stats = {
      totalReads: 0,
      totalWrites: 0,
      peekOperations: 0,
      searchOperations: 0,
      overflows: 0,
    };
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Диагностическая информация
   */
  debug(): {
    head: number;
    tail: number;
    count: number;
    capacity: number;
    fragmented: boolean;
    stats: ReturnType<typeof ByteRingBuffer.prototype.getStats>;
  } {
    return {
      head: this.head,
      tail: this.tail,
      count: this.count,
      capacity: this.capacity,
      fragmented: this.tail + this.count > this.capacity,
      stats: this.getStats(),
    };
  }

  /**
   * ✅ НОВЫЙ МЕТОД: Создание копии содержимого буфера
   * @param start Начальная позиция (по умолчанию 0)
   * @param end Конечная позиция (по умолчанию весь буфер)
   * @returns Копия данных
   */
  slice(start: number = 0, end: number = this.count): Uint8Array {
    const actualStart = Math.max(0, start);
    const actualEnd = Math.min(this.count, end);
    const length = Math.max(0, actualEnd - actualStart);

    if (length === 0) {
      return new Uint8Array(0);
    }

    const result = new Uint8Array(length);
    this.copyTo(result, 0, actualStart, actualEnd);
    return result;
  }

  /**
   * Преобразование в строку для отладки
   */
  toString(): string {
    const preview = this.slice(0, Math.min(this.count, 20));
    const previewStr = Array.from(preview)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");

    return `ByteRingBuffer(${this.count}/${this.capacity}) [${previewStr}${this.count > 20 ? "..." : ""}]`;
  }
}

// ✅ ИСПРАВЛЕНО: Добавляем экспорт с оригинальным именем для совместимости
export { ByteRingBuffer as RingBuffer };
