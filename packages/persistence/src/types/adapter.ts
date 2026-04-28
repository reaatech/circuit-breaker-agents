import type { CircuitBreakerState } from 'circuit-breaker-core';

export interface PersistenceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  saveState(state: CircuitBreakerState): Promise<void>;
  loadState(circuitId: string): Promise<CircuitBreakerState | null>;
  deleteState(circuitId: string): Promise<void>;
  saveBatch(states: CircuitBreakerState[]): Promise<void>;
  loadAll(): Promise<CircuitBreakerState[]>;
  tryAcquireLeadership?(instanceId: string, leaseMs: number): Promise<LeadershipResult>;
  releaseLeadership?(instanceId: string): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}

export interface LeadershipResult {
  isLeader: boolean;
  fencingToken: number;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}
