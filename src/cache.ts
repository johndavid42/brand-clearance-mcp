interface Entry<T> {
  value: T;
  expires: number;
}

export class Cache<T> {
  private store = new Map<string, Entry<T>>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  size(): number {
    const now = Date.now();
    return [...this.store.values()].filter(e => e.expires > now).length;
  }
}
