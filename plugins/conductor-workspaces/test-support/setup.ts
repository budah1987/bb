class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#values.set(String(key), String(value));
  }
}

// Node 24 exposes an experimental global localStorage getter that resolves to
// undefined unless --localstorage-file is set. Some Vitest launchers copy that
// getter over jsdom's implementation before setup files run, so install a
// deterministic in-memory Storage for plugin tests.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});
