import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateMachine } from '../src/StateMachine.js';

function createStateMachine(opts: Partial<ConstructorParameters<typeof StateMachine>[0]> = {}) {
  return new StateMachine({
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenTimeoutMs: 60000,
    maxBackoffMultiplier: 8,
    ...opts,
  });
}

describe('StateMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      const sm = createStateMachine();
      expect(sm.getState('test')).toBe('CLOSED');
    });

    it('should return stats with zero counts', () => {
      const sm = createStateMachine();
      const stats = sm.getStats('test');
      expect(stats.state).toBe('CLOSED');
      expect(stats.failure_count).toBe(0);
      expect(stats.success_count).toBe(0);
    });
  });

  describe('CLOSED -> OPEN', () => {
    it('should track failure count without transitioning state on its own', () => {
      const sm = createStateMachine({ failureThreshold: 3 });
      sm.recordFailure('test');
      sm.recordFailure('test');
      expect(sm.getState('test')).toBe('CLOSED');
      sm.recordFailure('test');
      expect(sm.getState('test')).toBe('CLOSED');
      const stats = sm.getStats('test');
      expect(stats.failure_count).toBe(3);
    });

    it('should still transition HALF_OPEN -> OPEN on failure', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      sm.recordFailure('test');
      expect(sm.getState('test')).toBe('OPEN');
    });

    it('should track total failures', () => {
      const sm = createStateMachine({ failureThreshold: 5 });
      for (let i = 0; i < 5; i++) sm.recordFailure('test');
      const stats = sm.getStats('test');
      expect(stats.total_failures).toBe(5);
    });
  });

  describe('OPEN -> HALF_OPEN', () => {
    it('should transition after recovery timeout', () => {
      const sm = createStateMachine({ recoveryTimeoutMs: 30000 });
      sm.forceState('test', 'OPEN');
      expect(sm.getState('test')).toBe('OPEN');
      vi.advanceTimersByTime(30000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
    });

    it('should apply backoff multiplier', () => {
      const sm = createStateMachine({ recoveryTimeoutMs: 10000, maxBackoffMultiplier: 4 });
      sm.forceState('test', 'OPEN');
      // First transition: multiplier = 1
      vi.advanceTimersByTime(10000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
      // Force back to OPEN, multiplier doubles to 2
      sm.recordFailure('test');
      expect(sm.getState('test')).toBe('OPEN');
      // Should NOT transition after 10000 (need 20000)
      vi.advanceTimersByTime(10000);
      expect(sm.getState('test')).toBe('OPEN');
      // Should transition after 20000 total
      vi.advanceTimersByTime(10000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
    });
  });

  describe('HALF_OPEN -> CLOSED', () => {
    it('should close after all expected calls succeed', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      sm.setHalfOpenExpectedCalls('test', 3);

      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('CLOSED');
    });

    it('should reset backoff multiplier on close', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'OPEN');
      sm.recordFailure('test'); // multiplier = 2
      vi.advanceTimersByTime(30000);
      sm.setHalfOpenExpectedCalls('test', 1);
      sm.recordSuccess('test');
      const stats = sm.getStats('test');
      expect(stats.backoff_multiplier).toBe(1);
    });
  });

  describe('HALF_OPEN -> OPEN', () => {
    it('should reopen on any failure during recovery', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      sm.setHalfOpenExpectedCalls('test', 3);

      sm.recordSuccess('test');
      sm.recordFailure('test');
      expect(sm.getState('test')).toBe('OPEN');
    });

    it('should force back to OPEN after half-open timeout', () => {
      const sm = createStateMachine({ halfOpenTimeoutMs: 30000 });
      sm.forceState('test', 'HALF_OPEN');
      sm.setHalfOpenExpectedCalls('test', 3);

      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('HALF_OPEN');

      vi.advanceTimersByTime(30000);
      expect(sm.getState('test')).toBe('OPEN');
    });
  });

  describe('completed-call tracking', () => {
    it('should track completed calls not started calls', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      sm.setHalfOpenExpectedCalls('test', 2);

      // Only 1 success recorded, so 1 completed call
      sm.recordSuccess('test');
      const stats = sm.getStats('test');
      expect(stats.half_open_completed_calls).toBe(1);

      // Second success should close
      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('CLOSED');
    });
  });

  describe('exponential backoff', () => {
    it('should double multiplier each cycle', () => {
      const sm = createStateMachine({ recoveryTimeoutMs: 10000, maxBackoffMultiplier: 8 });
      sm.forceState('test', 'OPEN');

      // Cycle 1: multiplier = 1
      vi.advanceTimersByTime(10000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordFailure('test');
      expect(sm.getStats('test').backoff_multiplier).toBe(2);

      // Cycle 2: multiplier = 2
      vi.advanceTimersByTime(20000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordFailure('test');
      expect(sm.getStats('test').backoff_multiplier).toBe(4);

      // Cycle 3: multiplier = 4
      vi.advanceTimersByTime(40000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordFailure('test');
      expect(sm.getStats('test').backoff_multiplier).toBe(8);

      // Cycle 4: capped at 8
      vi.advanceTimersByTime(80000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
      sm.recordFailure('test');
      expect(sm.getStats('test').backoff_multiplier).toBe(8);
    });
  });

  describe('manual control', () => {
    it('should reset to CLOSED', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'OPEN');
      expect(sm.getState('test')).toBe('OPEN');
      sm.reset('test');
      expect(sm.getState('test')).toBe('CLOSED');
    });

    it('should force any state', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      expect(sm.getState('test')).toBe('HALF_OPEN');
    });
  });

  describe('canExecute', () => {
    it('should allow execution when CLOSED', () => {
      const sm = createStateMachine();
      expect(sm.canExecute('test')).toBe(true);
    });

    it('should deny execution when OPEN', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'OPEN');
      expect(sm.canExecute('test')).toBe(false);
    });

    it('should allow execution in HALF_OPEN up to expected calls', () => {
      const sm = createStateMachine();
      sm.forceState('test', 'HALF_OPEN');
      sm.setHalfOpenExpectedCalls('test', 2);

      expect(sm.canExecute('test')).toBe(true);
      sm.recordSuccess('test');
      expect(sm.canExecute('test')).toBe(true); // 1 completed, 2 expected
      sm.recordSuccess('test');
      expect(sm.getState('test')).toBe('CLOSED'); // transitions to closed
    });
  });

  describe('lazy transitions', () => {
    it('should not transition OPEN->HALF_OPEN before timeout', () => {
      const sm = createStateMachine({ recoveryTimeoutMs: 30000 });
      sm.forceState('test', 'OPEN');
      vi.advanceTimersByTime(29999);
      expect(sm.getState('test')).toBe('OPEN');
    });

    it('should transition OPEN->HALF_OPEN exactly at timeout', () => {
      const sm = createStateMachine({ recoveryTimeoutMs: 30000 });
      sm.forceState('test', 'OPEN');
      vi.advanceTimersByTime(30000);
      expect(sm.getState('test')).toBe('HALF_OPEN');
    });
  });
});
