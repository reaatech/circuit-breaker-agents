import type { CircuitBreakerStats, ResultMetadata } from '../types/circuit.js';
import type { TripStrategy } from './TripStrategy.js';

export class ErrorThresholdStrategy implements TripStrategy {
  readonly name = 'errorThreshold';

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number = 60000,
    private readonly failures: Array<{ time: number }> = [],
  ) {}

  shouldTrip(): boolean {
    this.pruneOldFailures();
    return this.failures.length >= this.threshold;
  }

  recordResult(_state: CircuitBreakerStats, metadata: ResultMetadata): void {
    if (metadata.error === true) {
      this.failures.push({ time: Date.now() });
    }
  }

  reset(): void {
    this.failures.length = 0;
  }

  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.failures.length > 0 && this.failures[0].time < cutoff) {
      this.failures.shift();
    }
  }
}
