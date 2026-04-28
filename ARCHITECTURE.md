# Circuit Breaker Agents — Architecture Specification

## System Overview

`circuit-breaker-agents` is a standalone TypeScript library implementing the circuit breaker pattern specifically optimized for agent-to-tool and agent-to-agent communication. It extracts battle-tested patterns from three production systems:

- **ask-gm** — Leader-elected Firestore persistence with fencing tokens, fallback routing, completed-call tracking
- **agent-mesh** — Clean core/persistence separation, Zod state validation, auto-transition in `getState()`
- **voice-agent-kit** — Latency-budget-aware fast failure, lower thresholds for real-time paths

## Design Principles

1. **Fail fast, recover gradually** — OPEN state rejects immediately; HALF_OPEN uses exponential ramp-up (1, 2, 4, 8...)
2. **In-memory first, persist async** — State decisions happen in memory; persistence is best-effort async
3. **Leader-elected persistence** — Only one instance writes to shared storage to prevent quota exhaustion
4. **Fencing tokens for split-brain safety** — Atomic increments prevent network partition issues
5. **Graceful degradation** — If persistence fails, circuit breaker continues operating in-memory
6. **Zero-dependency core** — Core package has no external dependencies; adapters are optional

## Key Concepts

### Per-Tool vs Per-Agent vs Per-Host

Standard circuit breakers (opossum, cockatiel) key by **host** (hostname, URL). This is wrong for agent systems:

| Granularity | Key Example | Use Case |
|-------------|-------------|----------|
| **Per-host** | `api.openai.com` | Traditional HTTP client — one breaker per API domain |
| **Per-agent** | `it-helpdesk-agent` | Agent mesh — one breaker per agent endpoint |
| **Per-tool** | `openai-gpt4:code-interpreter` | Agent with multiple tools — one breaker per tool |

This library supports all three, but **per-tool is the default and recommended granularity** for agent systems. A single agent may have tools with different reliability characteristics (e.g., a web search tool that times out vs. a code interpreter that returns quickly).

### Circuit Identity

A circuit is uniquely identified by a `circuitId` string. The library does not enforce structure, but the convention is:

```
{agentId}:{toolId}
```

Examples:
- `openai-gpt4` — per-agent breaker
- `openai-gpt4:web-search` — per-tool breaker
- `openai-gpt4:web-search:us-east1` — per-tool per-region

## State Machine

### States

```
                    ┌─────────────┐
              ┌────▶│   CLOSED    │◀────┐
              │     │  (healthy)  │     │
              │     └──────┬──────┘     │
              │            │            │
              │     failures >= threshold    │ successes >= expected
              │            │            │
              │            ▼            │
              │     ┌──────────────┐    │
              │     │    OPEN      │    │
              │     │ (unhealthy)  │    │
              │     └──────┬───────┘    │
              │            │            │
              │   timeout * backoff     │
              │            │            │
              │            ▼            │
              └─────┌──────────────┐    │
                    │  HALF_OPEN   │────┘
                    │  (testing)   │
                    └──────────────┘
```

### State Transitions

| From | To | Trigger | Notes |
|------|-----|---------|-------|
| CLOSED | OPEN | `failureCount >= failureThreshold` | Immediate |
| OPEN | HALF_OPEN | `elapsed >= recoveryTimeout * backoffMultiplier` | Lazy transition in `getState()` |
| HALF_OPEN | CLOSED | `completedCalls >= expectedCalls` | All test calls must succeed |
| HALF_OPEN | OPEN | Any failure during test | Immediate, reset completed calls |
| HALF_OPEN | OPEN | `elapsed >= halfOpenTimeout` | Safety timeout forces reopen |
| ANY | CLOSED | Manual `reset()` | Clears all counters |

### Critical Design Decision: Auto-Transition in `getState()`

Following the agent-mesh pattern, `getState()` **lazily evaluates transitions** based on elapsed time:

```typescript
getState(circuitId: string): CircuitState {
  const state = this.getOrCreate(circuitId);
  
  // OPEN -> HALF_OPEN: check if recovery timeout has elapsed
  if (state.state === 'OPEN') {
    const elapsed = Date.now() - state.last_state_change;
    const effectiveTimeout = this.options.recoveryTimeoutMs * state.backoff_multiplier;
    if (elapsed >= effectiveTimeout) {
      this.transitionToHalfOpen(circuitId, state);
      return 'HALF_OPEN';
    }
  }
  
  // HALF_OPEN -> OPEN: check if half-open timeout exceeded
  if (state.state === 'HALF_OPEN') {
    const elapsed = Date.now() - state.last_state_change;
    if (elapsed >= this.options.halfOpenTimeoutMs) {
      this.transitionToOpen(circuitId, state);
      return 'OPEN';
    }
  }
  
  return state.state;
}
```

**Why this matters**: No timer management, no `setTimeout` races, no missed transitions during high load. The transition happens on the next state check.

### Critical Design Decision: Completed-Call Tracking in HALF_OPEN

Early implementations tracked "started calls" in HALF_OPEN, which allowed more in-flight requests than intended. This library tracks **completed calls** (success + failure):

```typescript
interface HalfOpenState {
  expectedCalls: number;    // Set when entering HALF_OPEN (1, 2, 4, 8...)
  completedCalls: number;   // Incremented on both success and failure
}
```

A call is "allowed" in HALF_OPEN only if `completedCalls < expectedCalls`. This ensures proper recovery testing without in-flight overrun.

### Exponential Backoff on Repeated Failures

Each time a circuit transitions OPEN -> HALF_OPEN -> OPEN (failed recovery), the backoff multiplier doubles:

```typescript
backoffMultiplier = Math.min(current * 2, maxBackoffMultiplier);
```

- Default `maxBackoffMultiplier`: 8× (ask-gm), configurable up to 32×
- Reset to 1× when transitioning to CLOSED

This prevents hammering a struggling service with recovery attempts.

## Core API

### CircuitBreaker Class

```typescript
class CircuitBreaker {
  constructor(options: CircuitBreakerOptions);
  
  // Primary execution API
  async execute<T>(
    operation: () => Promise<T>,
    context?: ExecutionContext
  ): Promise<T>;
  
  // State inspection
  getState(circuitId?: string): CircuitState;
  getStats(circuitId?: string): CircuitBreakerStats;
  
  // Result reporting (for confidence/cost tracking)
  recordResult(circuitId: string, result: ResultMetadata): void;
  
  // Manual control
  reset(circuitId?: string): void;
  forceState(circuitId: string, state: CircuitState): void;
  
  // Event handling
  on(event: CircuitEventType, handler: EventHandler): void;
  off(event: CircuitEventType, handler: EventHandler): void;
}
```

### ExecutionContext

```typescript
interface ExecutionContext {
  /** Circuit ID override (defaults to options.name) */
  circuitId?: string;
  
  /** Extract metadata from result for confidence/cost tracking */
  onSuccess?: (result: unknown) => ResultMetadata;
  
  /** Extract metadata from error for classification */
  onFailure?: (error: unknown) => ResultMetadata;
  
  /** Timeout for this specific operation */
  timeoutMs?: number;
  
  /** Fallback operation if circuit is OPEN */
  fallback?: () => Promise<unknown>;
}

interface ResultMetadata {
  /** Confidence score 0.0-1.0 */
  confidence?: number;
  /** Cost in USD */
  costUsd?: number;
  /** Token count */
  tokens?: number;
  /** Latency in ms */
  latencyMs?: number;
  /** Whether this result represents an error */
  error?: boolean;
}
```

### CircuitBreakerOptions

```typescript
interface CircuitBreakerOptions {
  /** Unique circuit identifier */
  name: string;
  
  // Error-based tripping
  failureThreshold?: number;        // default: 5
  failureWindowMs?: number;         // default: 60000
  
  // Confidence-based tripping
  minConfidence?: number;           // default: 0.7
  confidenceWindowMs?: number;      // default: 60000
  
  // Cost-based tripping
  maxCostPerMinute?: number;        // default: Infinity
  maxTokensPerCall?: number;        // default: Infinity
  
  // Recovery
  recoveryTimeoutMs?: number;       // default: 30000
  halfOpenTimeoutMs?: number;       // default: 60000
  recoveryStrategy?: 'gradual' | 'single';  // default: 'gradual'
  maxBackoffMultiplier?: number;    // default: 8
  
  // Timeouts
  requestTimeoutMs?: number;        // default: 30000
  
  // Persistence
  persistence?: PersistenceAdapter;
  
  // Metrics
  metricsEnabled?: boolean;         // default: true
  metricsCollector?: MetricsCollector;
}
```

### Gradual Recovery Strategy

```typescript
// Phase 0: 1 test request
// Phase 1: 2 test requests  
// Phase 2: 4 test requests
// Phase 3: 8 test requests
// Phase 4+: 16 test requests (configurable max)
// All tests pass -> CLOSED
// Any failure -> OPEN, increment backoff multiplier

function getExpectedCalls(phase: number, maxCalls: number): number {
  return Math.min(Math.pow(2, phase), maxCalls);
}
```

## Error Types

```typescript
class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly circuitId: string,
    public readonly state: CircuitState,
    options?: { cause?: Error }
  );
}
```

## Persistence Architecture

### Design Decision: In-Memory First, Async Persist

State transitions happen in memory immediately. Persistence is asynchronous and best-effort:

1. **State change** -> Update in-memory Map immediately
2. **Persist** -> Leader instance writes to Firestore/DynamoDB/Redis async
3. **Read** -> Load from persistence at startup, then serve from memory

**Rationale**: Circuit breaker decisions must be <1ms. Adding a network round-trip to every state check would violate latency budgets. The trade-off is that state may be stale for a few seconds after a crash (bounded by sync interval).

### Design Decision: Leader-Elected Persistence

Only one instance writes state to shared storage:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Instance A │     │  Instance B │     │  Instance C │
│  (Leader)   │     │  (Follower) │     │  (Follower) │
│             │     │             │     │             │
│ ┌─────────┐ │     │ ┌─────────┐ │     │ ┌─────────┐ │
│ │ In-Mem  │◀┼─────┼▶│ In-Mem  │◀┼─────┼▶│ In-Mem  │ │
│ │  State  │ │     │ │  State  │ │     │ │  State  │ │
│ └────┬────┘ │     │ └─────────┘ │     │ └─────────┘ │
│      │      │     │             │     │             │
│  ┌───▼───┐  │     │             │     │             │
│  │Persist│  │     │             │     │             │
│  │to FS  │  │     │             │     │             │
│  └───────┘  │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Why this matters**: In ask-gm's early implementation, all instances synced to Firestore simultaneously. This exhausted the Firestore write quota within minutes under load. Leader election reduces writes by N× (where N = instance count).

### Leader Election with Fencing Tokens

```typescript
interface LeaderElectionState {
  leaderId: string;       // Instance ID (prefer HOSTNAME over K_REVISION)
  acquiredAt: number;     // Timestamp
  leaseExpiresAt: number; // Timestamp + lease duration
  fencingToken: number;   // Atomic increment on each leadership change
}
```

The fencing token is atomically incremented using the database's increment operation (Firestore `FieldValue.increment`, DynamoDB `ADD`, Redis `INCR`). Before each write, the leader verifies its fencing token matches the stored value. If not, it has lost leadership and stops writing.

**Instance ID preference**: Use `HOSTNAME` (stable within instance lifetime) over `K_REVISION` (changes on every deployment), because deployment-triggered leader transitions cause unnecessary state sync disruption.

### Persistence Adapter Interface

```typescript
interface PersistenceAdapter {
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // State operations
  saveState(state: CircuitBreakerState): Promise<void>;
  loadState(circuitId: string): Promise<CircuitBreakerState | null>;
  deleteState(circuitId: string): Promise<void>;
  
  // Batch operations
  saveBatch(states: CircuitBreakerState[]): Promise<void>;
  loadAll(): Promise<CircuitBreakerState[]>;
  
  // Leader election (optional — adapters can omit if not needed)
  tryAcquireLeadership(instanceId: string, leaseMs: number): Promise<LeadershipResult>;
  releaseLeadership(instanceId: string): Promise<void>;
  
  // Health
  healthCheck(): Promise<HealthStatus>;
}

interface LeadershipResult {
  isLeader: boolean;
  fencingToken: number;
}
```

### Firestore Adapter

```typescript
class FirestoreAdapter implements PersistenceAdapter {
  constructor(options: {
    projectId?: string;
    collectionName: string;
    leaderCollectionName?: string;
  });
}
```

**Document structure**:
```
Collection: circuit_breakers
Document ID: {circuitId}
Fields:
  - circuit_id: string
  - state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  - failure_count: number
  - success_count: number
  - last_failure_time: timestamp | null
  - last_state_change: timestamp
  - half_open_expected_calls: number
  - half_open_completed_calls: number
  - backoff_multiplier: number
  - version: number           // For optimistic locking
  - updated_at: timestamp
```

**Optimistic locking**: Uses `version` field with Firestore transactions. If the stored version is newer than the local version, the local state is stale and the write is skipped.

### DynamoDB Adapter

```typescript
class DynamoDBAdapter implements PersistenceAdapter {
  constructor(options: {
    tableName: string;
    region?: string;
    ttlAttribute?: string;
  });
}
```

**Table design** (single-table):
```
PK: CIRCUIT#{circuitId}
SK: STATE
Attributes:
  - circuit_id: string
  - state: string
  - failure_count: number
  - success_count: number
  - last_failure_time: number | null
  - last_state_change: number
  - half_open_expected_calls: number
  - half_open_completed_calls: number
  - backoff_multiplier: number
  - version: number
  - ttl: number              // Auto-expire CLOSED states
```

**Conditional writes**: Uses `ConditionExpression` for optimistic locking:
```
attribute_not_exists(version) OR version < :localVersion
```

### Redis Adapter

```typescript
class RedisAdapter implements PersistenceAdapter {
  constructor(options: {
    redis: RedisClient;
    keyPrefix?: string;
    ttlSeconds?: number;
  });
}
```

**Storage**: Uses Redis hashes for state, with a Lua script for atomic compare-and-set:

```lua
local current = redis.call('HGET', KEYS[1], 'version')
if not current or tonumber(current) < tonumber(ARGV[1]) then
  redis.call('HMSET', KEYS[1], unpack(ARGV, 2, #ARGV))
  return 1
end
return 0
```

**Pub/Sub**: Optional real-time state synchronization across instances using Redis pub/sub.

### Behavior When Persistence Fails

```
Persistence unavailable:
  1. Log warning
  2. Continue operating in-memory
  3. Retry connection with exponential backoff
  4. On reconnection: merge local state with persisted state (newer wins)

Leader election fails:
  1. Continue as follower
  2. In-memory state works normally
  3. Persistence handled by current leader
  4. If no leader exists: all instances operate in-memory only
```

## State Validation

All persisted state is validated with Zod before being loaded into memory:

```typescript
import { z } from 'zod';

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
```

**Why this matters**: Prevents corrupt or malformed state from propagating across restarts. If validation fails, the circuit starts fresh with default state.

## Fallback Routing

When a circuit is OPEN, the library supports fallback to an alternative tool via the `ExecutionContext`:

```typescript
const breaker = new CircuitBreaker({
  name: 'openai-gpt4:web-search',
});

// When web-search is OPEN, automatically falls back to code-interpreter
const result = await breaker.execute(() => webSearch(query), {
  fallback: async () => alternativeTool.call(query),
});
```

**Force-route bypass**: For critical paths (e.g., a default agent that must never be fully blocked), use `forceRoute: true` to bypass the circuit breaker:

```typescript
await breaker.execute(() => defaultAgent.call(), { forceRoute: true });
```

## Metrics & Observability

### Built-in Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `circuit_breaker_state` | Gauge | circuit_id, state |
| `circuit_breaker_requests_total` | Counter | circuit_id, status (success/failure/open) |
| `circuit_breaker_request_duration_ms` | Histogram | circuit_id |
| `circuit_breaker_transitions_total` | Counter | circuit_id, from, to |
| `circuit_breaker_confidence_avg` | Gauge | circuit_id |
| `circuit_breaker_cost_usd_total` | Counter | circuit_id |

### Event Types

```typescript
type CircuitEventType =
  | 'stateChange'      // CLOSED -> OPEN, OPEN -> HALF_OPEN, etc.
  | 'success'          // Operation succeeded
  | 'failure'          // Operation failed
  | 'timeout'          // Operation timed out
  | 'persistenceError' // Persistence operation failed
  | 'callbackError';   // Error in callback handler (onSuccess/onFailure/event)
```


## File Structure

```
circuit-breaker-agents/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── CircuitBreaker.ts          # Main circuit breaker class
│   │   │   ├── CircuitBreakerError.ts     # Error types
│   │   │   ├── StateMachine.ts            # State transition logic
│   │   │   ├── strategies/
│   │   │   │   ├── ErrorThresholdStrategy.ts
│   │   │   │   ├── ConfidenceThresholdStrategy.ts
│   │   │   │   ├── CostThresholdStrategy.ts
│   │   │   │   └── GradualRecoveryStrategy.ts
│   │   │   ├── types/
│   │   │   │   ├── circuit.ts             # Zod schemas + TS types
│   │   │   │   ├── config.ts
│   │   │   │   └── events.ts
│   │   │   ├── metrics/
│   │   │   │   └── MetricsCollector.ts
│   │   │   └── index.ts
│   │   ├── test/
│   │   │   ├── CircuitBreaker.test.ts
│   │   │   ├── StateMachine.test.ts
│   │   │   └── strategies/
│   │   └── package.json
│   │
│   ├── persistence/
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   ├── FirestoreAdapter.ts
│   │   │   │   ├── DynamoDBAdapter.ts
│   │   │   │   ├── RedisAdapter.ts
│   │   │   │   └── InMemoryAdapter.ts
│   │   │   ├── leader/
│   │   │   │   └── LeaderElection.ts
│   │   │   ├── types/
│   │   │   │   └── adapter.ts
│   │   │   └── index.ts
│   │   ├── test/
│   │   └── package.json
│   │
│   └── examples/
│       ├── basic-usage/
│       ├── with-firestore/
│       ├── with-dynamodb/
│       └── with-redis/
│
├── docs/
│   ├── api/                    # Typedoc output
│   ├── guides/
│   │   ├── configuration.md
│   │   ├── persistence.md
│   │   ├── metrics.md
│   │   └── migration.md
│   └── architecture/
│       └── decisions/          # ADRs
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
│
├── package.json                # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json
├── turbo.json
└── README.md
```

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| State check latency (p50) | < 1ms | In-memory Map lookup |
| State check latency (p99) | < 5ms | Including lazy transition check |
| State transition latency | < 10ms | In-memory update |
| Persistence latency | < 100ms | Firestore write (async, leader only) |
| Memory overhead | < 1KB per circuit | In-memory state storage |
| Bundle size (core) | < 50KB gzipped | Zero dependencies |

## Testing Strategy

### Unit Tests
- State machine transitions (all 9 transitions)
- Trip strategy calculations (error rate, confidence avg, cost rate)
- Recovery phase progression (1, 2, 4, 8, max)
- Exponential backoff calculation
- Event emission

### Integration Tests
- Persistence adapter operations (save/load/leader election)
- Multi-instance coordination (mocked leader election)
- State restore at startup

### Chaos Tests
- Persistence failure during operation
- Leader election failure
- Network partition simulation
- Clock skew simulation

## Migration from Reference Implementations

### From ask-gm

ask-gm uses a functional API (`shouldAllowRequest`, `recordSuccess`, `recordFailure`). This library wraps these in a class-based API:

```typescript
// ask-gm (functional)
if (shouldAllowRequest(agentId)) {
  try {
    const result = await callAgent();
    recordSuccess(agentId);
  } catch (err) {
    recordFailure(agentId, err);
  }
}

// circuit-breaker-agents (class-based)
const result = await breaker.execute(() => callAgent());
```

Key differences:
- **Auto-transition**: `getState()` handles OPEN→HALF_OPEN lazily; no manual timer management
- **Completed-call tracking**: HALF_OPEN tracks completed calls, not started calls
- **Fencing tokens**: Leader election uses atomic increments, not in-memory counters

### From agent-mesh

agent-mesh uses a singleton `CircuitBreaker` class with separate persistence. This library is similar but adds:
- **Per-tool granularity**: `circuitId` can be `{agent}:{tool}` not just `{agent}`
- **Confidence/cost tracking**: Built-in strategies, not just error-based
- **Gradual recovery**: 1, 2, 4, 8... instead of fixed 3 test calls

## Future Extensibility

### Planned
- PostgreSQL persistence adapter
- MongoDB persistence adapter
- Distributed circuit breaker coordination (Raft-based)
- ML-based threshold adjustment
- WebSocket real-time state dashboard

### Extension Points
- Custom `TripStrategy` interface
- Custom `RecoveryStrategy` interface
- Custom `PersistenceAdapter` interface
- Custom `MetricsCollector` interface
- Event middleware chain
