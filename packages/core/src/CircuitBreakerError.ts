import type { CircuitState } from './types/circuit.js';

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly circuitId: string,
    public readonly state: CircuitState,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitOpenError extends CircuitBreakerError {
  public readonly timeUntilRetry: number;

  constructor(circuitId: string, timeUntilRetry: number, options?: { cause?: Error }) {
    super(`Circuit breaker is OPEN for ${circuitId}`, 'CIRCUIT_OPEN', circuitId, 'OPEN', options);
    this.name = 'CircuitOpenError';
    this.timeUntilRetry = timeUntilRetry;
  }
}

export class CircuitTimeoutError extends CircuitBreakerError {
  constructor(
    circuitId: string,
    public readonly timeoutMs: number,
    public readonly actualState: CircuitState,
    options?: { cause?: Error },
  ) {
    super(
      `Circuit breaker timeout after ${timeoutMs}ms for ${circuitId}`,
      'CIRCUIT_TIMEOUT',
      circuitId,
      actualState,
      options,
    );
    this.name = 'CircuitTimeoutError';
  }
}
