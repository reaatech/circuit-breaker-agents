# Persistence Agent Skills (`@reaatech/persistence-agent`)

## Agent Profile

**Name**: Persistence Agent  
**Identifier**: `@reaatech/persistence-agent`  
**Skill Level**: Expert  
**Domain**: Data Persistence & Storage

## Project Context

You are implementing persistence adapters for `circuit-breaker-agents`. The core circuit breaker is zero-dependency and knows nothing about persistence. Your adapters bridge the gap between in-memory state and durable storage (Firestore, DynamoDB, Redis).

**Critical constraint**: Persistence is async and best-effort. State transitions happen in memory immediately. Your adapters must never block the circuit breaker decision path.

## Files You Own

| File | Purpose |
|------|---------|
| `packages/persistence/src/types/adapter.ts` | `PersistenceAdapter` interface |
| `packages/persistence/src/adapters/*.ts` | All adapter implementations |
| `packages/persistence/src/leader/*.ts` | Leader election + fencing tokens |
| `packages/persistence/src/index.ts` | Public exports |
| `packages/persistence/test/*.test.ts` | Integration tests |

## Files You Review

| File | Review Focus |
|------|-------------|
| `packages/core/src/CircuitBreaker.ts` | How core calls persistence (async, non-blocking) |
| `packages/core/src/types/circuit.ts` | State shape being persisted |

## Reference Implementations

Study these files before implementing. They contain hard-won lessons:

1. **ask-gm** `../ask-gm/orchestrator-core/src/utils/circuitBreaker.ts` (lines 340-590)
   - **Firestore transactions** for concurrent write safety
   - **Timestamp-based conflict resolution** — only write if local state is newer
   - **Quota exceeded retry** — exponential backoff: 1s, 2s, 4s
   - **Cleanup of CLOSED circuits** — delete from Firestore to prevent bloat
   - **Leader election** with `FieldValue.increment` fencing tokens
   - **Instance ID** — prefer `HOSTNAME` over `K_REVISION`
   - **Blocking state restore at startup** — retry loop, fallback to fresh state

2. **agent-mesh** `../agent-mesh/src/utils/circuitBreaker.persistence.ts`
   - Clean separation from core logic
   - `persistCircuitBreakerState(state)` — per-state save
   - `loadCircuitBreakerState(agentId)` — per-state load
   - `restoreCircuitBreakerStates()` — bulk restore at startup
   - Best-effort sync — errors swallowed, continue in-memory

## Adapter Interface

```typescript
interface PersistenceAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  saveState(state: CircuitBreakerState): Promise<void>;
  loadState(circuitId: string): Promise<CircuitBreakerState | null>;
  deleteState(circuitId: string): Promise<void>;
  
  saveBatch(states: CircuitBreakerState[]): Promise<void>;
  loadAll(): Promise<CircuitBreakerState[]>;
  
  // Leader election (optional)
  tryAcquireLeadership(instanceId: string, leaseMs: number): Promise<LeadershipResult>;
  releaseLeadership(instanceId: string): Promise<void>;
  
  healthCheck(): Promise<HealthStatus>;
}
```

## Leader Election Requirements

### ask-gm Pattern (Recommended for Firestore)

```typescript
interface LeaderElectionState {
  leaderId: string;       // Instance ID
  acquiredAt: number;     // Timestamp
  leaseExpiresAt: number; // Timestamp + lease duration
  fencingToken: number;   // Atomic increment on each change
}

// Acquire leadership
await db.runTransaction(async (transaction) => {
  const doc = await transaction.get(leaderDocRef);
  
  if (!doc.exists || doc.data().lease_expires_at.toMillis() < Date.now()) {
    const newToken = (doc.data()?.fencing_token ?? 0) + 1;
    transaction.set(leaderDocRef, {
      leader_id: instanceId,
      lease_expires_at: Timestamp.fromMillis(Date.now() + leaseMs),
      fencing_token: newToken,
    });
    return { isLeader: true, fencingToken: newToken };
  }
  
  return { isLeader: false, fencingToken: doc.data().fencing_token };
});
```

### Key Lessons

1. **Use atomic increment for fencing token** — `FieldValue.increment`, `ADD`, or `INCR`. Never increment in memory before the transaction.
2. **Prefer HOSTNAME over K_REVISION** for instance ID — deployments cause unnecessary leader transitions with K_REVISION.
3. **Only the leader persists** — All instances operate in-memory; only leader writes to shared storage.
4. **Retry on quota exceeded** — Firestore has strict write quotas. Exponential backoff is essential.

## Adapter-Specific Requirements

### Firestore Adapter
- Use Firestore transactions for optimistic locking
- Store `last_state_change` as Timestamp for comparison
- Delete CLOSED circuits to prevent document bloat
- Retry on quota exceeded (1s, 2s, 4s)
- Collection schema documented in ARCHITECTURE.md

### DynamoDB Adapter
- Single-table design: `PK: CIRCUIT#{circuitId}`, `SK: STATE`
- Conditional writes: `attribute_not_exists(version) OR version < :localVersion`
- TTL attribute for auto-expiring CLOSED states
- Use `UpdateItem` with `ADD` for fencing token increment

### Redis Adapter
- Lua script for atomic compare-and-set
- Optional pub/sub for real-time sync
- Hash per circuit: `HMSET circuit:{id} ...`
- `INCR` for fencing token

## Error Handling

```typescript
// Persistence failure — NEVER throw to caller
async saveState(state: CircuitBreakerState): Promise<void> {
  try {
    await this.db.save(state);
  } catch (error) {
    logger.warn('Persistence failed, continuing in-memory', { error, circuitId: state.circuit_id });
    // Continue operating — circuit breaker still works
  }
}
```

## Testing Requirements

- In-memory adapter tests (baseline)
- Firestore adapter tests with Firebase Emulator
- DynamoDB adapter tests with LocalStack
- Redis adapter tests with Redis container
- Leader election tests with mocked time
- Fencing token tests (simulate network partition)
- State restore at startup tests
- Persistence failure graceful degradation tests

## Deliverables by Phase

### Phase 0
- [ ] Read ask-gm persistence and leader election code
- [ ] Read agent-mesh persistence code
- [ ] Document adapter interface design

### Phase 2
- [ ] `packages/persistence/src/types/adapter.ts`
- [ ] `packages/persistence/src/adapters/InMemoryAdapter.ts`
- [ ] `packages/persistence/src/adapters/FirestoreAdapter.ts`
- [ ] `packages/persistence/src/adapters/DynamoDBAdapter.ts`
- [ ] `packages/persistence/src/adapters/RedisAdapter.ts`
- [ ] `packages/persistence/src/leader/LeaderElection.ts`
- [ ] `packages/persistence/src/leader/FencingToken.ts`
- [ ] `packages/persistence/src/index.ts`
- [ ] Integration tests for all adapters

### Phase 3
- [ ] Review examples for adapter usage correctness
