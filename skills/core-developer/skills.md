# Core Developer Agent Skills (`@reaatech/core-developer-agent`)

## Agent Profile

**Name**: Core Developer Agent  
**Identifier**: `@reaatech/core-developer-agent`  
**Skill Level**: Expert  
**Domain**: Core Circuit Breaker Implementation

## Project Context

You are implementing the core circuit breaker logic for `circuit-breaker-agents`. This library extracts patterns from three production systems. Your code must be zero-dependency, race-condition-safe, and suitable for both Node.js and edge runtimes.

## Files You Own

| File | Purpose |
|------|---------|
| `packages/core/src/CircuitBreaker.ts` | Main circuit breaker class |
| `packages/core/src/CircuitBreakerError.ts` | Error types |
| `packages/core/src/StateMachine.ts` | State transition logic |
| `packages/core/src/strategies/*.ts` | Trip and recovery strategies |
| `packages/core/src/types/*.ts` | Type definitions and Zod schemas |
| `packages/core/src/metrics/MetricsCollector.ts` | Built-in metrics |
| `packages/core/src/index.ts` | Public exports |
| `packages/core/test/*.test.ts` | Unit tests |

## Reference Implementations

Study these files before implementing. They contain hard-won lessons:

1. **ask-gm** `../ask-gm/orchestrator-core/src/utils/circuitBreaker.ts`
   - Functional API (we're converting to class-based)
   - Leader election with fencing tokens (Persistence Agent handles this)
   - **Completed-call tracking in HALF_OPEN** — `halfOpenCompletedCalls` not `halfOpenCalls`
   - **Exponential backoff** — `RESET_TIMEOUT_MS * Math.min(backoffMultiplier, MAX_BACKOFF_MULTIPLIER)`
   - **Half-open timeout** — Force back to OPEN after 60s
   - **Cleanup of CLOSED circuits** from Firestore

2. **agent-mesh** `../agent-mesh/src/utils/circuitBreaker.ts`
   - **Auto-transition in `getState()`** — `elapsed >= recoveryTimeout * backoffMultiplier`
   - Clean separation: core has ZERO persistence knowledge
   - `canCall()` separate from `getState()`
   - `forceState()` for testing and manual intervention
   - Backoff multiplier caps at 32×

3. **agent-mesh** `../agent-mesh/src/types/domain.ts`
   - Zod schema for `CircuitBreakerState`
   - Type inference from schema

## Implementation Requirements

### State Machine

```typescript
// CRITICAL: Use lazy auto-transition in getState()
getState(circuitId: string): CircuitState {
  const state = this.getOrCreate(circuitId);
  
  if (state.state === 'OPEN') {
    const elapsed = Date.now() - state.lastStateChange;
    const effectiveTimeout = state.recoveryTimeout * state.backoffMultiplier;
    if (elapsed >= effectiveTimeout) {
      return this.transitionToHalfOpen(circuitId, state);
    }
  }
  
  if (state.state === 'HALF_OPEN') {
    const elapsed = Date.now() - state.lastStateChange;
    if (elapsed >= state.halfOpenTimeout) {
      return this.transitionToOpen(circuitId, state);
    }
  }
  
  return state.state;
}
```

### HALF_OPEN Completed-Call Tracking

```typescript
// WRONG (early ask-gm bug):
if (entry.halfOpenCalls < entry.halfOpenExpectedCalls) {
  entry.halfOpenCalls++; // Tracks STARTED calls — allows in-flight overrun
  return true;
}

// CORRECT:
if (entry.halfOpenCompletedCalls < entry.halfOpenExpectedCalls) {
  return true; // Allow the call
}
// ... later, in recordSuccess/recordFailure:
entry.halfOpenCompletedCalls++;
```

### Execute Method Signature

```typescript
async execute<T>(
  operation: () => Promise<T>,
  context?: ExecutionContext
): Promise<T>

interface ExecutionContext {
  circuitId?: string;
  onSuccess?: (result: unknown) => ResultMetadata;
  onFailure?: (error: unknown) => ResultMetadata;
  timeoutMs?: number;
  fallback?: () => Promise<unknown>;
}
```

### Race-Condition Safety

Node.js is single-threaded but async operations can interleave. Ensure:
- State reads/writes to the in-memory Map are atomic
- `getState()` + `recordSuccess()` sequences are safe
- No `await` between state check and state update in critical paths

## Code Style

- 2 spaces indentation
- Single quotes
- Semicolons always
- Trailing commas in multiline
- Explicit return types on public methods
- No `any` type

## Testing Requirements

- Unit tests for ALL 9 state transitions
- Unit tests for gradual recovery phases (1, 2, 4, 8, max)
- Unit tests for exponential backoff (verify multiplier doubles, caps)
- Unit tests for half-open timeout (force back to OPEN)
- Unit tests for event emission (all event types)
- Mock timers for time-based tests (`vi.useFakeTimers()`)

## Performance Targets

- State check: <1ms p50
- State transition: <10ms p99
- Memory per circuit: <1KB

## Deliverables by Phase

### Phase 0
- [ ] Read and document patterns from ask-gm and agent-mesh reference implementations

### Phase 1
- [ ] `packages/core/src/types/circuit.ts` — Zod schema + TS types
- [ ] `packages/core/src/types/config.ts` — Options interfaces
- [ ] `packages/core/src/types/events.ts` — Event types
- [ ] `packages/core/src/CircuitBreakerError.ts` — Error classes
- [ ] `packages/core/src/StateMachine.ts` — State transition logic
- [ ] `packages/core/src/strategies/*.ts` — Trip + recovery strategies
- [ ] `packages/core/src/CircuitBreaker.ts` — Main class
- [ ] `packages/core/src/index.ts` — Public exports
- [ ] Unit tests for all above

### Phase 3
- [ ] Review integration with persistence layer
- [ ] Review examples for API correctness
