import { z } from 'zod';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export const CircuitBreakerStateSchema = z.object({
  circuit_id: z.string().min(1),
  state: z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']),
  failure_count: z.number().min(0).default(0),
  success_count: z.number().min(0).default(0),
  last_failure_time: z.number().optional(),
  last_state_change: z.number(),
  half_open_expected_calls: z.number().min(0).default(0),
  half_open_completed_calls: z.number().min(0).default(0),
  backoff_multiplier: z.number().min(1).default(1),
  version: z.number().min(1).default(1),
});

export type CircuitBreakerState = z.infer<typeof CircuitBreakerStateSchema>;

export interface CircuitBreakerStats {
  circuit_id: string;
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure_time?: number;
  last_state_change: number;
  half_open_expected_calls: number;
  half_open_completed_calls: number;
  half_open_in_flight_calls: number;
  backoff_multiplier: number;
  version: number;
  total_calls: number;
  total_failures: number;
  total_successes: number;
}

export interface ResultMetadata {
  confidence?: number;
  costUsd?: number;
  tokens?: number;
  latencyMs?: number;
  error?: boolean;
}
