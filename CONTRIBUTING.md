# Contributing to Circuit Breaker Agents

Thank you for your interest in contributing! This document provides guidelines for the `circuit-breaker-agents` project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

### Our Pledge

We pledge to make participation a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity.

### Our Standards

**Positive behavior**:
- Demonstrating empathy and kindness
- Being respectful of differing opinions
- Accepting constructive feedback
- Focusing on what's best for the community

**Unacceptable behavior**:
- Sexualized language or imagery
- Trolling, insulting, or derogatory comments
- Harassment (public or private)
- Publishing private information without permission

## Getting Started

### Prerequisites

- **Node.js**: v18.x or higher
- **pnpm**: v8.x or higher
- **Git**: Latest stable version

### Installation

```bash
git clone https://github.com/reaatech/circuit-breaker-agents.git
cd circuit-breaker-agents
pnpm install
pnpm build
pnpm test
```

## Development Setup

### Project Structure

```
circuit-breaker-agents/
├── packages/
│   ├── core/           # Core circuit breaker logic (circuit-breaker-core)
│   ├── persistence/    # Persistence adapters (circuit-breaker-persistence)
│   └── examples/       # Example applications
├── docs/               # Documentation
├── skills/             # Agent skills documentation
└── .github/            # GitHub Actions workflows
```

### Development Commands

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Format code
pnpm format

# Type check
pnpm type-check

# Run all checks (lint + type-check + test)
pnpm check
```

## How to Contribute

### Reporting Bugs

Before creating bug reports, check existing issues. Include:
- Clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Error messages and stack traces
- Environment details (Node.js version, OS)

### Suggesting Enhancements

- Clear, descriptive title
- Detailed description
- Why this enhancement is useful
- Usage examples
- Whether it's a breaking change

### Your First Code Contribution

Look for `good first issue` or `help wanted` labels.

### Pull Requests

```bash
git checkout -b feature/your-feature-name
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

## Pull Request Process

### PR Title and Description

- Clear, descriptive title
- Detailed description of what changed and why
- Reference related issues: `#issue-number`
- Update documentation if necessary

### PR Checklist

Before submitting:
- [ ] Code follows coding standards
- [ ] All tests pass (`pnpm test`)
- [ ] New tests added for new functionality
- [ ] Test coverage meets requirements (>90% core, >80% adapters)
- [ ] Documentation updated
- [ ] No new warnings or errors (`pnpm check`)

### Code Review

- All PRs require at least one review from a maintainer
- Be responsive to review feedback
- Address all comments before merging

## Coding Standards

### TypeScript

- Use TypeScript for all code
- Strict mode enabled (`"strict": true`)
- Explicit types for function parameters and returns
- Avoid `any` unless absolutely necessary

### Code Style

- 2 spaces indentation
- Single quotes for strings
- Always use semicolons
- Trailing commas in multiline objects/arrays
- Arrow functions for short callbacks
- Prefer `const` over `let`
- Meaningful variable names

### File Organization

- Group related code together
- Single responsibility per file
- Descriptive file names
- Organize imports (Prettier auto-formats)

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

body

footer
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style (formatting)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding/updating tests
- `chore`: Maintenance tasks

**Examples**:
```bash
feat(core): add gradual recovery strategy

Implemented gradual recovery with exponential backoff for HALF_OPEN state.

Closes #123

fix(persistence): handle connection timeouts in Redis adapter

Added proper timeout handling and retry logic for Redis connections.
```

## Testing

### Test Organization

Tests live alongside source code in `test/` directories within each package:

```
packages/core/
├── src/
│   ├── CircuitBreaker.ts
│   └── ...
└── test/
    ├── CircuitBreaker.test.ts
    ├── StateMachine.test.ts
    └── strategies/
        └── ErrorThresholdStrategy.test.ts
```

### Writing Tests

- Write tests for all new functionality
- Follow Arrange-Act-Assert (AAA) pattern
- Descriptive test names
- Test success and failure cases
- Include edge cases
- Mock external dependencies

### Example Test

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../src/CircuitBreaker.js';

describe('CircuitBreaker', () => {
  describe('execute', () => {
    it('should execute operation when circuit is CLOSED', async () => {
      // Arrange
      const breaker = new CircuitBreaker({ name: 'test' });
      const operation = vi.fn().mockResolvedValue('result');
      
      // Act
      const result = await breaker.execute(operation);
      
      // Assert
      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(1);
    });
    
    it('should throw CircuitOpenError when circuit is OPEN', async () => {
      // Arrange
      const breaker = new CircuitBreaker({ name: 'test' });
      breaker.forceState('OPEN');
      
      // Act & Assert
      await expect(breaker.execute(() => Promise.resolve()))
        .rejects
        .toThrow('Circuit breaker is OPEN');
    });
  });
});
```

## Documentation

### Code Comments

- JSDoc for all public APIs
- Include examples when helpful
- Explain "why", not just "what"
- Keep comments up-to-date

### API Documentation

- Update JSDoc comments for public APIs
- Include parameter descriptions
- Include return value descriptions
- Include usage examples

### README and Guides

- Update README for user-facing changes
- Update relevant guides in `docs/guides/`
- Add migration notes for breaking changes

## Questions?

- Check existing documentation
- Search the issue tracker
- Open a discussion for broader questions

Thank you for contributing!
