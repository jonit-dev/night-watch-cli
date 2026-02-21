/**
 * A simple FIFO bounded cache that evicts the oldest entry when size limit is exceeded.
 * Used to prevent unbounded memory growth in long-running processes.
 */

export interface IBoundedCacheOptions {
  /** Maximum number of entries before eviction kicks in */
  maxSize: number;
  /** Optional debug label for logging eviction events */
  debugLabel?: string;
}

/**
 * FIFO cache with automatic eviction of oldest entries.
 * Unlike LRU, access frequency does not affect eviction order - only insertion order matters.
 */
export class BoundedCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly keys: K[] = [];
  private readonly maxSize: number;
  private readonly debugLabel: string;

  constructor(options: IBoundedCacheOptions) {
    this.maxSize = options.maxSize;
    this.debugLabel = options.debugLabel ?? 'BoundedCache';
  }

  /** Get the current number of entries */
  get size(): number {
    return this.map.size;
  }

  /** Get a value by key, or undefined if not present */
  get(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Set a value, evicting the oldest entry if size limit is exceeded */
  set(key: K, value: V): void {
    // If key exists, update value without changing order
    if (this.map.has(key)) {
      this.map.set(key, value);
      return;
    }

    // Check if we need to evict
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.keys.shift();
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    // Add new entry
    this.keys.push(key);
    this.map.set(key, value);
  }

  /** Check if a key exists */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Delete a key */
  delete(key: K): boolean {
    const index = this.keys.indexOf(key);
    if (index !== -1) {
      this.keys.splice(index, 1);
    }
    return this.map.delete(key);
  }

  /** Clear all entries */
  clear(): void {
    this.map.clear();
    this.keys.length = 0;
  }
}
