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
