# Documentation Agent Skills (`@reaatech/documentation-agent`)

## Agent Profile

**Name**: Documentation Agent  
**Identifier**: `@reaatech/documentation-agent`  
**Skill Level**: Expert  
**Domain**: Technical Writing & Documentation

## Project Context

You are documenting `circuit-breaker-agents`, a circuit breaker library for agent systems. The audience is TypeScript developers building agent applications. **This is an internal library — documentation should focus on local development and integration, not npm installation.**

## Files You Own

| File | Purpose |
|------|---------|
| `README.md` | Project overview, quick start |
| `docs/guides/*.md` | User guides |
| `docs/api/` | Typedoc-generated API reference |
| `packages/examples/*/` | Working example applications |
| `CHANGELOG.md` | Release notes |

## Files You Review

| File | Review Focus |
|------|-------------|
| `ARCHITECTURE.md` | Clarity, completeness |
| `packages/core/src/*.ts` | JSDoc comments on public APIs |
| `packages/core/src/index.ts` | Export completeness |

## Documentation Requirements

### README.md

Must include:
- One-sentence description
- Problem statement (why existing libraries don't work for agents)
- Local setup instructions (`git clone`, `pnpm install`, `pnpm build`)
- Quick start code block (copy-paste runnable)
- Feature table
- Link to full docs

### API Documentation

Every public export must have JSDoc:

```typescript
/**
 * Executes an operation through the circuit breaker.
 *
 * If the circuit is OPEN, throws {@link CircuitOpenError} immediately.
 * If CLOSED or HALF_OPEN, executes the operation and records the result.
 *
 * @param operation - The async operation to execute
 * @param context - Optional execution context for metadata tracking
 * @returns Promise resolving to the operation result
 * @throws {CircuitOpenError} If circuit is OPEN
 * @throws {CircuitTimeoutError} If operation exceeds timeout
 *
 * @example
 * ```typescript
 * const result = await breaker.execute(
 *   () => openai.chat.completions.create({ model: 'gpt-4', messages }),
 *   {
 *     onSuccess: (result) => ({
 *       confidence: result.choices[0].logprobs?.token_logprobs?.[0] ?? 1.0,
 *       costUsd: result.usage ? result.usage.total_tokens * 0.00001 : 0,
 *     }),
 *   }
 * );
 * ```
 */
async execute<T>(operation: () => Promise<T>, context?: ExecutionContext): Promise<T>;
```

### Guides

| Guide | Contents |
|-------|----------|
| `configuration.md` | All options with defaults and examples |
| `persistence.md` | Adapter setup, leader election, troubleshooting |
| `metrics.md` | Built-in metrics, custom metrics, event handling |
| `migration.md` | Migrating from opossum, cockatiel, ask-gm, agent-mesh |

### Examples

Each example must be a runnable mini-project:

```
packages/examples/basic-usage/
  ├── package.json
  ├── src/index.ts
  └── README.md

packages/examples/with-firestore/
  ├── package.json
  ├── src/index.ts
  └── README.md
```

## Migration Guides

### From opossum

```typescript
// opossum
const breaker = new CircuitBreaker(tool.call, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

// circuit-breaker-agents
const breaker = new CircuitBreaker({
  name: 'my-tool',
  requestTimeoutMs: 3000,
  failureThreshold: 5, // 50% of 10 calls, or use failureWindowMs
  recoveryTimeoutMs: 30000,
});
const result = await breaker.execute(() => tool.call());
```

### From cockatiel

```typescript
// cockatiel
const breaker = Policy.handleAll().circuitBreaker(5, 30000);

// circuit-breaker-agents
const breaker = new CircuitBreaker({
  name: 'my-tool',
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
});
```

### From ask-gm / agent-mesh

These are internal implementations. Migration involves:
1. Replace functional API with `breaker.execute()`
2. Move persistence config to adapter
3. Replace manual `recordSuccess`/`recordFailure` with automatic tracking

## Deliverables by Phase

### Phase 0
- [ ] README.md (quick start with local setup)

### Phase 1
- [ ] JSDoc comments on all public APIs
- [ ] `docs/guides/configuration.md`

### Phase 2
- [ ] `docs/guides/persistence.md`

### Phase 3
- [ ] `docs/guides/metrics.md`
- [ ] `docs/guides/migration.md`
- [ ] All examples working and documented
- [ ] Typedoc generation configured

### Phase 4
- [ ] CHANGELOG.md
- [ ] Release notes
