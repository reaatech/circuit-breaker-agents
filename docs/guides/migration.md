# Migration Guide

## From opossum / cockatiel

Standard circuit breaker libraries key by **hostname**. This library keys by **circuit ID** (agent or tool name).

| Feature | opossum | circuit-breaker-agents |
|---------|---------|------------------------|
| Key | Hostname / URL | `circuitId` (agent or tool) |
| Confidence tripping | Not supported | Built-in |
| Cost tripping | Not supported | Built-in |
| Gradual recovery | Not supported | Exponential ramp-up |
| Persistence | Optional plugins | First-class adapters |

### Before (opossum)

```typescript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(callAgent, {
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

const result = await breaker.fire();
```

### After

```typescript
import { CircuitBreaker } from '@reaatech/circuit-breaker-agents';

const breaker = new CircuitBreaker({
  name: 'my-agent',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
});

const result = await breaker.execute(() => callAgent());
```

## From ask-gm (functional API)

ask-gm uses separate functions for allow/check and record.

### Before (ask-gm)

```typescript
if (shouldAllowRequest(agentId)) {
  try {
    const result = await callAgent();
    recordSuccess(agentId);
  } catch (err) {
    recordFailure(agentId, err);
  }
}
```

### After

```typescript
const result = await breaker.execute(() => callAgent());
```

Key differences:
- **Auto-transition**: `getState()` handles OPEN→HALF_OPEN lazily; no manual timer management
- **Completed-call tracking**: HALF_OPEN tracks completed calls, not started calls
- **Fencing tokens**: Leader election uses atomic increments, not in-memory counters

## From agent-mesh

agent-mesh uses a singleton with separate persistence. This library is similar but adds:

- **Per-tool granularity**: `circuitId` can be `{agent}:{tool}`
- **Confidence/cost tracking**: Built-in strategies
- **Gradual recovery**: 1, 2, 4, 8… instead of fixed test calls
