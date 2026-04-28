import type { TripStrategy } from './TripStrategy.js';
import type { CircuitBreakerStats, ResultMetadata } from '../types/circuit.js';

export class CostThresholdStrategy implements TripStrategy {
  readonly name = 'costThreshold';
  private costs: Array<{ cost: number; time: number }> = [];

  constructor(
    private readonly maxCostPerMinute: number,
    private readonly maxTokensPerCall: number = Number.POSITIVE_INFINITY,
    private readonly windowMs: number = 60000
  ) {}

  shouldTrip(): boolean {
    this.pruneOldCosts();
    const totalCost = this.costs.reduce((sum, c) => sum + c.cost, 0);
    return totalCost > this.maxCostPerMinute;
  }

  recordResult(_state: CircuitBreakerStats, metadata: ResultMetadata): void {
    if (metadata.costUsd !== undefined) {
      this.costs.push({ cost: metadata.costUsd, time: Date.now() });
    }
    if (metadata.tokens !== undefined && metadata.tokens > this.maxTokensPerCall) {
      this.costs.push({ cost: Number.POSITIVE_INFINITY, time: Date.now() });
    }
  }

  reset(): void {
    this.costs.length = 0;
  }

  private pruneOldCosts(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.costs.length > 0 && this.costs[0].time < cutoff) {
      this.costs.shift();
    }
  }
}
