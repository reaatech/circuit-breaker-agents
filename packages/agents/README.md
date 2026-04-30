# @reaatech/circuit-breaker-agents

Meta-package for circuit-breaker-agents. Re-exports all public APIs from `@reaatech/circuit-breaker-core` and `@reaatech/circuit-breaker-persistence` in a single install.

## Feature Overview

- **Single import** — one dependency pulls in core circuit breaker logic, all persistence adapters, and leader election
- **Re-exports everything** — `CircuitBreaker`, `StateMachine`, all strategies, all adapters, all error classes, all types
- **Backward compatible** — drop-in replacement for `@reaatech/circuit-breaker-core` with persistence included
- **No additional dependencies** — only depends on `@reaatech/circuit-breaker-core` and `@reaatech/circuit-breaker-persistence`

## What's Included

This package re-exports every public export from both sub-packages:

**From `@reaatech/circuit-breaker-core`:**
- Classes: `CircuitBreaker`, `StateMachine`
- Errors: `CircuitBreakerError`, `CircuitOpenError`, `CircuitTimeoutError`
- Strategies: `ErrorThresholdStrategy`, `ConfidenceThresholdStrategy`, `CostThresholdStrategy`, `GradualRecoveryStrategy`, `SingleRecoveryStrategy`
- Metrics: `DefaultMetricsCollector`, `NoOpMetricsCollector`
- Schema: `CircuitBreakerStateSchema`
- Types: `CircuitBreakerOptions`, `ExecutionContext`, `CircuitState`, `CircuitBreakerState`, `CircuitBreakerStats`, `ResultMetadata`, `CircuitEventType`, `CircuitEvent`, `EventHandler`, `TripStrategy`, `RecoveryStrategy`, `MetricsCollector`

**From `@reaatech/circuit-breaker-persistence`:**
- Adapters: `InMemoryAdapter`, `FirestoreAdapter`, `DynamoDBAdapter`, `RedisAdapter`
- Leader election: `LeaderElection`, `MemoryLeaderElection`
- Types: `PersistenceAdapter`, `HealthStatus`, `LeadershipResult`

## Usage

```typescript
import {
  CircuitBreaker,
  CircuitOpenError,
  InMemoryAdapter,
  FirestoreAdapter,
  DefaultMetricsCollector,
} from '@reaatech/circuit-breaker-agents';

// Core usage — identical to @reaatech/circuit-breaker-core
const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  persistence: new InMemoryAdapter(),
});

// With persistence adapter
import { Firestore } from '@google-cloud/firestore';

const adapter = new FirestoreAdapter(
  new Firestore({ projectId: 'my-project' }),
  'circuit_breakers'
);
await adapter.connect();

const persisted = new CircuitBreaker({
  name: 'openai-gpt4',
  persistence: adapter,
});

// State survives restarts — loaded lazily on first execute()
const result = await persisted.execute(() => callTool());
```

## Installation

```bash
pnpm add @reaatech/circuit-breaker-agents
# or: npm install @reaatech/circuit-breaker-agents

# Optional peer dependencies for persistence:
pnpm add @google-cloud/firestore                  # Firestore
pnpm add @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb  # DynamoDB
pnpm add ioredis                                  # Redis
```

## For Zero-Dependency Footprint

If you only need the core circuit breaker without persistence adapters, install just the core package:

```bash
pnpm add @reaatech/circuit-breaker-core
```

Both packages share the same `CircuitBreaker` API — the persistence adapter is an optional constructor option.
