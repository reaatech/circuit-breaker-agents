import type { MetricsCollector } from '../metrics/MetricsCollector.js';
import type { CircuitBreakerState, ResultMetadata } from './circuit.js';

/**
 * Minimal persistence adapter interface for the core package.
 * The full adapter interface with leader election is in the persistence package.
 */
export interface CorePersistenceAdapter {
  saveState(state: CircuitBreakerState): Promise<void>;
  loadState(circuitId: string): Promise<CircuitBreakerState | null>;
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  failureWindowMs?: number;
  minConfidence?: number;
  confidenceWindowMs?: number;
  maxCostPerMinute?: number;
  maxTokensPerCall?: number;
  costWindowMs?: number;
  recoveryTimeoutMs?: number;
  halfOpenTimeoutMs?: number;
  recoveryStrategy?: 'gradual' | 'single';
  recoveryMaxCalls?: number;
  maxBackoffMultiplier?: number;
  requestTimeoutMs?: number;
  persistence?: CorePersistenceAdapter;
  metricsEnabled?: boolean;
  metricsCollector?: MetricsCollector;
}

export interface ExecutionContext {
  circuitId?: string;
  onSuccess?: (result: unknown) => ResultMetadata;
  onFailure?: (error: unknown) => ResultMetadata;
  timeoutMs?: number;
  fallback?: () => Promise<unknown>;
  forceRoute?: boolean;
}
