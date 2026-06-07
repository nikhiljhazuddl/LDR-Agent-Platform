import { sleep } from './retry.js';

export class RateLimiter {
  private minIntervalMs: number;
  private lastRunAt = 0;

  constructor({ requestsPerSecond }: { requestsPerSecond: number }) {
    this.minIntervalMs = Math.ceil(1000 / requestsPerSecond);
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastRunAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastRunAt = Date.now();
    return fn();
  }
}

