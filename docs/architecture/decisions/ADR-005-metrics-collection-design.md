# ADR-005: Metrics Collection Design

## Status
Accepted

## Context
Circuit breakers are critical infrastructure; operators need visibility into state changes, request outcomes, and agent-specific metadata (confidence, cost). We needed a design that works out of the box but integrates with arbitrary observability backends.

## Decision
Provide a `MetricsCollector` interface with two built-in implementations:

- `DefaultMetricsCollector` — in-memory counters (good for debugging and small deployments)
- `NoOpMetricsCollector` — zero overhead when metrics are disabled

```typescript
export interface MetricsCollector {
  recordRequest(circuitId: string, status: 'success' | 'failure' | 'open' | 'timeout'): void;
  recordStateChange(circuitId: string, from: CircuitState, to: CircuitState): void;
  recordDuration(circuitId: string, durationMs: number): void;
  recordConfidence(circuitId: string, confidence: number): void;
  recordCost(circuitId: string, costUsd: number, tokens: number): void;
}
```

The `CircuitBreaker` calls these methods automatically; users only need to provide a custom collector if they want external export.

## Consequences
- **Zero-config default**: `metricsEnabled: true` gives useful in-memory metrics immediately.
- **Backend agnostic**: Prometheus, Datadog, CloudWatch, etc. are all one adapter away.
- **No forced deps**: The interface has no external dependencies.

## Compliance
- `DefaultMetricsCollector` tests verify request counts and state changes.
- `CircuitBreaker.test.ts` verifies metrics are recorded during execute/timeout/failure paths.

## Owner
Performance
