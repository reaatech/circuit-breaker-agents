# @reaatech/circuit-breaker-persistence

Persistence adapters for circuit breaker state — survive restarts and share state across instances. Provides a consistent `PersistenceAdapter` interface with four implementations: in-memory, Firestore, DynamoDB, and Redis.

## Feature Overview

- **Single abstraction** — `PersistenceAdapter` interface defines 11 methods shared by all implementations
- **In-memory adapter** — `Map`-backed, ephemeral, zero setup; ideal for testing and single-process deployments
- **Firestore adapter** — GCP-native, transactional writes with `FieldValue.increment` fencing tokens
- **DynamoDB adapter** — AWS-native, single-table design with conditional writes and TTL auto-expiry
- **Redis adapter** — Low-latency hashes with Lua-scripted atomic compare-and-set
- **Leader election** — lease-based with fencing tokens; prevents write amplification in multi-instance deployments
- **Optimistic locking** — version-based conditional writes prevent stale state from overwriting newer state
- **Best-effort async** — persistence is fire-and-forget; circuit breaker continues in-memory on write failure
- **Subpath exports** — import adapters individually to avoid loading unused peer dependencies
- **Dual ESM/CJS output** — full TypeScript declarations

## Exports

### Adapters

| Export | Dependency | Description |
|--------|-----------|-------------|
| `InMemoryAdapter` | none | `Map`-backed, ephemeral, zero setup |
| `FirestoreAdapter` | `@google-cloud/firestore` (peer) | GCP-native, transactional writes, leader election |
| `DynamoDBAdapter` | `@aws-sdk/client-dynamodb` (peer) | AWS-native, single-table, conditional writes, TTL |
| `RedisAdapter` | `ioredis` (peer) | Lua-scripted atomic ops, pub/sub support, leader election |

### Subpath Exports

```typescript
// Direct imports — avoid loading unused peer dependencies
import { FirestoreAdapter } from '@reaatech/circuit-breaker-persistence/adapters/firestore';
import { DynamoDBAdapter } from '@reaatech/circuit-breaker-persistence/adapters/dynamodb';
import { RedisAdapter }      from '@reaatech/circuit-breaker-persistence/adapters/redis';
```

### Leader Election

| Export | Description |
|--------|-------------|
| `LeaderElection` | Abstract class: lease-based with `tryAcquireLeadership()` / `releaseLeadership()` |
| `MemoryLeaderElection` | In-process leader election for testing and single-instance deployments |

### Types

| Export | Description |
|--------|-------------|
| `PersistenceAdapter` | Interface: `connect`, `disconnect`, `saveState`, `loadState`, `deleteState`, `saveBatch`, `loadAll`, `tryAcquireLeadership`, `releaseLeadership`, `healthCheck` |
| `HealthStatus` | Result: `{ healthy: boolean, latencyMs?: number, message?: string }` |
| `LeadershipResult` | Result: `{ isLeader: boolean, fencingToken: number }` |

## Adapter Comparison

| Adapter | Best For | Latency | Leader Election |
|---------|----------|---------|-----------------|
| `InMemoryAdapter` | Testing / single process | <1ms | No |
| `RedisAdapter` | Multi-instance, low latency | ~5ms | Yes (Lua scripts) |
| `FirestoreAdapter` | GCP environments | ~50-100ms | Yes (transactions) |
| `DynamoDBAdapter` | AWS environments | ~20-50ms | Yes (conditional writes) |

## Usage

### In-Memory (testing)

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-core';
import { InMemoryAdapter } from '@reaatech/circuit-breaker-persistence';

const adapter = new InMemoryAdapter();
const breaker = new CircuitBreaker({
  name: 'my-circuit',
  persistence: adapter,
});
```

### Firestore

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-core';
import { FirestoreAdapter } from '@reaatech/circuit-breaker-persistence';
import { Firestore } from '@google-cloud/firestore';

const adapter = new FirestoreAdapter(
  new Firestore({ projectId: 'my-project' }),
  'circuit_breakers'
);
await adapter.connect();
```

### DynamoDB

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-core';
import { DynamoDBAdapter } from '@reaatech/circuit-breaker-persistence';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const adapter = new DynamoDBAdapter(
  new DynamoDBClient({ region: 'us-east-1' }),
  'circuit_breakers'
);
await adapter.connect();
```

### Redis

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-core';
import { RedisAdapter } from '@reaatech/circuit-breaker-persistence';
import { Redis } from 'ioredis';

const adapter = new RedisAdapter(
  new Redis({ host: 'localhost', port: 6379 }),
  'cb'
);
await adapter.connect();
```

### Leader Election

```typescript
import { MemoryLeaderElection } from '@reaatech/circuit-breaker-persistence';

const election = new MemoryLeaderElection('instance-1', 10000);
const result = await election.tryAcquireLeadership();
if (result.isLeader) {
  // This instance holds the lease — safe to persist
}
// result.fencingToken — atomically incremented on each leadership change
```

### Health Check

```typescript
const health = await adapter.healthCheck();
console.log(health.healthy);     // boolean
console.log(health.latencyMs);   // optional — response time
console.log(health.message);     // optional — error details if unhealthy
```

## Optimistic Locking

All adapters use **version-based optimistic locking** to prevent stale writes:

- In-memory: skip save if `existing.version >= new.version`
- Redis: Lua script checks `HGET version` before `HMSET`
- DynamoDB: `ConditionExpression: attribute_not_exists(version) OR version < :version`
- Firestore: transaction checks `storedData.version < validated.version`

The `CircuitBreaker` increments `version` on every state transition.

## Installation

```bash
pnpm add @reaatech/circuit-breaker-persistence
# or: npm install @reaatech/circuit-breaker-persistence

# Peer dependencies (install only the ones you need):
pnpm add @google-cloud/firestore                  # Firestore
pnpm add @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb  # DynamoDB
pnpm add ioredis                                  # Redis
```
