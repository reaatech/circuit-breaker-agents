# Testing Agent Skills (`@reaatech/testing-agent`)

## Agent Profile

**Name**: Testing Agent  
**Identifier**: `@reaatech/testing-agent`  
**Skill Level**: Expert  
**Domain**: Quality Assurance & Testing

## Project Context

You are responsible for ensuring `circuit-breaker-agents` is thoroughly tested before release. This library implements the circuit breaker pattern for agent systems — correctness is critical because bugs here cause cascading failures in production.

## Files You Own

| File | Purpose |
|------|---------|
| `packages/core/test/*.test.ts` | Core unit tests |
| `packages/persistence/test/*.test.ts` | Persistence integration tests |
| `packages/core/test/fixtures/*.ts` | Test fixtures and factories |
| `packages/persistence/test/fixtures/*.ts` | Test fixtures and factories |

## Files You Review

| File | Review Focus |
|------|-------------|
| `packages/core/src/*.ts` | Testability, edge cases |
| `packages/persistence/src/*.ts` | Error handling, failure modes |
| `packages/*/src/index.ts` | Public API completeness |

## Testing Philosophy

This library has three correctness properties that must be invariant:

1. **State machine correctness** — All 9 transitions must behave exactly as specified
2. **Race-condition safety** — State checks and updates must be atomic
3. **Graceful degradation** — Persistence failures must not break circuit breaker operation

## Test Requirements

### Unit Tests (packages/core/test/)

#### StateMachine.test.ts
```typescript
describe('StateMachine', () => {
  describe('transitions', () => {
    it('CLOSED -> OPEN after failure threshold');
    it('OPEN -> HALF_OPEN after recovery timeout');
    it('OPEN -> HALF_OPEN with backoff multiplier');
    it('HALF_OPEN -> CLOSED after all tests succeed');
    it('HALF_OPEN -> OPEN on any failure');
    it('HALF_OPEN -> OPEN after half-open timeout');
    it('HALF_OPEN allows exactly expected calls');
    it('HALF_OPEN tracks completed calls not started calls');
    it('manual reset -> CLOSED');
    it('forceState -> any state');
  });
  
  describe('exponential backoff', () => {
    it('doubles multiplier each OPEN->HALF_OPEN->OPEN cycle');
    it('caps at maxBackoffMultiplier');
    it('resets to 1 on transition to CLOSED');
  });
  
  describe('lazy transitions', () => {
    it('getState() transitions OPEN->HALF_OPEN when timeout elapsed');
    it('getState() does not transition before timeout');
    it('getState() transitions HALF_OPEN->OPEN when timeout elapsed');
  });
});
```

#### CircuitBreaker.test.ts
```typescript
describe('CircuitBreaker', () => {
  describe('execute', () => {
    it('executes operation when CLOSED');
    it('throws CircuitOpenError when OPEN');
    it('includes timeUntilRetry in CircuitOpenError');
    it('applies request timeout');
    it('calls fallback when OPEN and fallback provided');
    it('calls onSuccess metadata callback');
    it('calls onFailure metadata callback');
    it('records confidence from metadata');
    it('records cost from metadata');
  });
  
  describe('trip strategies', () => {
    it('trips on error threshold');
    it('trips on low confidence');
    it('trips on high cost');
    it('composite strategy trips if any strategy trips');
  });
  
  describe('events', () => {
    it('emits stateChange event');
    it('emits success event');
    it('emits failure event');
    it('emits recoveryComplete event');
    it('emits recoveryFailed event');
  });
});
```

### Integration Tests (packages/persistence/test/)

```typescript
describe('FirestoreAdapter', () => {
  it('saves and loads state');
  it('deletes CLOSED state');
  it('handles concurrent writes with optimistic locking');
  it('retries on quota exceeded');
  it('leader election acquires leadership');
  it('leader election respects lease expiry');
  it('fencing tokens prevent split-brain');
});

describe('DynamoDBAdapter', () => {
  it('saves and loads state');
  it('uses conditional writes for locking');
  it('TTL auto-expires old state');
});

describe('RedisAdapter', () => {
  it('saves and loads state');
  it('Lua script prevents stale writes');
  it('pub/sub syncs state across instances');
});
```

### Chaos Tests

```typescript
describe('Chaos', () => {
  it('continues operating when persistence fails');
  it('recovers when persistence reconnects');
  it('handles clock skew in leader election');
  it('handles rapid leader transitions');
  it('handles Firestore quota exhaustion');
});
```

## Testing Patterns

### Mock Timers

```typescript
import { vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('transitions after timeout', () => {
  const breaker = new CircuitBreaker({ recoveryTimeoutMs: 30000 });
  breaker.forceState('OPEN');
  
  expect(breaker.getState()).toBe('OPEN');
  
  vi.advanceTimersByTime(30000);
  
  expect(breaker.getState()).toBe('HALF_OPEN');
});
```

### Test Factories

```typescript
// packages/core/test/fixtures/circuit.ts
export function createCircuitState(overrides: Partial<CircuitBreakerState> = {}): CircuitBreakerState {
  return {
    circuit_id: 'test-circuit',
    state: 'CLOSED',
    failure_count: 0,
    success_count: 0,
    last_state_change: Date.now(),
    half_open_expected_calls: 0,
    half_open_completed_calls: 0,
    backoff_multiplier: 1,
    version: 1,
    ...overrides,
  };
}

export function openState(circuitId: string): CircuitBreakerState {
  return createCircuitState({
    circuit_id: circuitId,
    state: 'OPEN',
    failure_count: 5,
    last_failure_time: Date.now(),
  });
}
```

### Coverage Requirements

| Metric | Target |
|--------|--------|
| Line coverage (core) | >90% |
| Branch coverage (core) | >85% |
| Function coverage (core) | >95% |
| Line coverage (adapters) | >80% |

## Deliverables by Phase

### Phase 0
- [ ] Review reference implementation tests (ask-gm, agent-mesh)
- [ ] Set up Vitest configuration
- [ ] Create test directory structure
- [ ] Create test utilities and factories

### Phase 1
- [ ] `packages/core/test/StateMachine.test.ts`
- [ ] `packages/core/test/CircuitBreaker.test.ts`
- [ ] `packages/core/test/strategies/*.test.ts`
- [ ] `packages/core/test/CircuitBreakerError.test.ts`

### Phase 2
- [ ] `packages/persistence/test/adapters/*.test.ts`
- [ ] `packages/persistence/test/leader/*.test.ts`
- [ ] Chaos tests

### Phase 3
- [ ] End-to-end examples tested
- [ ] Performance benchmarks
- [ ] Coverage report review
