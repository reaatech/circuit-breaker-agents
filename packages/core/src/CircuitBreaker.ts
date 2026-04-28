import { StateMachine } from './StateMachine.js';
import type { RecoveryStrategy } from './strategies/TripStrategy.js';
import type { TripStrategy } from './strategies/TripStrategy.js';
import { GradualRecoveryStrategy, SingleRecoveryStrategy } from './strategies/GradualRecoveryStrategy.js';
import { ConfidenceThresholdStrategy } from './strategies/ConfidenceThresholdStrategy.js';
import { CostThresholdStrategy } from './strategies/CostThresholdStrategy.js';
import { ErrorThresholdStrategy } from './strategies/ErrorThresholdStrategy.js';
import { CircuitOpenError, CircuitTimeoutError } from './CircuitBreakerError.js';
import type { CircuitBreakerOptions, ExecutionContext, CorePersistenceAdapter } from './types/config.js';
import type { CircuitState, CircuitBreakerStats, ResultMetadata } from './types/circuit.js';
import type { CircuitEvent, CircuitEventType } from './types/events.js';
import type { EventHandler } from './types/events.js';
import type { MetricsCollector } from './metrics/MetricsCollector.js';
import { DefaultMetricsCollector, NoOpMetricsCollector } from './metrics/MetricsCollector.js';

export class CircuitBreaker {
  private readonly name: string;
  private readonly stateMachine: StateMachine;
  private readonly tripStrategies: TripStrategy[];
  private readonly recoveryStrategy: RecoveryStrategy;
  private readonly eventHandlers = new Map<CircuitEventType, Set<EventHandler>>();
  private readonly metricsCollector: MetricsCollector;
  private readonly persistence?: CorePersistenceAdapter;
  private readonly loadedCircuits = new Set<string>();
  private readonly pendingLoads = new Map<string, Promise<void>>();
  private readonly options: Required<Pick<CircuitBreakerOptions, 'failureThreshold' | 'failureWindowMs' | 'recoveryTimeoutMs' | 'halfOpenTimeoutMs' | 'maxBackoffMultiplier' | 'requestTimeoutMs' | 'metricsEnabled'>>;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      failureWindowMs: options.failureWindowMs ?? 60000,
      recoveryTimeoutMs: options.recoveryTimeoutMs ?? 30000,
      halfOpenTimeoutMs: options.halfOpenTimeoutMs ?? 60000,
      maxBackoffMultiplier: options.maxBackoffMultiplier ?? 8,
      requestTimeoutMs: options.requestTimeoutMs ?? 30000,
      metricsEnabled: options.metricsEnabled ?? true,
    };

    this.stateMachine = new StateMachine(this.options);

    this.persistence = options.persistence;

    this.metricsCollector = options.metricsCollector
      ?? (this.options.metricsEnabled ? new DefaultMetricsCollector() : new NoOpMetricsCollector());

    this.tripStrategies = [];
    this.tripStrategies.push(new ErrorThresholdStrategy(
      this.options.failureThreshold,
      this.options.failureWindowMs
    ));
    if (options.minConfidence !== undefined) {
      this.tripStrategies.push(new ConfidenceThresholdStrategy(options.minConfidence, options.confidenceWindowMs));
    }
    if (options.maxCostPerMinute !== undefined || options.maxTokensPerCall !== undefined) {
      this.tripStrategies.push(new CostThresholdStrategy(
        options.maxCostPerMinute ?? Number.POSITIVE_INFINITY,
        options.maxTokensPerCall ?? Number.POSITIVE_INFINITY,
        options.costWindowMs
      ));
    }

    this.recoveryStrategy = options.recoveryStrategy === 'single'
      ? new SingleRecoveryStrategy()
      : new GradualRecoveryStrategy(options.recoveryMaxCalls ?? 16);
  }

  async execute<T>(operation: () => Promise<T>, context?: ExecutionContext): Promise<T> {
    const circuitId = context?.circuitId ?? this.name;

    await this.ensureStateLoaded(circuitId);

    const state = this.stateMachine.getState(circuitId);

    if (context?.forceRoute) {
      const timeoutMs = context?.timeoutMs ?? this.options.requestTimeoutMs;
      return this.withTimeout(operation(), timeoutMs, circuitId);
    }

    if (state === 'OPEN') {
      if (context?.fallback) {
        this.metricsCollector.recordRequest(circuitId, 'open');
        return context.fallback() as Promise<T>;
      }

      const stats = this.stateMachine.getStats(circuitId);
      const elapsed = Date.now() - stats.last_state_change;
      const effectiveTimeout = this.options.recoveryTimeoutMs * stats.backoff_multiplier;
      const timeUntilRetry = Math.max(0, effectiveTimeout - elapsed);
      this.metricsCollector.recordRequest(circuitId, 'open');
      throw new CircuitOpenError(circuitId, timeUntilRetry);
    }

    if (state === 'HALF_OPEN') {
      const stats = this.stateMachine.getStats(circuitId);
      if (stats.half_open_expected_calls === 0) {
        this.stateMachine.setHalfOpenExpectedCalls(
          circuitId,
          this.recoveryStrategy.getExpectedCalls(circuitId)
        );
      }
      if (!this.stateMachine.canExecute(circuitId)) {
        this.metricsCollector.recordRequest(circuitId, 'open');
        throw new CircuitOpenError(circuitId, 0);
      }
      this.stateMachine.incrementInFlight(circuitId);
    }

    const startTime = Date.now();
    const timeoutMs = context?.timeoutMs ?? this.options.requestTimeoutMs;
    const preExecState = this.stateMachine.getState(circuitId);

    try {
      const result = await this.withTimeout(operation(), timeoutMs, circuitId);
      const duration = Date.now() - startTime;

      let metadata: ResultMetadata = {};
      if (context?.onSuccess) {
        try {
          metadata = context.onSuccess(result) ?? {};
        } catch (err) {
          this.emit('callbackError', circuitId, { source: 'onSuccess', error: String(err) });
        }
      }

      this.stateMachine.recordSuccess(circuitId);
      this.emit('success', circuitId, { duration, metadata });
      void this.maybeSaveState(circuitId);
      this.metricsCollector.recordRequest(circuitId, 'success');
      this.metricsCollector.recordDuration(circuitId, duration);
      if (metadata.confidence !== undefined) {
        this.metricsCollector.recordConfidence(circuitId, metadata.confidence);
      }
      if (metadata.costUsd !== undefined || metadata.tokens !== undefined) {
        this.metricsCollector.recordCost(circuitId, metadata.costUsd ?? 0, metadata.tokens ?? 0);
      }

      if (preExecState === 'HALF_OPEN') {
        this.recoveryStrategy.onSuccess(circuitId);
      }

      const currentState = this.stateMachine.getState(circuitId);
      if (!(preExecState === 'HALF_OPEN' && currentState === 'CLOSED')) {
        this.evaluateTripStrategies(circuitId, metadata);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof CircuitTimeoutError) {
        this.stateMachine.recordFailure(circuitId);
        this.emit('timeout', circuitId, { duration });
        void this.maybeSaveState(circuitId);
        this.metricsCollector.recordRequest(circuitId, 'timeout');
        this.metricsCollector.recordDuration(circuitId, duration);
        throw error;
      }

      let metadata: ResultMetadata = { error: true };
      if (context?.onFailure) {
        try {
          metadata = { error: true, ...context.onFailure(error) };
        } catch (err) {
          this.emit('callbackError', circuitId, { source: 'onFailure', error: String(err) });
        }
      }

      if (preExecState === 'HALF_OPEN') {
        this.recoveryStrategy.onFailure(circuitId);
      }

      this.stateMachine.recordFailure(circuitId);
      this.emit('failure', circuitId, { duration, error: error instanceof Error ? error.message : String(error), metadata });
      void this.maybeSaveState(circuitId);
      this.metricsCollector.recordRequest(circuitId, 'failure');
      this.metricsCollector.recordDuration(circuitId, duration);

      this.evaluateTripStrategies(circuitId, metadata);

      throw error;
    } finally {
      if (preExecState === 'HALF_OPEN') {
        this.stateMachine.decrementInFlight(circuitId);
      }
    }
  }

  getState(circuitId?: string): CircuitState {
    return this.stateMachine.getState(circuitId ?? this.name);
  }

  getStats(circuitId?: string): CircuitBreakerStats {
    return this.stateMachine.getStats(circuitId ?? this.name);
  }

  recordResult(circuitId: string, metadata: ResultMetadata): void {
    const stats = this.stateMachine.getStats(circuitId);
    for (const strategy of this.tripStrategies) {
      strategy.recordResult(stats, metadata);
      if (strategy.shouldTrip()) {
        const previousState = this.stateMachine.getState(circuitId);
        this.stateMachine.forceState(circuitId, 'OPEN');
        this.emit('stateChange', circuitId, { from: previousState, to: 'OPEN', reason: strategy.name });
        this.metricsCollector.recordStateChange(circuitId, previousState, 'OPEN');
        break;
      }
    }
    void this.maybeSaveState(circuitId);
  }

  reset(circuitId?: string): void {
    const id = circuitId ?? this.name;
    const previousState = this.stateMachine.getState(id);
    this.stateMachine.reset(id);
    this.emit('stateChange', id, { from: previousState, to: 'CLOSED', reason: 'manual' });
    this.metricsCollector.recordStateChange(id, previousState, 'CLOSED');
    void this.maybeSaveState(id);
  }

  forceState(circuitId: string, state: CircuitState): void {
    const previousState = this.stateMachine.getState(circuitId);
    this.stateMachine.forceState(circuitId, state);
    this.emit('stateChange', circuitId, { from: previousState, to: state, reason: 'force' });
    this.metricsCollector.recordStateChange(circuitId, previousState, state);
    void this.maybeSaveState(circuitId);
  }

  evict(circuitId?: string): void {
    const id = circuitId ?? this.name;
    this.stateMachine.evict(id);
    this.loadedCircuits.delete(id);
    this.metricsCollector.reset?.(id);
    this.recoveryStrategy.reset(id);
  }

  on(event: CircuitEventType, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: CircuitEventType, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private evaluateTripStrategies(circuitId: string, metadata: ResultMetadata): void {
    const stats = this.stateMachine.getStats(circuitId);
    for (const strategy of this.tripStrategies) {
      strategy.recordResult(stats, metadata);
      if (strategy.shouldTrip()) {
        const previousState = this.stateMachine.getState(circuitId);
        this.stateMachine.forceState(circuitId, 'OPEN');
        this.emit('stateChange', circuitId, { from: previousState, to: 'OPEN', reason: strategy.name });
        this.metricsCollector.recordStateChange(circuitId, previousState, 'OPEN');
        break;
      }
    }
  }

  private async ensureStateLoaded(circuitId: string): Promise<void> {
    if (!this.persistence || this.loadedCircuits.has(circuitId)) return;

    const pending = this.pendingLoads.get(circuitId);
    if (pending) {
      await pending;
      return;
    }

    const loadPromise = this.loadPersistedState(circuitId);
    this.pendingLoads.set(circuitId, loadPromise);
    try {
      await loadPromise;
    } finally {
      this.pendingLoads.delete(circuitId);
    }
  }

  private async loadPersistedState(circuitId: string): Promise<void> {
    try {
      const persisted = await this.persistence!.loadState(circuitId);
      if (persisted) {
        this.stateMachine.loadPersistedState(circuitId, persisted);
      }
    } catch (error) {
      this.emit('persistenceError', circuitId, { error: error instanceof Error ? error.message : String(error) });
    }
    this.loadedCircuits.add(circuitId);
  }

  private emit(type: CircuitEventType, circuitId: string, data: Record<string, unknown>): void {
    const handlers = this.eventHandlers.get(type);
    if (!handlers || handlers.size === 0) return;

    const event: CircuitEvent = {
      type,
      circuit_id: circuitId,
      timestamp: Date.now(),
      data,
    };

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        // Emit callbackError for handler errors to avoid silent failures
        const errorHandlers = this.eventHandlers.get('callbackError');
        if (errorHandlers && errorHandlers.size > 0 && type !== 'callbackError') {
          const errorEvent: CircuitEvent = {
            type: 'callbackError',
            circuit_id: circuitId,
            timestamp: Date.now(),
            data: { source: `handler:${type}`, error: String(err) },
          };
          for (const eh of errorHandlers) {
            try { eh(errorEvent); } catch { /* final fallback */ }
          }
        }
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, circuitId: string): Promise<T> {
    if (timeoutMs <= 0) return promise;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const actualState = this.stateMachine.getState(circuitId);
        reject(new CircuitTimeoutError(circuitId, timeoutMs, actualState));
      }, timeoutMs);
      (timer as ReturnType<typeof setTimeout> & { unref(): void }).unref();

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private async maybeSaveState(circuitId: string): Promise<void> {
    if (!this.persistence) return;
    try {
      const stats = this.stateMachine.getStats(circuitId);
      await this.persistence.saveState({
        circuit_id: stats.circuit_id,
        state: stats.state,
        failure_count: stats.failure_count,
        success_count: stats.success_count,
        last_failure_time: stats.last_failure_time,
        last_state_change: stats.last_state_change,
        half_open_expected_calls: stats.half_open_expected_calls,
        half_open_completed_calls: stats.half_open_completed_calls,
        backoff_multiplier: stats.backoff_multiplier,
        version: stats.version,
      });
    } catch (error) {
      this.emit('persistenceError', circuitId, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
