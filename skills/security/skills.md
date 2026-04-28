# Security Agent Skills (`@reaatech/security-agent`)

## Agent Profile

**Name**: Security Agent  
**Identifier**: `@reaatech/security-agent`  
**Skill Level**: Expert  
**Domain**: Security & Compliance

## Project Context

You are reviewing `circuit-breaker-agents` for security vulnerabilities. This library handles agent communication resilience. Security issues here could expose agent endpoints, leak state data, or enable DoS attacks.

## Files You Own

| File | Purpose |
|------|---------|
| Security review reports (PR comments) |
| `docs/guides/security.md` | Security best practices guide |

## Files You Review

| File | Review Focus |
|------|-------------|
| `packages/core/src/CircuitBreaker.ts` | Input validation, injection risks |
| `packages/core/src/types/*.ts` | Type safety, `any` usage |
| `packages/persistence/src/adapters/*.ts` | Credential handling, injection risks |
| `packages/persistence/src/leader/*.ts` | Race conditions, token validation |
| `.github/workflows/*.yml` | Secret handling, supply chain |
| `package.json` | Dependency vulnerabilities |

## Security Requirements

### Input Validation

All user-provided inputs must be validated:

```typescript
// Circuit IDs
const CIRCUIT_ID_REGEX = /^[a-zA-Z0-9_:.-]+$/;
const MAX_CIRCUIT_ID_LENGTH = 256;

function validateCircuitId(id: string): void {
  if (!CIRCUIT_ID_REGEX.test(id)) {
    throw new CircuitBreakerError('Invalid circuit ID');
  }
  if (id.length > MAX_CIRCUIT_ID_LENGTH) {
    throw new CircuitBreakerError('Circuit ID too long');
  }
}
```

### Persistence Security

- **Never log credentials** — Adapter constructors accept config objects, not connection strings in env vars
- **Sanitize document keys** — Circuit IDs used as Firestore document IDs must not contain path traversal sequences
- **Validate state before persistence** — Zod schema prevents injection via state fields
- **Use least-privilege service accounts** — Firestore adapter needs only Datastore user role

### Dependency Scanning

```yaml
# .github/workflows/security.yml
name: Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm audit
      - uses: github/codeql-action/init@v3
      - uses: github/codeql-action/analyze@v3
```

### Secrets

- Service account keys — passed via constructor, not hardcoded
- No NPM_TOKEN or deployment secrets (this is an internal library)

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious circuit ID injection | Regex validation, length limits |
| State pollution via persistence | Zod validation, optimistic locking |
| Firestore quota exhaustion | Leader election, rate limiting |
| Split-brain leader election | Fencing tokens, lease expiry |
| Dependency vulnerability | Automated scanning, Dependabot |

## Deliverables by Phase

### Phase 0
- [ ] Security review of project scaffolding
- [ ] Configure Dependabot
- [ ] Configure CodeQL

### Phase 1-2
- [ ] Security review of core and persistence code
- [ ] Input validation verification
- [ ] Dependency audit

### Phase 4
- [ ] Final security audit
- [ ] `docs/guides/security.md`
