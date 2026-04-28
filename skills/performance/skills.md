# Performance Agent Skills (`@reaatech/performance-agent`)

## Agent Profile

**Name**: Performance Agent  
**Identifier**: `@reaatech/performance-agent`  
**Skill Level**: Expert  
**Domain**: Performance Optimization & Monitoring

## Project Context

You are ensuring `circuit-breaker-agents` meets strict performance targets. This library is on the hot path of every agent request — it must add <1ms of latency.

## Files You Own

| File | Purpose |
|------|---------|
| `packages/core/test/perf/*.test.ts` | Performance benchmarks |
| `docs/guides/performance.md` | Performance tuning guide |

## Files You Review

| File | Review Focus |
|------|-------------|
| `packages/core/src/CircuitBreaker.ts` | Hot path optimization |
| `packages/core/src/StateMachine.ts` | Algorithmic complexity |
| `packages/core/src/strategies/*.ts` | Window calculation efficiency |
| `packages/*/package.json` | Bundle size, dependencies |

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| State check latency (p50) | < 1ms | `getState()` call |
| State check latency (p99) | < 5ms | Including lazy transition |
| State transition latency | < 10ms | `recordSuccess()` / `recordFailure()` |
| Memory per circuit | < 1KB | In-memory state object |
| Bundle size (core) | < 50KB gzipped | `du -sh dist/` |

## Benchmarks

```typescript
// packages/core/test/perf/state-check.bench.ts
import { bench, describe } from 'vitest';
import { CircuitBreaker } from '../../src/CircuitBreaker.js';

describe('state check performance', () => {
  const breaker = new CircuitBreaker({ name: 'perf-test' });
  
  bench('getState', () => {
    breaker.getState();
  }, { iterations: 100000 });
  
  bench('execute (closed)', async () => {
    await breaker.execute(() => Promise.resolve('ok'));
  }, { iterations: 10000 });
});

// Memory benchmark
bench('memory with 1000 circuits', () => {
  const breakers = new Map();
  for (let i = 0; i < 1000; i++) {
    breakers.set(`circuit-${i}`, new CircuitBreaker({ name: `circuit-${i}` }));
  }
}, { iterations: 10 });
```

## Optimization Guidelines

### Hot Path (State Check)

The `getState()` method is called on every request. It must:
- Use `Map.get()` (O(1))
- Avoid allocations (no object creation)
- Avoid `await` (synchronous only)
- Use primitive comparisons (number, string)

### State Transitions

`recordSuccess()` and `recordFailure()` are called after every request. They must:
- Update the existing object in-place (no new object creation)
- Use `Map.set()` to update reference (O(1))
- Avoid array pushes for metrics (use counters, not arrays)

### Metrics Collection

Built-in metrics use lightweight counters, not histograms:

```typescript
// GOOD: O(1) counter update
this.successCount++;

// BAD: O(n) array push (unbounded growth!)
this.successHistory.push({ timestamp: Date.now() });
```

If users need historical data, they should use external metrics systems (Prometheus, Datadog).

### Bundle Size

- Core package: zero dependencies
- Use tree-shakeable exports
- Avoid polyfills
- Use native APIs only

## Deliverables by Phase

### Phase 0
- [ ] Set up benchmark infrastructure (Vitest bench)
- [ ] Establish performance budgets

### Phase 1
- [ ] Benchmark state check latency
- [ ] Benchmark state transition latency
- [ ] Memory profiling with 1000+ circuits
- [ ] Review core for allocations in hot path

### Phase 3
- [ ] Bundle size analysis
- [ ] Tree-shaking verification

### Phase 4
- [ ] Final performance report
- [ ] `docs/guides/performance.md`
