// At most `perHost` tasks in flight per hostname; the rest wait their turn
// (first come, first served). Keeps direct fetches polite to one site.

export class HostLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, (() => void)[]>();

  constructor(readonly perHost: number) {
    if (!Number.isInteger(perHost) || perHost < 1) throw new RangeError("perHost must be a positive integer");
  }

  /** Runs `fn` once `host` has a free slot. */
  async run<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const key = host.toLowerCase();
    await this.acquire(key);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  /** Tasks currently running for `host` (tests and logs). */
  inFlight(host: string): number {
    return this.active.get(host.toLowerCase()) ?? 0;
  }

  private acquire(key: string): Promise<void> {
    const n = this.active.get(key) ?? 0;
    if (n < this.perHost) {
      this.active.set(key, n + 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const q = this.waiting.get(key) ?? [];
      q.push(resolve);
      this.waiting.set(key, q);
    });
  }

  private release(key: string): void {
    const q = this.waiting.get(key);
    const next = q?.shift();
    if (q && q.length === 0) this.waiting.delete(key);
    if (next) {
      next(); // the slot passes straight to the next waiter
      return;
    }
    const n = (this.active.get(key) ?? 1) - 1;
    if (n <= 0) this.active.delete(key);
    else this.active.set(key, n);
  }
}
