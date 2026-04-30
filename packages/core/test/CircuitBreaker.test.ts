import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../src/CircuitBreaker.js';
import { CircuitOpenError, CircuitTimeoutError } from '../src/CircuitBreakerError.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execute', () => {
    it('should execute operation when CLOSED', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const result = await breaker.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('should throw CircuitOpenError when OPEN', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('test', 'OPEN');
      await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitOpenError);
    });

    it('should include timeUntilRetry in CircuitOpenError', async () => {
      const breaker = new CircuitBreaker({ name: 'test', recoveryTimeoutMs: 30000 });
      breaker.forceState('test', 'OPEN');
      try {
        await breaker.execute(() => Promise.resolve('ok'));
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).timeUntilRetry).toBeGreaterThan(0);
        expect((err as CircuitOpenError).timeUntilRetry).toBeLessThanOrEqual(30000);
      }
    });

    it('should apply request timeout', async () => {
      vi.useRealTimers();
      const breaker = new CircuitBreaker({ name: 'test', requestTimeoutMs: 50 });
      const promise = breaker.execute(() => new Promise((resolve) => setTimeout(resolve, 2000)));
      await expect(promise).rejects.toThrow(CircuitTimeoutError);
      vi.useFakeTimers();
    }, 10000);

    it('should call fallback when OPEN and fallback provided', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('test', 'OPEN');
      const fallback = vi.fn().mockResolvedValue('fallback-result');
      const result = await breaker.execute(() => Promise.resolve('primary'), { fallback });
      expect(result).toBe('fallback-result');
      expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('should call onSuccess metadata callback', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const onSuccess = vi.fn().mockReturnValue({ confidence: 0.9 });
      await breaker.execute(() => Promise.resolve('ok'), { onSuccess });
      expect(onSuccess).toHaveBeenCalledWith('ok');
    });

    it('should call onFailure metadata callback', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const onFailure = vi.fn().mockReturnValue({ confidence: 0.3 });
      const error = new Error('fail');
      await expect(breaker.execute(() => Promise.reject(error), { onFailure })).rejects.toThrow(
        'fail',
      );
      expect(onFailure).toHaveBeenCalledWith(error);
    });
  });

  describe('state transitions', () => {
    it('should trip on error threshold', async () => {
      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
      const fail = () => Promise.reject(new Error('fail'));

      await breaker.execute(fail).catch(() => {});
      await breaker.execute(fail).catch(() => {});
      expect(breaker.getState()).toBe('CLOSED');

      await breaker.execute(fail).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should recover after timeout and successful test calls', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        recoveryTimeoutMs: 10000,
      });

      // Trip the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');

      // Wait for recovery (need to advance past the timeout)
      vi.advanceTimersByTime(10001);
      expect(breaker.getState()).toBe('HALF_OPEN');

      // Success should close
      await breaker.execute(() => Promise.resolve('ok'));
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should reopen on failure during HALF_OPEN', async () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        recoveryTimeoutMs: 10000,
      });

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      vi.advanceTimersByTime(10001);
      expect(breaker.getState()).toBe('HALF_OPEN');

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should isolate recovery phase between circuits', async () => {
      const breaker = new CircuitBreaker({
        name: 'breaker',
        failureThreshold: 2,
        recoveryTimeoutMs: 10000,
        recoveryStrategy: 'gradual',
      });

      const fail = () => Promise.reject(new Error('fail'));
      const ok = () => Promise.resolve('ok');

      // Trip circuit A
      await breaker.execute(fail, { circuitId: 'a' }).catch(() => {});
      await breaker.execute(fail, { circuitId: 'a' }).catch(() => {});
      expect(breaker.getState('a')).toBe('OPEN');

      // Trip circuit B
      await breaker.execute(fail, { circuitId: 'b' }).catch(() => {});
      await breaker.execute(fail, { circuitId: 'b' }).catch(() => {});
      expect(breaker.getState('b')).toBe('OPEN');

      // Both enter HALF_OPEN
      vi.advanceTimersByTime(10001);
      expect(breaker.getState('a')).toBe('HALF_OPEN');
      expect(breaker.getState('b')).toBe('HALF_OPEN');

      // Circuit A succeeds once (phase 0 -> 1)
      await breaker.execute(ok, { circuitId: 'a' });
      // Circuit B's phase should still be at 0
      const statsA = breaker.getStats('a');
      const statsB = breaker.getStats('b');
      expect(statsA.state).toBe('CLOSED');
      expect(statsB.state).toBe('HALF_OPEN');
    });
  });

  describe('events', () => {
    it('should emit success event', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('success', handler);

      await breaker.execute(() => Promise.resolve('ok'));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('success');
    });

    it('should emit failure event', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('failure', handler);

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('failure');
    });

    it('should emit stateChange event on forceState', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('stateChange', handler);

      breaker.forceState('default', 'OPEN');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].data.to).toBe('OPEN');
    });

    it('should remove event handler with off', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('success', handler);
      breaker.off('success', handler);

      await breaker.execute(() => Promise.resolve('ok'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset to CLOSED', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('test', 'OPEN');
      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('getStats', () => {
    it('should return current stats', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      await breaker.execute(() => Promise.resolve('ok'));
      const stats = breaker.getStats();
      expect(stats.total_successes).toBe(1);
      expect(stats.total_calls).toBe(1);
    });
  });

  describe('recordResult', () => {
    it('should record result metadata to trip strategies', () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.recordResult('default', { confidence: 0.5 });
      // Should not throw
      expect(true).toBe(true);
    });

    it('should trip circuit when accumulated results exceed threshold', () => {
      const breaker = new CircuitBreaker({
        name: 'test',
        minConfidence: 0.7,
        failureThreshold: 5,
      });

      // Feed low-confidence results
      breaker.recordResult('test', { confidence: 0.3 });
      breaker.recordResult('test', { confidence: 0.4 });
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('event handling', () => {
    it('should not throw when event handler errors', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.on('success', () => {
        throw new Error('handler error');
      });
      await breaker.execute(() => Promise.resolve('ok'));
      expect(true).toBe(true);
    });

    it('should emit callbackError when onSuccess handler errors', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('callbackError', handler);
      await breaker.execute(() => Promise.resolve('ok'), {
        onSuccess: () => {
          throw new Error('callback error');
        },
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].data.source).toBe('onSuccess');
    });

    it('should emit callbackError when onFailure handler errors', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      const handler = vi.fn();
      breaker.on('callbackError', handler);
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail')), {
          onFailure: () => {
            throw new Error('callback error');
          },
        }),
      ).rejects.toThrow('fail');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].data.source).toBe('onFailure');
    });
  });

  describe('forceRoute', () => {
    it('should bypass circuit checks when forceRoute is true', async () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('test', 'OPEN');
      const result = await breaker.execute(() => Promise.resolve('ok'), { forceRoute: true });
      expect(result).toBe('ok');
    });

    it('should apply request timeout with forceRoute', async () => {
      vi.useRealTimers();
      const breaker = new CircuitBreaker({ name: 'test', requestTimeoutMs: 50 });
      const promise = breaker.execute(() => new Promise((resolve) => setTimeout(resolve, 2000)), {
        forceRoute: true,
      });
      await expect(promise).rejects.toThrow(CircuitTimeoutError);
      vi.useFakeTimers();
    }, 10000);
  });

  describe('evict', () => {
    it('should remove circuit state from memory', () => {
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('test', 'OPEN');
      expect(breaker.getState()).toBe('OPEN');
      breaker.evict();
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('persistence integration', () => {
    it('should load state from persistence adapter on first execute', async () => {
      const persistedState = {
        circuit_id: 'test',
        state: 'OPEN' as const,
        failure_count: 3,
        success_count: 1,
        last_state_change: Date.now(),
        half_open_expected_calls: 0,
        half_open_completed_calls: 0,
        backoff_multiplier: 2,
        version: 1,
      };
      const persistence = {
        saveState: vi.fn().mockResolvedValue(undefined),
        loadState: vi.fn().mockResolvedValue(persistedState),
      };

      const breaker = new CircuitBreaker({ name: 'test', persistence });
      expect(breaker.getState()).toBe('CLOSED');

      await breaker.execute(() => Promise.resolve('ok'));
      expect(persistence.loadState).toHaveBeenCalledWith('test');
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should emit persistenceError when loadState fails', async () => {
      const handler = vi.fn();
      const persistence = {
        saveState: vi.fn().mockResolvedValue(undefined),
        loadState: vi.fn().mockRejectedValue(new Error('persistence down')),
      };

      const breaker = new CircuitBreaker({ name: 'test', persistence });
      breaker.on('persistenceError', handler);

      await breaker.execute(() => Promise.resolve('ok'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should call saveState on state transitions', async () => {
      const persistence = {
        saveState: vi.fn().mockResolvedValue(undefined),
        loadState: vi.fn().mockResolvedValue(null),
      };

      const breaker = new CircuitBreaker({ name: 'test', failureThreshold: 2, persistence });

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      expect(persistence.saveState).toHaveBeenCalled();
    });
  });
});
