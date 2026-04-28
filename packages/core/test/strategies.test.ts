import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorThresholdStrategy } from '../src/strategies/ErrorThresholdStrategy.js';
import { ConfidenceThresholdStrategy } from '../src/strategies/ConfidenceThresholdStrategy.js';
import { CostThresholdStrategy } from '../src/strategies/CostThresholdStrategy.js';
import { GradualRecoveryStrategy, SingleRecoveryStrategy } from '../src/strategies/GradualRecoveryStrategy.js';
import { DefaultMetricsCollector, NoOpMetricsCollector } from '../src/metrics/MetricsCollector.js';
import type { CircuitBreakerState } from '../src/types/circuit.js';

describe('ConfidenceThresholdStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not trip with no scores', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5);
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should not trip when average confidence is above threshold', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5);
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.8 });
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.9 });
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should trip when average confidence is below threshold', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5);
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.3 });
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.2 });
    expect(strategy.shouldTrip()).toBe(true);
  });

  it('should prune old scores', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5, 1000);
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.2 });
    vi.advanceTimersByTime(1500);
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should ignore undefined confidence', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5);
    strategy.recordResult({} as CircuitBreakerState, {});
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should reset', () => {
    const strategy = new ConfidenceThresholdStrategy(0.5);
    strategy.recordResult({} as CircuitBreakerState, { confidence: 0.2 });
    strategy.reset();
    expect(strategy.shouldTrip()).toBe(false);
  });
});

describe('CostThresholdStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not trip with no costs', () => {
    const strategy = new CostThresholdStrategy(100);
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should trip when total cost exceeds max', () => {
    const strategy = new CostThresholdStrategy(100);
    strategy.recordResult({} as CircuitBreakerState, { costUsd: 60 });
    strategy.recordResult({} as CircuitBreakerState, { costUsd: 50 });
    expect(strategy.shouldTrip()).toBe(true);
  });

  it('should prune old costs', () => {
    const strategy = new CostThresholdStrategy(100);
    strategy.recordResult({} as CircuitBreakerState, { costUsd: 150 });
    vi.advanceTimersByTime(65000);
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should force trip on excessive token usage', () => {
    const strategy = new CostThresholdStrategy(1000, 100);
    strategy.recordResult({} as CircuitBreakerState, { tokens: 200 });
    expect(strategy.shouldTrip()).toBe(true);
  });

  it('should ignore undefined cost and tokens', () => {
    const strategy = new CostThresholdStrategy(100);
    strategy.recordResult({} as CircuitBreakerState, {});
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should reset', () => {
    const strategy = new CostThresholdStrategy(100);
    strategy.recordResult({} as CircuitBreakerState, { costUsd: 150 });
    strategy.reset();
    expect(strategy.shouldTrip()).toBe(false);
  });
});

describe('GradualRecoveryStrategy', () => {
  const CIRCUIT = 'test-circuit';

  it('should start with 1 expected call per circuit', () => {
    const strategy = new GradualRecoveryStrategy();
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(1);
  });

  it('should double expected calls each phase', () => {
    const strategy = new GradualRecoveryStrategy();
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(1);
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(2);
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(4);
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(8);
  });

  it('should cap at maxCalls', () => {
    const strategy = new GradualRecoveryStrategy(10);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(1);
    for (let i = 0; i < 5; i++) strategy.onSuccess(CIRCUIT);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(10);
  });

  it('should advance phase on success', () => {
    const strategy = new GradualRecoveryStrategy();
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getCurrentPhase(CIRCUIT)).toBe(1);
  });

  it('should reset phase on failure', () => {
    const strategy = new GradualRecoveryStrategy();
    strategy.onSuccess(CIRCUIT);
    strategy.onFailure(CIRCUIT);
    expect(strategy.getCurrentPhase(CIRCUIT)).toBe(0);
  });

  it('should reset', () => {
    const strategy = new GradualRecoveryStrategy();
    strategy.onSuccess(CIRCUIT);
    strategy.reset(CIRCUIT);
    expect(strategy.getCurrentPhase(CIRCUIT)).toBe(0);
  });

  it('should isolate phase between circuits', () => {
    const strategy = new GradualRecoveryStrategy();
    strategy.onSuccess('circuit-a');
    strategy.onSuccess('circuit-a');
    expect(strategy.getExpectedCalls('circuit-a')).toBe(4);

    strategy.onSuccess('circuit-b');
    expect(strategy.getExpectedCalls('circuit-b')).toBe(2);

    strategy.onFailure('circuit-a');
    expect(strategy.getExpectedCalls('circuit-a')).toBe(1);
    expect(strategy.getExpectedCalls('circuit-b')).toBe(2);
  });
});

describe('SingleRecoveryStrategy', () => {
  const CIRCUIT = 'test-circuit';

  it('should always return 1 expected call', () => {
    const strategy = new SingleRecoveryStrategy();
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(1);
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getExpectedCalls(CIRCUIT)).toBe(1);
  });

  it('should track phase per circuit', () => {
    const strategy = new SingleRecoveryStrategy();
    strategy.onSuccess(CIRCUIT);
    expect(strategy.getCurrentPhase(CIRCUIT)).toBe(1);
    strategy.onFailure(CIRCUIT);
    expect(strategy.getCurrentPhase(CIRCUIT)).toBe(0);
  });
});

describe('ErrorThresholdStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should record errors and trip at threshold', () => {
    const strategy = new ErrorThresholdStrategy(2);
    const state = { state: 'CLOSED', last_state_change: Date.now() } as CircuitBreakerState;
    expect(strategy.shouldTrip()).toBe(false);
    strategy.recordResult(state, { error: true });
    expect(strategy.shouldTrip()).toBe(false);
    strategy.recordResult(state, { error: true });
    expect(strategy.shouldTrip()).toBe(true);
  });

  it('should ignore non-error results', () => {
    const strategy = new ErrorThresholdStrategy(1);
    const state = { state: 'CLOSED', last_state_change: Date.now() } as CircuitBreakerState;
    strategy.recordResult(state, { error: false });
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should reset', () => {
    const strategy = new ErrorThresholdStrategy(1);
    const state = { state: 'CLOSED', last_state_change: Date.now() } as CircuitBreakerState;
    strategy.recordResult(state, { error: true });
    strategy.reset();
    expect(strategy.shouldTrip()).toBe(false);
  });

  it('should prune old failures', () => {
    const strategy = new ErrorThresholdStrategy(1, 1000);
    const state = { state: 'CLOSED', last_state_change: Date.now() } as CircuitBreakerState;
    strategy.recordResult(state, { error: true });
    vi.advanceTimersByTime(1500);
    expect(strategy.shouldTrip()).toBe(false);
  });
});

describe('DefaultMetricsCollector', () => {
  it('should record and retrieve request counts', () => {
    const collector = new DefaultMetricsCollector();
    collector.recordRequest('circuit-1', 'success');
    collector.recordRequest('circuit-1', 'success');
    collector.recordRequest('circuit-1', 'failure');
    collector.recordRequest('circuit-1', 'open');
    collector.recordRequest('circuit-1', 'timeout');

    const counts = collector.getRequestCounts('circuit-1');
    expect(counts.success).toBe(2);
    expect(counts.failure).toBe(1);
    expect(counts.open).toBe(1);
    expect(counts.timeout).toBe(1);
  });

  it('should return zero counts for unknown circuit', () => {
    const collector = new DefaultMetricsCollector();
    const counts = collector.getRequestCounts('unknown');
    expect(counts.success).toBe(0);
    expect(counts.failure).toBe(0);
  });

  it('should record state changes', () => {
    const collector = new DefaultMetricsCollector();
    collector.recordStateChange('circuit-1', 'CLOSED', 'OPEN');
    const changes = collector.getStateChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].from).toBe('CLOSED');
    expect(changes[0].to).toBe('OPEN');
  });
});

describe('NoOpMetricsCollector', () => {
  it('should accept all calls without effect', () => {
    const collector = new NoOpMetricsCollector();
    collector.recordRequest('c1', 'success');
    collector.recordStateChange('c1', 'CLOSED', 'OPEN');
    collector.recordDuration('c1', 100);
    collector.recordConfidence('c1', 0.9);
    collector.recordCost('c1', 0.01, 100);
    expect(true).toBe(true); // No errors thrown
  });
});
