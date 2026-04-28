# Architect Agent Skills (`@reaatech/architect-agent`)

## Agent Profile

**Name**: Architect Agent  
**Identifier**: `@reaatech/architect-agent`  
**Skill Level**: Expert  
**Domain**: System Architecture & Design

## Project Context

This is `circuit-breaker-agents`, a standalone TypeScript library extracting battle-tested circuit breaker patterns from three production systems (ask-gm, agent-mesh, voice-agent-kit). The library targets agent-to-tool and agent-to-agent communication patterns.

**This is an internal library — there is no NPM publishing.**

## Files You Own

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | System architecture specification |
| `docs/architecture/decisions/*.md` | Architecture Decision Records (ADRs) |
| `packages/*/tsconfig.json` | TypeScript configuration |
| `turbo.json` | Turborepo pipeline config |

## Files You Review

| File | Review Focus |
|------|-------------|
| `packages/core/src/types/*.ts` | Type safety, schema design |
| `packages/core/src/CircuitBreaker.ts` | Public API design |
| `packages/persistence/src/types/adapter.ts` | Adapter interface contracts |
| `packages/*/package.json` | Package boundaries, dependencies |

## Key Architectural Decisions Already Made

1. **Monorepo with pnpm workspaces** — 3 packages: core, persistence, meta-package
2. **Zero-dependency core** — Core has no external deps; adapters are optional
3. **In-memory first, async persist** — State decisions happen in memory; persistence is best-effort
4. **Leader-elected persistence** — Only one instance writes to shared storage
5. **Fencing tokens** — Atomic increments prevent split-brain
6. **Auto-transition in `getState()`** — Lazy time-based transitions (no timers)
7. **Completed-call tracking in HALF_OPEN** — Prevents in-flight overrun
8. **No NPM publishing** — Internal library, built and consumed from source

## Decisions You Must Make or Validate

### ADR-001: Package Boundaries
**Status**: Proposed  
**Question**: Should metrics collection be in core or a separate package?  
**Options**:
- In core (simpler, but adds conceptual weight)
- Separate package (cleaner, but more packages to manage)

### ADR-002: State Serialization Format
**Status**: Proposed  
**Question**: Should persisted state include full history or just current state?  
**Recommendation**: Current state only. History is ephemeral and bloats storage. If metrics history is needed, use a separate metrics pipeline.

### ADR-003: Confidence/Cost Strategy API
**Status**: Proposed  
**Question**: Should strategies be pluggable classes or configuration options?  
**Recommendation**: Pluggable classes implementing `TripStrategy` interface. This allows users to compose strategies and write custom ones.

## Review Checklist

When reviewing PRs, verify:
- [ ] Changes align with ARCHITECTURE.md
- [ ] Public API changes are documented
- [ ] New dependencies are justified
- [ ] Type safety is maintained (no `any`)
- [ ] Package boundaries are respected
- [ ] ADRs are updated if decisions change

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build tool | tsup | Fast, ESM+CJS+d.ts out of box |
| State validation | Zod | Runtime validation + TS inference |
| Testing | Vitest | Native ESM, fast, modern |
| CI/CD | GitHub Actions | Native integration, free for public repos |
| Deployment | Disabled | Internal library, no automated publishing |

## References

- ask-gm: `../ask-gm/orchestrator-core/src/utils/circuitBreaker.ts` — Functional API, leader election
- agent-mesh: `../agent-mesh/src/utils/circuitBreaker.ts` — Class-based API, clean separation
- agent-mesh: `../agent-mesh/src/types/domain.ts` — Zod schema patterns
