# Persistence Guide

## Overview

Persistence adapters let circuit state survive process restarts and share state across instances. The core circuit breaker works entirely in-memory; persistence is **best-effort async** and does not block execution.

```
State change → Update in-memory Map immediately
            → Save to adapter async (fire-and-forget)
```

If persistence fails, the circuit continues operating in-memory and emits a `persistenceError` event.

## Using an Adapter

```typescript
import { CircuitBreaker, InMemoryAdapter } from '@reaatech/circuit-breaker-agents';

const adapter = new InMemoryAdapter();
const breaker = new CircuitBreaker({
  name: 'my-circuit',
  persistence: adapter,
});
```

On the first call to `execute(circuitId)`, the breaker loads persisted state for that ID. After every transition, it saves state asynchronously.

## Adapter Comparison

| Adapter | Best For | Latency | Leader Election |
|---------|----------|---------|-----------------|
| `InMemoryAdapter` | Single process / testing | <1ms | No |
| `RedisAdapter` | Multi-instance, low latency | ~5ms | Yes (Lua scripts) |
| `FirestoreAdapter` | GCP environments | ~50-100ms | Yes (transactions) |
| `DynamoDBAdapter` | AWS environments | ~20-50ms | Yes (conditional writes) |

## Optimistic Locking

All adapters use **version-based optimistic locking** to prevent stale writes:

- In-memory: skips save if `existing.version >= new.version`
- Redis: Lua script checks `HGET version` before `HMSET`
- DynamoDB: `ConditionExpression: attribute_not_exists(version) OR version < :version`
- Firestore: transaction checks `storedData.version < validated.version`

The `CircuitBreaker` increments `version` on every state transition.

## Leader Election

For shared backends (Redis, Firestore, DynamoDB), only the leader instance should write state to prevent quota exhaustion.

```typescript
import { LeaderElection, MemoryLeaderElection } from '@reaatech/circuit-breaker-agents';

const election = new MemoryLeaderElection('instance-1', 10000);
const result = await election.tryAcquireLeadership();
if (result.isLeader) {
  // This instance is the leader — safe to persist
}
```

Each successful acquisition returns an incremented **fencing token**. Adapters validate the token before writes to prevent split-brain.

## Health Checks

All adapters implement `healthCheck()`:

```typescript
const health = await adapter.healthCheck();
console.log(health.healthy, health.latencyMs, health.message);
```
