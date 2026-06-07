import { chromium, type Browser } from 'playwright';
import { getConfig } from '../config.js';

export class BrowserPool {
  private browsers: Browser[] = [];
  private available: Browser[] = [];
  private waiters: Array<(browser: Browser) => void> = [];
  private maxSize: number;

  constructor(maxSize: number = 3) {
    this.maxSize = maxSize;
  }

  async initialize(): Promise<void> {
    const config = getConfig();
    for (let i = 0; i < this.maxSize; i++) {
      const browser = await chromium.launch({
        headless: config.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
      this.browsers.push(browser);
      this.available.push(browser);
    }
  }

  async acquire(): Promise<Browser> {
    const browser = this.available.pop();
    if (browser) return browser;
    return await new Promise<Browser>(resolve => {
      this.waiters.push(resolve);
    });
  }

  release(browser: Browser): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(browser);
    else this.available.push(browser);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.browsers.map(b => b.close()));
    this.browsers = [];
    this.available = [];
    this.waiters = [];
  }
}

