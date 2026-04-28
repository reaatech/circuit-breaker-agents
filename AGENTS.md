# Circuit Breaker Agents — Agent Collaboration System

## Overview

This project uses a multi-agent development system where specialized AI agents collaborate to build `circuit-breaker-agents`. Each agent has specific files they own, concrete deliverables per phase, and clear review responsibilities.

**How to use this file**: When an agent is invoked, they read their skill file (`skills/{agent}/skills.md`) for detailed instructions. This file provides the coordination layer — who owns what, how agents interact, and how decisions are tracked.

## Agent Directory

| Agent | Skill File | Primary Domain |
|-------|-----------|----------------|
| Architect | `skills/architect/skills.md` | Architecture & API design |
| Core Developer | `skills/core-developer/skills.md` | Core circuit breaker logic |
| Persistence | `skills/persistence/skills.md` | Persistence adapters |
| Testing | `skills/testing/skills.md` | Test strategy & execution |
| DevOps | `skills/devops/skills.md` | CI/CD & build |
| Documentation | `skills/documentation/skills.md` | Docs & examples |
| Security | `skills/security/skills.md` | Security review |
| Performance | `skills/performance/skills.md` | Performance optimization |

## File Ownership Matrix

| File/Directory | Primary Owner | Reviewers |
|----------------|--------------|-----------|
| `ARCHITECTURE.md` | Architect | All |
| `DEV_PLAN.md` | Architect | All |
| `packages/core/src/CircuitBreaker.ts` | Core Developer | Architect, Testing, Security |
| `packages/core/src/StateMachine.ts` | Core Developer | Architect, Testing, Performance |
| `packages/core/src/strategies/*.ts` | Core Developer | Architect, Testing |
| `packages/core/src/types/*.ts` | Core Developer | Architect, Security |
| `packages/core/src/metrics/*.ts` | Core Developer | Performance |
| `packages/core/test/*.ts` | Testing | Core Developer |
| `packages/persistence/src/adapters/*.ts` | Persistence | Core Developer, Security |
| `packages/persistence/src/leader/*.ts` | Persistence | Core Developer, Security |
| `packages/persistence/test/*.ts` | Testing | Persistence |
| `packages/examples/*/` | Documentation | Core Developer, Persistence |
| `docs/guides/*.md` | Documentation | All |
| `README.md` | Documentation | All |
| `.github/workflows/*.yml` | DevOps | Security |
| `package.json` (all) | DevOps | Architect |
| `tsconfig.json` (all) | Architect | DevOps |

## Agent Invocation Protocol

When an agent is asked to work, they:

1. **Read their skill file** — `skills/{agent}/skills.md`
2. **Check file ownership** — What files do they own vs review?
3. **Check phase deliverables** — What should be done in the current phase?
4. **Read reference implementations** — If relevant, check `../ask-gm`, `../agent-mesh`, `../voice-agent-kit`
5. **Implement** — Make changes, write tests, update docs
6. **Self-review** — Run lint, type-check, tests before finishing

## Phase Assignment

| Phase | Primary Agents | Support Agents | Focus |
|-------|---------------|----------------|-------|
| 0: Foundation | Architect, DevOps | Documentation | Scaffolding, reference extraction |
| 1: Core | Core Developer | Testing, Performance | Circuit breaker logic |
| 2: Persistence | Persistence | Testing, Security | Adapters, leader election |
| 3: Integration | Documentation, DevOps | All | Examples, docs, meta-package |
| 4: Release | DevOps, Testing | Performance, Security | Benchmarks, manual release |

## Architecture Decision Records (ADRs)

All architectural decisions must be documented in `docs/architecture/decisions/`.

### ADR Template

```markdown
# ADR-XXX: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What is the issue we're facing?

## Decision
What change are we proposing?

## Consequences
What becomes easier or more difficult?

## Compliance
How will we verify this decision is working?

## Owner
Which agent owns this decision?
```

### ADR Registry

| ADR | Title | Owner | Status |
|-----|-------|-------|--------|
| ADR-001 | Package Boundaries | Architect | Proposed |
| ADR-002 | State Serialization Format | Architect | Proposed |
| ADR-003 | Confidence/Cost Strategy API | Architect | Proposed |
| ADR-004 | Leader Election Pattern | Persistence | Proposed |
| ADR-005 | Metrics Collection Design | Performance | Proposed |

## Review Workflow

```
Developer (owner) -> Testing (test review) -> Security (security review) -> Architect (architectural compliance)
```

For core logic changes:
1. Core Developer implements
2. Testing Agent reviews test coverage
3. Security Agent reviews for vulnerabilities
4. Architect reviews for API consistency

For persistence changes:
1. Persistence Agent implements
2. Core Developer reviews integration with core
3. Security Agent reviews credential handling
4. Testing Agent reviews integration tests

## Communication Rules

1. **Decisions in ADRs** — If a decision changes, update the ADR
2. **File ownership** — Only the primary owner modifies owned files without PR
3. **Reviews required** — All changes to non-owned files need review from primary owner
4. **Reference implementations** — When in doubt, check ask-gm/agent-mesh for proven patterns
5. **No scope creep** — If it's not in DEV_PLAN.md Phase 1-4, defer to post-launch

## Quality Gates

Before any phase is considered complete:
- [ ] All owned files implemented
- [ ] Tests passing (unit + integration)
- [ ] TypeScript strict mode: zero errors
- [ ] ESLint: zero errors
- [ ] Coverage targets met
- [ ] ADRs updated for new decisions
- [ ] Documentation updated

## Getting Started as an Agent

1. Read this file (AGENTS.md)
2. Read your skill file (`skills/{your-agent}/skills.md`)
3. Check the current phase in DEV_PLAN.md
4. Check your deliverables for the current phase
5. Read reference implementations if relevant
6. Start implementing

## Support

For questions about the agent system:
- Check your skill file first
- Check ARCHITECTURE.md for technical context
- Check DEV_PLAN.md for phase context
- Ask in the project chat if still unclear
