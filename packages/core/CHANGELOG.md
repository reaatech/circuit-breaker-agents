# @reaatech/circuit-breaker-core

## 0.1.1

### Patch Changes

- [`5b9a9aa`](https://github.com/reaatech/circuit-breaker-agents/commit/5b9a9aab03e3a6a38710590f0e01950c52b55912) Thanks [@reaatech](https://github.com/reaatech)! - - **@reaatech/circuit-breaker-core** (patch): Fixes two public-API bugs (closes [#30](https://github.com/reaatech/circuit-breaker-agents/issues/30)): the `failureStrategy` option in CircuitBreakerConfig was silently ignored in favor of an auto-created ErrorThresholdStrategy, and ErrorThresholdStrategy would silently accept an options object as its `threshold`. Both now behave correctly with a helpful TypeError for the common misuse.
