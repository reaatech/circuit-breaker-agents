---
"@reaatech/circuit-breaker-core": patch
---

- **@reaatech/circuit-breaker-core** (patch): Fixes two public-API bugs (closes #30): the `failureStrategy` option in CircuitBreakerConfig was silently ignored in favor of an auto-created ErrorThresholdStrategy, and ErrorThresholdStrategy would silently accept an options object as its `threshold`. Both now behave correctly with a helpful TypeError for the common misuse.
