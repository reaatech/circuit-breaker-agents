# Metrics Guide

## Built-in Metrics

The `CircuitBreaker` automatically records metrics when `metricsEnabled` is `true` (default). You can also provide a custom `MetricsCollector`.

```typescript
import { CircuitBreaker } from 'circuit-breaker-agents';

const breaker = new CircuitBreaker({
  name: 'my-circuit',
  metricsEnabled: true,
});
```

### DefaultMetricsCollector

The default collector keeps in-memory counters:

```typescript
import { DefaultMetricsCollector } from 'circuit-breaker-agents';

const collector = new DefaultMetricsCollector();
const breaker = new CircuitBreaker({
  name: 'my-circuit',
  metricsCollector: collector,
});

// After some operations…
const counts = collector.getRequestCounts('my-circuit');
console.log(counts); // { success: 10, failure: 2, open: 1, timeout: 0 }

const changes = collector.getStateChanges();
console.log(changes); // [{ circuitId, from, to, time }]
```

### Custom MetricsCollector

Integrate with your observability stack:

```typescript
import type { MetricsCollector } from 'circuit-breaker-agents';

class PrometheusMetricsCollector implements MetricsCollector {
  recordRequest(circuitId: string, status: 'success' | 'failure' | 'open' | 'timeout') {
    requestsTotal.inc({ circuit_id: circuitId, status });
  }

  recordStateChange(circuitId: string, from: CircuitState, to: CircuitState) {
    stateTransitionsTotal.inc({ circuit_id: circuitId, from, to });
  }

  recordDuration(circuitId: string, durationMs: number) {
    requestDuration.observe({ circuit_id: circuitId }, durationMs);
  }

  recordConfidence(circuitId: string, confidence: number) {
    confidenceGauge.set({ circuit_id: circuitId }, confidence);
  }

  recordCost(circuitId: string, costUsd: number, tokens: number) {
    costTotal.inc({ circuit_id: circuitId }, costUsd);
    tokensTotal.inc({ circuit_id: circuitId }, tokens);
  }
}
```

## Events

For real-time dashboards, use the event emitter:

```typescript
breaker.on('stateChange', (event) => {
  console.log(`${event.circuit_id}: ${event.data.from} -> ${event.data.to}`);
});

breaker.on('success', (event) => {
  console.log(`${event.circuit_id}: success in ${event.data.duration}ms`);
});

breaker.on('failure', (event) => {
  console.log(`${event.circuit_id}: failed — ${event.data.error}`);
});

breaker.on('persistenceError', (event) => {
  console.error(`${event.circuit_id}: persistence failed — ${event.data.error}`);
});
```

## Disabling Metrics

```typescript
const breaker = new CircuitBreaker({
  name: 'my-circuit',
  metricsEnabled: false, // uses NoOpMetricsCollector
});
```
