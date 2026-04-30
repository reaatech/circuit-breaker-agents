import type { CircuitBreakerState, CircuitBreakerStats, CircuitState } from './types/circuit.js';

export interface InternalCircuitState extends CircuitBreakerState {
  total_calls: number;
  total_failures: number;
  total_successes: number;
  half_open_in_flight_calls: number;
}

export interface StateMachineOptions {
  failureThreshold: number;
  recoveryTimeoutMs: number;
  halfOpenTimeoutMs: number;
  maxBackoffMultiplier: number;
}

export class StateMachine {
  private states = new Map<string, InternalCircuitState>();

  constructor(private readonly options: StateMachineOptions) {}

  getOrCreate(circuitId: string): InternalCircuitState {
    let state = this.states.get(circuitId);
    if (!state) {
      state = this.createInitialState(circuitId);
      this.states.set(circuitId, state);
    }
    return state;
  }

  setHalfOpenExpectedCalls(circuitId: string, expectedCalls: number): void {
    const state = this.getOrCreate(circuitId);
    if (state.state === 'HALF_OPEN') {
      state.half_open_expected_calls = expectedCalls;
    }
  }

  getState(circuitId: string): CircuitState {
    const state = this.getOrCreate(circuitId);

    if (state.state === 'OPEN') {
      const elapsed = Date.now() - state.last_state_change;
      const effectiveTimeout = this.options.recoveryTimeoutMs * state.backoff_multiplier;
      if (elapsed >= effectiveTimeout) {
        this.transitionToHalfOpen(circuitId, state);
        return 'HALF_OPEN';
      }
    }

    if (state.state === 'HALF_OPEN') {
      const elapsed = Date.now() - state.last_state_change;
      if (elapsed >= this.options.halfOpenTimeoutMs) {
        this.transitionToOpen(circuitId, state);
        return 'OPEN';
      }
    }

    return state.state;
  }

  getStats(circuitId: string): CircuitBreakerStats {
    const state = this.getOrCreate(circuitId);
    return {
      circuit_id: state.circuit_id,
      state: state.state,
      failure_count: state.failure_count,
      success_count: state.success_count,
      last_failure_time: state.last_failure_time,
      last_state_change: state.last_state_change,
      half_open_expected_calls: state.half_open_expected_calls,
      half_open_completed_calls: state.half_open_completed_calls,
      half_open_in_flight_calls: state.half_open_in_flight_calls,
      backoff_multiplier: state.backoff_multiplier,
      version: state.version,
      total_calls: state.total_calls,
      total_failures: state.total_failures,
      total_successes: state.total_successes,
    };
  }

  canExecute(circuitId: string): boolean {
    const state = this.getOrCreate(circuitId);

    if (state.state === 'CLOSED') return true;

    const elapsed = Date.now() - state.last_state_change;

    if (state.state === 'OPEN') {
      const effectiveTimeout = this.options.recoveryTimeoutMs * state.backoff_multiplier;
      if (elapsed >= effectiveTimeout) return true;
      return false;
    }

    if (state.state === 'HALF_OPEN') {
      if (elapsed >= this.options.halfOpenTimeoutMs) return false;
      return (
        state.half_open_completed_calls + state.half_open_in_flight_calls <
        state.half_open_expected_calls
      );
    }

    return true;
  }

  incrementInFlight(circuitId: string): void {
    const state = this.getOrCreate(circuitId);
    state.half_open_in_flight_calls++;
  }

  decrementInFlight(circuitId: string): void {
    const state = this.getOrCreate(circuitId);
    if (state.half_open_in_flight_calls > 0) {
      state.half_open_in_flight_calls--;
    }
  }

  recordSuccess(circuitId: string): void {
    const state = this.getOrCreate(circuitId);
    state.total_calls++;
    state.total_successes++;

    if (state.state === 'HALF_OPEN') {
      state.half_open_completed_calls++;
      state.success_count++;

      if (state.half_open_completed_calls >= state.half_open_expected_calls) {
        this.transitionToClosed(circuitId, state);
      }
    } else {
      state.failure_count = 0;
      state.success_count++;
    }
  }

  recordFailure(circuitId: string): void {
    const state = this.getOrCreate(circuitId);
    state.total_calls++;
    state.total_failures++;
    state.failure_count++;
    state.last_failure_time = Date.now();

    if (state.state === 'HALF_OPEN') {
      state.half_open_completed_calls++;
      this.transitionToOpen(circuitId, state);
    }
  }

  reset(circuitId: string): void {
    const state = this.states.get(circuitId);
    if (state) {
      const fresh = this.createInitialState(circuitId);
      fresh.version = state.version + 1;
      this.states.set(circuitId, fresh);
    }
  }

  forceState(circuitId: string, newState: CircuitState): void {
    const state = this.getOrCreate(circuitId);
    state.state = newState;
    state.last_state_change = Date.now();
    state.version++;

    if (newState === 'CLOSED') {
      state.failure_count = 0;
      state.success_count = 0;
      state.half_open_expected_calls = 0;
      state.half_open_completed_calls = 0;
      state.half_open_in_flight_calls = 0;
      state.backoff_multiplier = 1;
    } else if (newState === 'HALF_OPEN') {
      state.failure_count = 0;
      state.success_count = 0;
      state.half_open_expected_calls = 0;
      state.half_open_completed_calls = 0;
      state.half_open_in_flight_calls = 0;
    }
  }

  evict(circuitId: string): void {
    this.states.delete(circuitId);
  }

  getAllStates(): Map<string, CircuitState> {
    const result = new Map<string, CircuitState>();
    for (const [id, state] of this.states) {
      result.set(id, state.state);
    }
    return result;
  }

  loadPersistedState(circuitId: string, persisted: CircuitBreakerState): void {
    const existing = this.states.get(circuitId);
    if (existing) {
      if (persisted.version > existing.version) {
        this.states.set(circuitId, {
          ...persisted,
          total_calls: existing.total_calls,
          total_failures: existing.total_failures,
          total_successes: existing.total_successes,
          half_open_in_flight_calls: 0,
        });
      }
    } else {
      this.states.set(circuitId, {
        ...persisted,
        total_calls: 0,
        total_failures: 0,
        total_successes: 0,
        half_open_in_flight_calls: 0,
      });
    }
  }

  private createInitialState(circuitId: string): InternalCircuitState {
    return {
      circuit_id: circuitId,
      state: 'CLOSED',
      failure_count: 0,
      success_count: 0,
      last_state_change: Date.now(),
      half_open_expected_calls: 0,
      half_open_completed_calls: 0,
      half_open_in_flight_calls: 0,
      backoff_multiplier: 1,
      version: 1,
      total_calls: 0,
      total_failures: 0,
      total_successes: 0,
    };
  }

  private transitionToOpen(_circuitId: string, state: InternalCircuitState): void {
    const newMultiplier =
      state.state === 'HALF_OPEN'
        ? Math.min(state.backoff_multiplier * 2, this.options.maxBackoffMultiplier)
        : state.backoff_multiplier;
    state.state = 'OPEN';
    state.last_state_change = Date.now();
    state.success_count = 0;
    state.half_open_expected_calls = 0;
    state.half_open_completed_calls = 0;
    state.half_open_in_flight_calls = 0;
    state.backoff_multiplier = newMultiplier;
    state.version++;
  }

  private transitionToHalfOpen(_circuitId: string, state: InternalCircuitState): void {
    state.state = 'HALF_OPEN';
    state.last_state_change = Date.now();
    state.failure_count = 0;
    state.success_count = 0;
    state.half_open_completed_calls = 0;
    state.half_open_in_flight_calls = 0;
    state.version++;
  }

  private transitionToClosed(_circuitId: string, state: InternalCircuitState): void {
    state.state = 'CLOSED';
    state.last_state_change = Date.now();
    state.failure_count = 0;
    state.success_count = 0;
    state.half_open_expected_calls = 0;
    state.half_open_completed_calls = 0;
    state.half_open_in_flight_calls = 0;
    state.backoff_multiplier = 1;
    state.version++;
  }
}
