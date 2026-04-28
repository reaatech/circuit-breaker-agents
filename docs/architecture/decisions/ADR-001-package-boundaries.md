# ADR-001: Package Boundaries

## Status
Accepted

## Context
We needed a clean separation between core circuit breaker logic (which must be zero-dependency and fast) and optional persistence adapters (which have heavy external dependencies like Firestore, DynamoDB, and Redis).

## Decision
Split the library into three packages:

1. **`circuit-breaker-core`** — Zero-dependency core logic. Owns `CircuitBreaker`, `StateMachine`, strategies, types, and metrics interfaces.
2. **`circuit-breaker-persistence`** — Optional persistence adapters. Peer-dependencies on `@google-cloud/firestore`, `@aws-sdk/client-dynamodb`, `ioredis`. Depends on `circuit-breaker-core`.
3. **`circuit-breaker-agents`** — Meta-package that re-exports core + persistence for convenience.

## Consequences
- **Easier testing**: Core can be tested without mocking Firestore/DynamoDB/Redis.
- **Smaller bundles**: Consumers who only need in-memory breakers don't install persistence deps.
- **Clear ownership**: Core Developer owns core; Persistence Agent owns adapters.

## Compliance
- `packages/core/package.json` has no runtime dependencies (except `zod` for validation).
- `packages/persistence/package.json` marks all storage clients as optional peer dependencies.

## Owner
Architect
