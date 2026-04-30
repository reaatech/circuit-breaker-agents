# Circuit Breaker Agents

[![CI](https://github.com/reaatech/circuit-breaker-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/reaatech/circuit-breaker-agents/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

> A TypeScript circuit breaker library built for agent-to-tool and agent-to-agent communication patterns.

Unlike traditional circuit breakers (opossum, cockatiel), this library supports **per-tool circuit isolation**, **confidence-aware tripping**, **cost-based rate limiting**, **gradual recovery** with exponential ramp-up, and optional **persistence** across restarts via Firestore, DynamoDB, or Redis.

Extracted from battle-tested production implementations at [REA Technologies](https://reaatech.com).

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [Packages](#packages)
- [Core Concepts](#core-concepts)
  - [Circuit Identity](#circuit-identity)
  - [State Machine](#state-machine)
  - [Trip Strategies](#trip-strategies)
  - [Recovery Strategies](#recovery-strategies)
- [Usage](#usage)
  - [Confidence &amp; Cost Tracking](#confidence--cost-tracking)
  - [Fallback Routing](#fallback-routing)
  - [Force Route (Bypass)](#force-route-bypass)
  - [Inspecting State &amp; Stats](#inspecting-state--stats)
  - [Manual Control](#manual-control)
- [Persistence](#persistence)
- [Events &amp; Metrics](#events--metrics)
- [Architecture](#architecture)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
# pnpm (recommended)
pnpm add @reaatech/circuit-breaker-agents

# npm
npm install @reaatech/circuit-breaker-agents

# yarn
yarn add @reaatech/circuit-breaker-agents
```

`@reaatech/circuit-breaker-agents` is a meta-package that re-exports everything from the core and persistence packages. For a zero-dependency footprint, install just the core:

```bash
pnpm add @reaatech/circuit-breaker-core
```

Persistence adapters require their peer dependencies installed alongside:

```bash
pnpm add @reaatech/circuit-breaker-agents @google-cloud/firestore             # Firestore
pnpm add @reaatech/circuit-breaker-agents @aws-sdk/client-dynamodb \
  @aws-sdk/util-dynamodb                                            # DynamoDB
pnpm add @reaatech/circuit-breaker-agents ioredis                             # Redis
```

## Quick Start

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-agents';

const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  minConfidence: 0.7,
  maxCostPerMinute: 0.50,
  recoveryStrategy: 'gradual',
});

const result = await breaker.execute(
  () => openai.chat.completions.create({ model: 'gpt-4', messages }),
  {
    onSuccess: (response) => ({
      confidence: computeConfidence(response),
      costUsd: estimateCost(response),
    }),
  }
);
```

When a circuit is open, `execute()` throws `CircuitOpenError`. Provide a fallback to fail gracefully:

```typescript
const result = await breaker.execute(
  () => primaryModel.call(prompt),
  {
    fallback: () => cheaperModel.call(prompt),
  }
);
```

## Features

| Feature | Description |
|---------|-------------|
| **Per-tool isolation** | Independent circuit state per tool/agent ID, not just per hostname |
| **Confidence-aware tripping** | Trip when average response confidence falls below a configurable threshold |
| **Cost-aware tripping** | Trip when token cost or burn rate exceeds budget limits |
| **Gradual recovery** | Exponential ramp-up in HALF_OPEN: 1, 2, 4, 8... test calls |
| **Fallback routing** | Route to a fallback tool when the primary circuit is OPEN |
| **Force route** | Bypass circuit checks for critical one-off calls |
| **Leader-elected persistence** | Single-writer persistence prevents storage quota exhaustion |
| **Fencing tokens** | Atomic versioning prevents split-brain during network partitions |
| **Zero-dependency core** | Core package depends only on `zod`; all adapters are optional |
| **Full TypeScript** | Strict mode, first-class types, Zod runtime validation on deserialization |

## Packages

| Package | Description | Runtime Deps |
|---------|-------------|--------------|
| `@reaatech/circuit-breaker-agents` | Meta-package — re-exports all of core + persistence | core, persistence |
| `@reaatech/circuit-breaker-core` | Core circuit breaker, state machine, strategies, metrics, types | zod |
| `@reaatech/circuit-breaker-persistence` | Firestore, DynamoDB, Redis, and in-memory adapters | core, peer deps optional |

All three packages ship ESM and CJS bundles with TypeScript declarations.

## Core Concepts

### Circuit Identity

A circuit is uniquely identified by a `circuitId` string. The library does not enforce a naming convention, but the recommended pattern follows agent-to-tool relationships:

```
{agentId}:{toolId}
```

| Granularity | Example `circuitId` | Use Case |
|-------------|---------------------|----------|
| Per-agent | `openai-gpt4` | One breaker per agent endpoint |
| Per-tool | `openai-gpt4:web-search` | One breaker per tool within an agent |
| Per-tool per-region | `openai-gpt4:web-search:us-east1` | Regional tool quality tracking |

When no `circuitId` is passed to `execute()`, the breaker's `name` option is used.

### State Machine

```
      ┌─────────┐
      │         │
      ▼         │
  ┌──────┐  failures  ┌──────┐  timeout  ┌───────────┐
  │CLOSED├───────────►│ OPEN ├──────────►│ HALF_OPEN │
  └──┬───┘            └──┬───┘            └─────┬─────┘
     │                   │                      │
     │   success         │      success         │
     └───────────────────┘   (threshold met)    │
                                      ◄─────────┘
```

- **CLOSED** — Normal operation. Requests pass through and results are tracked for trip evaluation.
- **OPEN** — Failures exceeded threshold or confidence/cost budget blown. Requests are rejected immediately with `CircuitOpenError`.
- **HALF_OPEN** — Recovery window after timeout. A limited, exponentially-growing number of test requests are allowed through to verify recovery.

All transitions are evaluated lazily on each call to `getState()` or `execute()` — no internal timers.

### Trip Strategies

Three built-in strategies evaluate whether a circuit should trip. They can be stacked (any one tripping opens the circuit).

| Strategy | Trips when | Configuration |
|----------|------------|---------------|
| `ErrorThresholdStrategy` | Failure count exceeds threshold within a rolling window | `failureThreshold`, `failureWindowMs` |
| `ConfidenceThresholdStrategy` | Average response confidence drops below minimum | `minConfidence`, `confidenceWindowMs` |
| `CostThresholdStrategy` | Cost-per-minute exceeds budget or tokens-per-call too high | `maxCostPerMinute`, `maxTokensPerCall`, `costWindowMs` |

### Recovery Strategies

Two recovery modes control HALF_OPEN behavior:

| Strategy | Behavior |
|----------|----------|
| **Gradual** (default) | Exponential ramp-up: 1, 2, 4, 8, 16 test calls. Each failed HALF_OPEN cycle doubles the backoff multiplier (capped at `maxBackoffMultiplier` × base timeout). |
| **Single** | All-or-nothing: one test call decides whether the circuit closes or re-opens. |

## Usage

### Confidence &amp; Cost Tracking

Report result metadata on every call to enable intelligent tripping:

```typescript
await breaker.execute(
  () => callTool(),
  {
    onSuccess: (result) => ({
      confidence: result.score,
      costUsd: result.price,
      tokens: result.tokens,
      latencyMs: result.duration,
    }),
    onFailure: (error) => ({
      error: true,
    }),
  }
);
```

### Fallback Routing

Provide a fallback function that runs transparently when the circuit is OPEN:

```typescript
const result = await breaker.execute(
  () => primaryModel.call(prompt),
  {
    fallback: () => cheaperModel.call(prompt),
  }
);
// No exception thrown — the caller sees a normal result.
```

### Force Route (Bypass)

Bypass circuit state checks for critical calls that must go through:

```typescript
const result = await breaker.execute(
  () => criticalOneOff(),
  { forceRoute: true }
);
```

### Inspecting State &amp; Stats

```typescript
const state = breaker.getState('openai-gpt4');
// 'CLOSED' | 'OPEN' | 'HALF_OPEN'

const stats = breaker.getStats('openai-gpt4');
// CircuitBreakerStats {
//   circuit_id, state, failure_count, success_count,
//   half_open_expected_calls, half_open_completed_calls,
//   half_open_in_flight_calls, backoff_multiplier,
//   total_calls, total_failures, total_successes,
//   last_failure_time, last_state_change, version
// }
```

### Manual Control

```typescript
breaker.reset('openai-gpt4');       // Reset to CLOSED, clear all counters
breaker.forceState('openai-gpt4', 'HALF_OPEN');  // Force into a specific state
breaker.evict('openai-gpt4');       // Remove circuit from registry + persistence
```

## Persistence

Persist circuit state across restarts with one of the built-in adapters.

### Firestore

```typescript
import { CircuitBreaker, FirestoreAdapter } from '@reaatech/circuit-breaker-agents';
import { Firestore } from '@google-cloud/firestore';

const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  persistence: new FirestoreAdapter(
    new Firestore({ projectId: 'my-project' }),
    'circuit_breakers'
  ),
});
```

### DynamoDB

```typescript
import { DynamoDBAdapter } from '@reaatech/circuit-breaker-agents';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const adapter = new DynamoDBAdapter(
  new DynamoDBClient({ region: 'us-east-1' }),
  'circuit_breakers'
);
await adapter.connect();
```

### Redis

```typescript
import { RedisAdapter } from '@reaatech/circuit-breaker-agents';
import Redis from 'ioredis';

const adapter = new RedisAdapter(
  new Redis({ host: 'localhost', port: 6379 }),
  'cb:'  // key prefix
);
```

### Leader Election

All production adapters implement leader election with fencing tokens to prevent split-brain scenarios. Only the elected leader writes circuit state to shared storage, preventing write amplification when many instances share a database.

For single-instance or testing scenarios, `MemoryLeaderElection` provides in-process election.

### Custom Adapters

Implement the `PersistenceAdapter` interface to add support for any storage backend:

```typescript
interface PersistenceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  saveState(state: CircuitBreakerState): Promise<void>;
  loadState(circuitId: string): Promise<CircuitBreakerState | null>;
  deleteState(circuitId: string): Promise<void>;
  tryAcquireLeadership?(instanceId: string, leaseMs: number): Promise<LeadershipResult>;
  releaseLeadership?(instanceId: string): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}
```

See [docs/guides/persistence.md](./docs/guides/persistence.md) for full configuration details.

## Events &amp; Metrics

### Lifecycle Events

Hook into the circuit breaker lifecycle using the event emitter:

```typescript
breaker.on('stateChange', (event) => {
  // event: { type, circuit_id, timestamp, data: { from, to } }
  logger.info(`${event.circuit_id}: ${event.data.from} → ${event.data.to}`);
});

breaker.on('failure', (event) => {
  logger.warn('Circuit failure', event);
});

breaker.on('persistenceError', (event) => {
  logger.error('Persistence write failed', event);
});

// Event types: stateChange | success | failure | timeout | persistenceError | callbackError
```

### Metrics Collection

Pass a `MetricsCollector` implementation to integrate with your observability stack:

```typescript
import { CircuitBreaker, DefaultMetricsCollector } from '@reaatech/circuit-breaker-agents';

const metrics = new DefaultMetricsCollector();

const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  metricsCollector: metrics,
});

// After executions...
metrics.getRequestCounts('openai-gpt4');
metrics.getDurations('openai-gpt4');
metrics.getStateChanges('openai-gpt4');
metrics.getConfidenceReadings('openai-gpt4');
metrics.getCostReadings('openai-gpt4');
```

Set `metricsEnabled: false` to disable collection, or implement `MetricsCollector` for custom backends (Prometheus, DataDog, etc.). See [docs/guides/metrics.md](./docs/guides/metrics.md) for details.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical specification, including:

- State machine design with lazy auto-transition and completed-call tracking
- Exponential backoff with configurable multiplier cap
- Leader election with fencing tokens for split-brain safety
- Zod-validated state serialization and deserialization
- Package boundaries, dependency rules, and adapter contracts

Architecture Decision Records are in [`docs/architecture/decisions/`](./docs/architecture/decisions/).

## Development

```bash
pnpm install           # Install dependencies
pnpm build             # Build all packages (turbo)
pnpm test              # Run tests
pnpm test:coverage     # Run tests with coverage
pnpm lint              # ESLint
pnpm type-check        # TypeScript strict mode check
pnpm check             # All checks: lint + type-check + test
```

Requires **Node.js 18+** and **pnpm 8+**.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on development setup, coding standards, conventional commits, and the pull request process.

## License

[MIT](./LICENSE) — Copyright (c) 2024 REA Technologies
