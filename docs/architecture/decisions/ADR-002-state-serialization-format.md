# ADR-002: State Serialization Format

## Status
Accepted

## Context
Circuit breaker state must be persisted and shared across instances. We needed a format that:
- Validates on load (prevents corrupt state from propagating)
- Is versioned (supports optimistic locking)
- Is language-agnostic (JSON is fine)
- Includes all fields needed for lazy transition logic

## Decision
Use **Zod schemas** for runtime validation and **plain JSON objects** for serialization.

```typescript
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
```

## Consequences
- **Safety**: Corrupt or unexpected state is rejected at load time.
- **Type safety**: `z.infer<typeof CircuitBreakerStateSchema>` gives a TypeScript type.
- **Cost**: Zod is a runtime dependency of core (accepted trade-off for safety).

## Compliance
- All persistence adapters call `CircuitBreakerStateSchema.parse()` before saving/returning state.
- Invalid data in `loadAll()` is filtered out rather than crashing.

## Owner
Architect
