import { CircuitBreakerStateSchema, type CircuitBreakerState } from 'circuit-breaker-core';
import type { PersistenceAdapter, HealthStatus } from '../types/adapter.js';

export class InMemoryAdapter implements PersistenceAdapter {
  private states = new Map<string, CircuitBreakerState>();
  private connected = true;

  async connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async saveState(state: CircuitBreakerState): Promise<void> {
    const validated = CircuitBreakerStateSchema.parse(state);
    const existing = this.states.get(validated.circuit_id);
    if (existing && (existing.version ?? 0) >= validated.version) {
      return Promise.resolve(); // Don't downgrade
    }
    this.states.set(validated.circuit_id, validated);
    return Promise.resolve();
  }

  async loadState(circuitId: string): Promise<CircuitBreakerState | null> {
    return Promise.resolve(this.states.get(circuitId) ?? null);
  }

  async deleteState(circuitId: string): Promise<void> {
    this.states.delete(circuitId);
    return Promise.resolve();
  }

  async saveBatch(states: CircuitBreakerState[]): Promise<void> {
    for (const state of states) {
      await this.saveState(state);
    }
    return Promise.resolve();
  }

  async loadAll(): Promise<CircuitBreakerState[]> {
    return Promise.resolve(Array.from(this.states.values()));
  }

  async healthCheck(): Promise<HealthStatus> {
    return Promise.resolve({ healthy: true });
  }

  clear(): void {
    this.states.clear();
  }
}
