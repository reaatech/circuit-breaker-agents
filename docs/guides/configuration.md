# Configuration Guide

## CircuitBreakerOptions

All options are passed to the `CircuitBreaker` constructor.

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-agents';

const breaker = new CircuitBreaker({
  name: 'my-agent',              // required — default circuit ID
  failureThreshold: 5,           // trip after 5 failures (default: 5)
  failureWindowMs: 60000,        // count failures within this window (default: 60000)
  recoveryTimeoutMs: 30000,      // wait before HALF_OPEN (default: 30000)
  halfOpenTimeoutMs: 60000,      // max time in HALF_OPEN (default: 60000)
  maxBackoffMultiplier: 8,       // max backoff for recovery (default: 8)
  recoveryStrategy: 'gradual',   // 'gradual' | 'single' (default: 'gradual')
  requestTimeoutMs: 30000,       // per-request timeout (default: 30000)
  metricsEnabled: true,          // enable DefaultMetricsCollector (default: true)
  metricsCollector: myCollector, // custom collector (optional)
  persistence: myAdapter,        // persistence adapter (optional)
});
```

### Per-Tool Granularity

Use `circuitId` in `ExecutionContext` to manage multiple tools with one breaker instance:

```typescript
await breaker.execute(() => webSearch(query), { circuitId: 'agent:web-search' });
await breaker.execute(() => codeInterpreter(code), { circuitId: 'agent:code' });
```

If `circuitId` is omitted, `options.name` is used.

## Agent-Specific Options

### Confidence-Aware Tripping

```typescript
const breaker = new CircuitBreaker({
  name: 'llm-calls',
  minConfidence: 0.7,         // trip when avg confidence < 70%
  confidenceWindowMs: 60000,  // rolling window (default: 60000)
});

await breaker.execute(() => llm.call(prompt), {
  onSuccess: (result) => ({
    confidence: result.logprobs?.mean ?? 1.0,
  }),
});
```

### Cost-Aware Tripping

```typescript
const breaker = new CircuitBreaker({
  name: 'expensive-llm',
  maxCostPerMinute: 0.50,   // trip when cost > $0.50/min
  maxTokensPerCall: 8000,   // trip on single call > 8k tokens
});

await breaker.execute(() => llm.call(prompt), {
  onSuccess: (result) => ({
    costUsd: result.usage.total_tokens * 0.00001,
    tokens: result.usage.total_tokens,
  }),
});
```

## ExecutionContext

| Option | Type | Description |
|--------|------|-------------|
| `circuitId` | `string` | Override circuit ID for this call |
| `onSuccess` | `(result: unknown) => ResultMetadata` | Extract metadata from success |
| `onFailure` | `(error: unknown) => ResultMetadata` | Extract metadata from failure |
| `timeoutMs` | `number` | Override request timeout |
| `fallback` | `() => Promise<unknown>` | Fallback when circuit is OPEN |
| `forceRoute` | `boolean` | Bypass circuit checks entirely |

## Recovery Strategies

- **`gradual`** (default): HALF_OPEN allows 1, 2, 4, 8… test calls until all succeed.
- **`single`**: HALF_OPEN allows exactly 1 test call.
