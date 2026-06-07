export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    retryableErrors?: string[];
  }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === options.maxRetries) break;

      const message = (error as Error).message ?? String(error);
      const isRetryable =
        !options.retryableErrors || options.retryableErrors.some(e => message.includes(e));
      if (!isRetryable) throw error;

      const delay = Math.min(
        options.maxDelay,
        options.baseDelay * Math.pow(2, attempt) + Math.random() * 1000
      );
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Retry failed');
}

