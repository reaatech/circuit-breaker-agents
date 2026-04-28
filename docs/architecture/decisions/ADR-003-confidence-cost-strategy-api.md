# ADR-003: Confidence/Cost Strategy API

## Status
Accepted

## Context
Standard circuit breakers trip only on errors. Agent systems need to trip on low-confidence responses and excessive cost/token burn. We needed a pluggable strategy system that supports these without bloating the core API.

## Decision
Introduce a `TripStrategy` interface with three built-in implementations:

- `ErrorThresholdStrategy` — time-windowed failure count
- `ConfidenceThresholdStrategy` — rolling average confidence below threshold
- `CostThresholdStrategy` — cost per minute or tokens per call exceeded

Strategies are composed: **any strategy can trip the circuit**. Metadata is extracted via `onSuccess` / `onFailure` callbacks in `ExecutionContext`.

```typescript
export interface TripStrategy {
  readonly name: string;
  shouldTrip(state: CircuitBreakerStats, metadata?: ResultMetadata): boolean;
  recordResult(state: CircuitBreakerStats, metadata: ResultMetadata): void;
  reset(): void;
}
```

## Consequences
- **Extensible**: Users can implement custom strategies (e.g., latency-budget tripping).
- **Agent-native**: Confidence and cost are first-class concepts, not afterthoughts.
- **Composable**: Multiple strategies can be active simultaneously.

## Compliance
- All strategies have unit tests covering trip, reset, and pruning behavior.
- Strategy names are included in `stateChange` event reasons for observability.

## Owner
Architect
