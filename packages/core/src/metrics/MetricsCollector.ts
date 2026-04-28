import type { CircuitState } from '../types/circuit.js';

export interface MetricsCollector {
  recordRequest(circuitId: string, status: 'success' | 'failure' | 'open' | 'timeout'): void;
  recordStateChange(circuitId: string, from: CircuitState, to: CircuitState): void;
  recordDuration(circuitId: string, durationMs: number): void;
  recordConfidence(circuitId: string, confidence: number): void;
  recordCost(circuitId: string, costUsd: number, tokens: number): void;

  /**
   * Reset metrics for a specific circuit or all circuits.
   * Called automatically on eviction. Implement to prevent memory leaks.
   */
  reset?(circuitId?: string): void;
}

const EMPTY_COUNTS = Object.freeze({ success: 0, failure: 0, open: 0, timeout: 0 });

export class NoOpMetricsCollector implements MetricsCollector {
  recordRequest(): void {}
  recordStateChange(): void {}
  recordDuration(): void {}
  recordConfidence(): void {}
  recordCost(): void {}
}

export class DefaultMetricsCollector implements MetricsCollector {
  private requests = new Map<string, { success: number; failure: number; open: number; timeout: number }>();
  private stateChanges: Array<{ circuitId: string; from: CircuitState; to: CircuitState; time: number }> = [];
  private durations: Array<{ circuitId: string; durationMs: number }> = [];
  private confidenceReadings: Array<{ circuitId: string; confidence: number }> = [];
  private costReadings: Array<{ circuitId: string; costUsd: number; tokens: number }> = [];
  private readonly maxEntries = 10000;
  private readonly maxCircuits = 10000;

  recordRequest(circuitId: string, status: 'success' | 'failure' | 'open' | 'timeout'): void {
    const current = this.requests.get(circuitId) ?? { success: 0, failure: 0, open: 0, timeout: 0 };
    current[status]++;
    if (!this.requests.has(circuitId) && this.requests.size >= this.maxCircuits) {
      const firstKey = this.requests.keys().next().value;
      if (firstKey) this.requests.delete(firstKey);
    }
    this.requests.set(circuitId, current);
  }

  recordStateChange(circuitId: string, from: CircuitState, to: CircuitState): void {
    this.stateChanges.push({ circuitId, from, to, time: Date.now() });
    if (this.stateChanges.length > this.maxEntries) {
      this.stateChanges.shift();
    }
  }

  recordDuration(circuitId: string, durationMs: number): void {
    this.durations.push({ circuitId, durationMs });
    if (this.durations.length > this.maxEntries) {
      this.durations.shift();
    }
  }

  recordConfidence(circuitId: string, confidence: number): void {
    this.confidenceReadings.push({ circuitId, confidence });
    if (this.confidenceReadings.length > this.maxEntries) {
      this.confidenceReadings.shift();
    }
  }

  recordCost(circuitId: string, costUsd: number, tokens: number): void {
    this.costReadings.push({ circuitId, costUsd, tokens });
    if (this.costReadings.length > this.maxEntries) {
      this.costReadings.shift();
    }
  }

  reset(circuitId?: string): void {
    if (circuitId) {
      this.requests.delete(circuitId);
      this.stateChanges = this.stateChanges.filter((s) => s.circuitId !== circuitId);
      this.durations = this.durations.filter((d) => d.circuitId !== circuitId);
      this.confidenceReadings = this.confidenceReadings.filter((c) => c.circuitId !== circuitId);
      this.costReadings = this.costReadings.filter((c) => c.circuitId !== circuitId);
    } else {
      this.requests.clear();
      this.stateChanges.length = 0;
      this.durations.length = 0;
      this.confidenceReadings.length = 0;
      this.costReadings.length = 0;
    }
  }

  getRequestCounts(circuitId: string): { success: number; failure: number; open: number; timeout: number } {
    return this.requests.get(circuitId) ?? { ...EMPTY_COUNTS };
  }

  getStateChanges(): ReadonlyArray<{ circuitId: string; from: CircuitState; to: CircuitState; time: number }> {
    return this.stateChanges;
  }

  getDurations(circuitId?: string): ReadonlyArray<{ circuitId: string; durationMs: number }> {
    if (circuitId) return this.durations.filter((d) => d.circuitId === circuitId);
    return this.durations;
  }

  getConfidenceReadings(circuitId?: string): ReadonlyArray<{ circuitId: string; confidence: number }> {
    if (circuitId) return this.confidenceReadings.filter((c) => c.circuitId === circuitId);
    return this.confidenceReadings;
  }

  getCostReadings(circuitId?: string): ReadonlyArray<{ circuitId: string; costUsd: number; tokens: number }> {
    if (circuitId) return this.costReadings.filter((c) => c.circuitId === circuitId);
    return this.costReadings;
  }
}
