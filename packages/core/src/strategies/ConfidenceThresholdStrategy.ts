import type { TripStrategy } from './TripStrategy.js';
import type { CircuitBreakerStats, ResultMetadata } from '../types/circuit.js';

export class ConfidenceThresholdStrategy implements TripStrategy {
  readonly name = 'confidenceThreshold';
  private scores: Array<{ score: number; time: number }> = [];

  constructor(
    private readonly minConfidence: number,
    private readonly windowMs: number = 60000
  ) {}

  shouldTrip(): boolean {
    this.pruneOldScores();
    if (this.scores.length === 0) return false;
    const avg = this.scores.reduce((sum, s) => sum + s.score, 0) / this.scores.length;
    return avg < this.minConfidence;
  }

  recordResult(_state: CircuitBreakerStats, metadata: ResultMetadata): void {
    if (metadata.confidence !== undefined) {
      this.scores.push({ score: metadata.confidence, time: Date.now() });
    }
  }

  reset(): void {
    this.scores.length = 0;
  }

  private pruneOldScores(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.scores.length > 0 && this.scores[0].time < cutoff) {
      this.scores.shift();
    }
  }
}
