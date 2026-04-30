import type { RecoveryStrategy } from './TripStrategy.js';

export class GradualRecoveryStrategy implements RecoveryStrategy {
  readonly name = 'gradual';
  private phases = new Map<string, number>();

  constructor(private readonly maxCalls: number = 16) {}

  getExpectedCalls(circuitId: string): number {
    const phase = this.phases.get(circuitId) ?? 0;
    return Math.min(2 ** phase, this.maxCalls);
  }

  onSuccess(circuitId: string): void {
    const current = this.phases.get(circuitId) ?? 0;
    this.phases.set(circuitId, current + 1);
  }

  onFailure(circuitId: string): void {
    this.phases.set(circuitId, 0);
  }

  reset(circuitId?: string): void {
    if (circuitId) {
      this.phases.delete(circuitId);
    } else {
      this.phases.clear();
    }
  }

  getCurrentPhase(circuitId: string): number {
    return this.phases.get(circuitId) ?? 0;
  }
}

export class SingleRecoveryStrategy implements RecoveryStrategy {
  readonly name = 'single';
  private phases = new Map<string, number>();

  getExpectedCalls(_circuitId: string): number {
    return 1;
  }

  onSuccess(circuitId: string): void {
    const current = this.phases.get(circuitId) ?? 0;
    this.phases.set(circuitId, current + 1);
  }

  onFailure(circuitId: string): void {
    this.phases.set(circuitId, 0);
  }

  reset(circuitId?: string): void {
    if (circuitId) {
      this.phases.delete(circuitId);
    } else {
      this.phases.clear();
    }
  }

  getCurrentPhase(circuitId: string): number {
    return this.phases.get(circuitId) ?? 0;
  }
}
