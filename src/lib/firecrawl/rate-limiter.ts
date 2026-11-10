// Promise queue: at most `concurrency` tasks in flight, and each slot waits
// `delayMs` after its task settles before starting the next one (gtm's limiter).

export class RateLimiter {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;

  constructor(
    private readonly concurrency: number,
    private readonly delayMs: number,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
    if (!(delayMs >= 0)) throw new RangeError("delayMs must be >= 0");
  }

  /** Queues `fn`; settles with its result once it has run. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running++;
      void task()
        .then(() => (this.delayMs > 0 ? new Promise<void>((r) => setTimeout(r, this.delayMs)) : undefined))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

export type WindowClock = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
};

const realClock: WindowClock = { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms) };

/**
 * Rolling-window pacing: at most `maxStarts` starts in any `windowMs`. Callers
 * `acquire()` right before a request; waiters are served first come, first
 * served. The clock and timer are injectable for tests.
 */
export class WindowLimiter {
  private readonly starts: number[] = [];
  private readonly waiters: (() => void)[] = [];
  private timerArmed = false;

  constructor(
    readonly maxStarts: number,
    readonly windowMs: number,
    private readonly clock: WindowClock = realClock,
  ) {
    if (!Number.isInteger(maxStarts) || maxStarts < 1) throw new RangeError("maxStarts must be a positive integer");
    if (!(windowMs > 0)) throw new RangeError("windowMs must be > 0");
  }

  /** Resolves once a start slot is free in the window, and records the start. */
  acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.pump();
    });
  }

  /** Starts recorded in the current window (for tests and logs). */
  inWindow(): number {
    this.prune();
    return this.starts.length;
  }

  private prune(): void {
    const cutoff = this.clock.now() - this.windowMs;
    while (this.starts.length > 0 && this.starts[0] <= cutoff) this.starts.shift();
  }

  private pump(): void {
    this.prune();
    while (this.waiters.length > 0 && this.starts.length < this.maxStarts) {
      this.starts.push(this.clock.now());
      this.waiters.shift()!();
    }
    if (this.waiters.length > 0 && !this.timerArmed) {
      // The oldest start leaves the window at starts[0] + windowMs.
      const wait = Math.max(1, this.starts[0] + this.windowMs - this.clock.now());
      this.timerArmed = true;
      this.clock.setTimer(() => {
        this.timerArmed = false;
        this.pump();
      }, wait);
    }
  }
}
