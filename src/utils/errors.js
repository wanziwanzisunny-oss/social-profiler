export class ScraperError extends Error {
  constructor(platform, message, options = {}) {
    super(message);
    this.name = 'ScraperError';
    this.platform = platform;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export class SessionError extends Error {
  constructor(platform, message) {
    super(message);
    this.name = 'SessionError';
    this.platform = platform;
  }
}

export class RateLimitError extends ScraperError {
  constructor(platform) {
    super(platform, `${platform} 速率限制，请稍后再试`, { retryable: true });
    this.name = 'RateLimitError';
  }
}
