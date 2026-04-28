import { CircuitBreakerStateSchema, type CircuitBreakerState } from 'circuit-breaker-core';

export function parseState(data: Record<string, unknown>): CircuitBreakerState | null {
  try {
    return CircuitBreakerStateSchema.parse({
      circuit_id: data.circuit_id,
      state: data.state,
      failure_count: data.failure_count ?? 0,
      success_count: data.success_count ?? 0,
      last_failure_time: data.last_failure_time ?? undefined,
      last_state_change: data.last_state_change,
      half_open_expected_calls: data.half_open_expected_calls ?? 0,
      half_open_completed_calls: data.half_open_completed_calls ?? 0,
      backoff_multiplier: data.backoff_multiplier ?? 1,
      version: data.version ?? 1,
    });
  } catch {
    return null;
  }
}
