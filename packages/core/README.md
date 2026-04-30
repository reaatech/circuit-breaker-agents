# @reaatech/circuit-breaker-core

Core circuit breaker logic for agent-to-tool and agent-to-agent communication. Provides the state machine, trip strategies, recovery strategies, error types, and metrics collection — with a single runtime dependency on `zod`.

## Feature Overview

- **Lazy auto-transition state machine** — no timers, no `setTimeout` races; `getState()` evaluates time-based transitions on demand
- **Completed-call tracking** — HALF_OPEN tracks completed calls (not in-flight), preventing overrun during recovery
- **Exponential backoff** — repeated failed recoveries double the backoff multiplier (capped, configurable)
- **Per-tool circuit isolation** — independent state per `circuitId`; supports per-agent, per-tool, and per-region granularity
- **Three trip strategies** — error threshold, confidence threshold, and cost threshold; composable (any can trip)
- **Two recovery strategies** — gradual (exponential ramp-up: 1, 2, 4, 8…) and single (all-or-nothing)
- **Pluggable metrics** — built-in `DefaultMetricsCollector` and `NoOpMetricsCollector`; implement `MetricsCollector` for custom backends
- **Event emitter** — lifecycle hooks for `stateChange`, `success`, `failure`, `timeout`, `persistenceError`, `callbackError`
- **Zero-dependency core** — only runtime dependency is `zod` for state validation
- **Dual ESM/CJS output** — full TypeScript declarations included

## Exports

### Core Class

| Export | Description |
|--------|-------------|
| `CircuitBreaker` | Main circuit breaker class with `execute()`, `getState()`, `getStats()`, event emitter, and manual control |

### State Machine

| Export | Description |
|--------|-------------|
| `StateMachine` | Lazy-transition state machine: CLOSED → OPEN → HALF_OPEN → CLOSED |

### Error Types

| Export | Parent | Description |
|--------|--------|-------------|
| `CircuitBreakerError` | `Error` | Base error with `code`, `circuitId`, `state` |
| `CircuitOpenError` | `CircuitBreakerError` | Thrown when circuit is OPEN and no fallback is provided |
| `CircuitTimeoutError` | `CircuitBreakerError` | Thrown when an operation exceeds its timeout |

### Trip Strategies

| Export | Condition |
|--------|-----------|
| `ErrorThresholdStrategy` | Failure count exceeds threshold within rolling window |
| `ConfidenceThresholdStrategy` | Average response confidence drops below `minConfidence` |
| `CostThresholdStrategy` | Cost-per-minute exceeds budget or tokens-per-call too high |

### Recovery Strategies

| Export | Behavior |
|--------|----------|
| `GradualRecoveryStrategy` | Exponential ramp-up: 1, 2, 4, 8, 16 test calls per phase |
| `SingleRecoveryStrategy` | All-or-nothing: one test call decides CLOSED or re-OPEN |

### Metrics Collectors

| Export | Description |
|--------|-------------|
| `DefaultMetricsCollector` | In-memory counters for request counts, durations, state changes, confidence, cost |
| `NoOpMetricsCollector` | Zero-overhead collector when `metricsEnabled: false` |

### Types

| Export | Description |
|--------|-------------|
| `CircuitBreakerOptions` | Constructor options: thresholds, timeouts, recovery config, persistence, metrics |
| `ExecutionContext` | Per-call context: `circuitId`, `onSuccess`, `onFailure`, `timeoutMs`, `fallback`, `forceRoute` |
| `ResultMetadata` | Callback result: `confidence`, `costUsd`, `tokens`, `latencyMs`, `error` |
| `CircuitState` | Union: `'CLOSED' \| 'OPEN' \| 'HALF_OPEN'` |
| `CircuitBreakerState` | Inferred from `CircuitBreakerStateSchema` via `z.infer` |
| `CircuitBreakerStats` | Full stats snapshot for a circuit |
| `CircuitEventType` | Union of event type strings |
| `CircuitEvent` | Event object with `type`, `circuit_id`, `timestamp`, `data` |
| `EventHandler` | Callback type: `(event: CircuitEvent) => void` |
| `TripStrategy` | Interface for custom trip strategies |
| `RecoveryStrategy` | Interface for custom recovery strategies |
| `MetricsCollector` | Interface for custom metrics backends |
| `CorePersistenceAdapter` | Minimal persistence interface for core integration |

### Schema

| Export | Description |
|--------|-------------|
| `CircuitBreakerStateSchema` | Zod schema for runtime validation on deserialization |

## Usage

```typescript
import { CircuitBreaker, CircuitOpenError } from '@reaatech/circuit-breaker-core';

const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  minConfidence: 0.7,
  maxCostPerMinute: 0.50,
  recoveryStrategy: 'gradual',
});

// Execute with metadata extraction for confidence/cost tracking
const result = await breaker.execute(
  () => openai.chat.completions.create({ model: 'gpt-4', messages }),
  {
    onSuccess: (response) => ({
      confidence: computeConfidence(response),
      costUsd: estimateCost(response),
    }),
  }
);

// Fallback when circuit is OPEN
const safe = await breaker.execute(
  () => primaryModel.call(prompt),
  { fallback: () => cheaperModel.call(prompt) }
);

// Inspect state and stats
breaker.getState('openai-gpt4');  // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
breaker.getStats('openai-gpt4');  // CircuitBreakerStats

// Event hooks
breaker.on('stateChange', (event) => {
  console.log(`${event.circuit_id}: ${event.data.from} → ${event.data.to}`);
});

// Manual control
breaker.reset();                        // Reset to CLOSED
breaker.forceState('openai-gpt4', 'OPEN');
// See @reaatech/circuit-breaker-persistence for persistence and leader election
```

## Installation

```bash
pnpm add @reaatech/circuit-breaker-core
# or: npm install @reaatech/circuit-breaker-core
```

For persistence adapters, install the meta-package:

```bash
pnpm add @reaatech/circuit-breaker-agents
```
