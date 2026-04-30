import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerStateSchema,
  CircuitOpenError,
  CircuitTimeoutError,
  ConfidenceThresholdStrategy,
  CostThresholdStrategy,
  DefaultMetricsCollector,
  ErrorThresholdStrategy,
  GradualRecoveryStrategy,
  InMemoryAdapter,
  LeaderElection,
  MemoryLeaderElection,
  NoOpMetricsCollector,
  SingleRecoveryStrategy,
  StateMachine,
} from '../src/index.js';

describe('circuit-breaker-agents meta-package', () => {
  it('should export core class CircuitBreaker', () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    expect(breaker).toBeDefined();
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should export error classes', () => {
    expect(CircuitOpenError).toBeDefined();
    expect(CircuitTimeoutError).toBeDefined();
  });

  it('should export strategies', () => {
    expect(ErrorThresholdStrategy).toBeDefined();
    expect(ConfidenceThresholdStrategy).toBeDefined();
    expect(CostThresholdStrategy).toBeDefined();
    expect(GradualRecoveryStrategy).toBeDefined();
    expect(SingleRecoveryStrategy).toBeDefined();
  });

  it('should export metrics collectors', () => {
    expect(DefaultMetricsCollector).toBeDefined();
    expect(NoOpMetricsCollector).toBeDefined();
  });

  it('should export state schema', () => {
    expect(CircuitBreakerStateSchema).toBeDefined();
  });

  it('should export persistence adapters', () => {
    expect(InMemoryAdapter).toBeDefined();
  });

  it('should export leader election', () => {
    expect(LeaderElection).toBeDefined();
    expect(MemoryLeaderElection).toBeDefined();
  });

  it('should export StateMachine', () => {
    expect(StateMachine).toBeDefined();
  });
});
