# DevOps Agent Skills (`@reaatech/devops-agent`)

## Agent Profile

**Name**: DevOps Agent  
**Identifier**: `@reaatech/devops-agent`  
**Skill Level**: Expert  
**Domain**: CI/CD, Build & Infrastructure

## Project Context

You are setting up the build, test, and infrastructure for `circuit-breaker-agents`. This is a TypeScript monorepo with 3 packages. **This is an internal library — there is no NPM publishing and no automated deployment.**

## Files You Own

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Pull request CI (lint, type-check, test, build) |
| `package.json` (root) | Workspace configuration |
| `pnpm-workspace.yaml` | pnpm workspace definition |
| `turbo.json` | Build pipeline orchestration |
| `packages/*/package.json` | Package metadata (review) |

## CI/CD Policy

- **CI is enabled** — Lint, type-check, test, and build run on PRs and `main`
- **Deployment is disabled by default** — No automated publishing or deployment workflows
- **Releases are manual** — Tag + GitHub release created by maintainers when ready

## CI Workflow (ci.yml)

Triggered on: `push` to `main`, `pull_request` to `main`

Jobs:
1. **lint** — ESLint across all packages
2. **type-check** — `tsc --noEmit` in each package
3. **test** — Vitest with coverage
4. **build** — tsup build all packages

Matrix: Node.js 18.x, 20.x

## Package Configuration

### Root package.json

```json
{
  "name": "circuit-breaker-agents",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@8.14.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "eslint . --ext .ts",
    "type-check": "tsc --noEmit",
    "check": "pnpm lint && pnpm type-check && pnpm test"
  }
}
```

### Core package.json

```json
{
  "name": "circuit-breaker-core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "vitest": "^1.2.2",
    "@vitest/coverage-c8": "^1.2.2"
  }
}
```

### Persistence package.json

```json
{
  "name": "circuit-breaker-persistence",
  "version": "0.0.0",
  "peerDependencies": {
    "@google-cloud/firestore": "^7.0.0",
    "@aws-sdk/client-dynamodb": "^3.500.0",
    "ioredis": "^5.3.2"
  },
  "peerDependenciesMeta": {
    "@google-cloud/firestore": { "optional": true },
    "@aws-sdk/client-dynamodb": { "optional": true },
    "ioredis": { "optional": true }
  }
}
```

## Build Configuration

### tsup (per package)

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "type-check": {}
  }
}
```

## Deliverables by Phase

### Phase 0
- [ ] `package.json` (root)
- [ ] `pnpm-workspace.yaml`
- [ ] `turbo.json`
- [ ] `packages/core/package.json`
- [ ] `packages/persistence/package.json`
- [ ] `packages/agents/package.json`
- [ ] `.github/workflows/ci.yml`

### Phase 4
- [ ] Manual GitHub release (tag only, no deployment)
