import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const loadLogger = async () => {
  vi.resetModules();
  const module = await import('./logger');
  return module.logger;
};

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('logs in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const logger = await loadLogger();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.debug('Test debug');
    logger.info('Test info');
    logger.warn('Test warn');
    logger.error('Test error');

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not log in production mode by default', async () => {
    process.env.NODE_ENV = 'production';
    const logger = await loadLogger();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('Test info');
    logger.debug('Test debug');

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('can be configured to log in production', async () => {
    process.env.NODE_ENV = 'production';
    const logger = await loadLogger();

    logger.configure({ enableInProduction: true });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.error('Test error', new Error('Production error'));

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should have all log methods', async () => {
    const logger = await loadLogger();

    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.configure).toBe('function');
  });
});
