import type { CircuitBreakerStats, ResultMetadata } from '../types/circuit.js';

export interface TripStrategy {
  readonly name: string;
  shouldTrip(): boolean;
  recordResult(state: CircuitBreakerStats, metadata: ResultMetadata): void;
  reset(): void;
}

export interface RecoveryStrategy {
  readonly name: string;
  getExpectedCalls(circuitId: string): number;
  onSuccess(circuitId: string): void;
  onFailure(circuitId: string): void;
  reset(circuitId?: string): void;
  getCurrentPhase(circuitId: string): number;
}
