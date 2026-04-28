# ADR-004: Leader Election Pattern

## Status
Accepted

## Context
In multi-instance deployments, all instances syncing state to Firestore simultaneously exhausts write quotas within minutes (observed in ask-gm production). We needed a pattern where only one instance writes, with safe handoff during restarts.

## Decision
Implement **lease-based leader election with fencing tokens**:

1. Each instance has a unique ID (prefer `HOSTNAME` over `K_REVISION`).
2. Instances periodically call `tryAcquireLeadership(instanceId, leaseMs)` on the adapter.
3. The adapter atomically checks the lease expiry; if expired or held by the same instance, it increments a fencing token and grants leadership.
4. Before each write, the leader verifies its fencing token matches the stored value.
5. On graceful shutdown, the leader calls `releaseLeadership()`.

```typescript
interface LeadershipResult {
  isLeader: boolean;
  fencingToken: number;
}
```

## Consequences
- **Quota safe**: Writes are reduced from N× to 1× (where N = instance count).
- **Split-brain safe**: Fencing tokens prevent stale leaders from writing after partition heals.
- **Complexity**: Each adapter must implement atomic compare-and-set logic.

## Compliance
- `MemoryLeaderElection` tests verify lease expiry, renewal, and fencing token increments.
- Adapter tests verify that a second instance cannot steal leadership while the lease is valid.

## Owner
Persistence
