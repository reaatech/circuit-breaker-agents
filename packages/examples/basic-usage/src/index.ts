import { CircuitBreaker } from '@reaatech/circuit-breaker-agents';

/**
 * Basic usage example — no persistence, no external dependencies.
 *
 * Demonstrates:
 *   - Error-threshold tripping
 *   - Confidence-aware tripping
 *   - Cost-aware tripping
 *   - Fallback routing
 *   - Manual reset
 */

const breaker = new CircuitBreaker({
  name: 'openai-gpt4',
  failureThreshold: 3,
  recoveryTimeoutMs: 5000,
  halfOpenTimeoutMs: 10000,
  minConfidence: 0.7,
  confidenceWindowMs: 60000,
  maxCostPerMinute: 1.0,
  maxTokensPerCall: 4000,
  recoveryStrategy: 'gradual',
});

breaker.on('stateChange', (event) => {
  console.log(
    `[${event.circuit_id}] State changed: ${event.data.from} -> ${event.data.to} (${event.data.reason})`,
  );
});

breaker.on('failure', (event) => {
  console.log(`[${event.circuit_id}] Failure after ${event.data.duration}ms`);
});

type OperationResult = { text: string; confidence?: number; costUsd?: number; tokens?: number };

async function simulateOperation(
  shouldFail: boolean,
  metadata?: { confidence?: number; costUsd?: number; tokens?: number },
): Promise<OperationResult> {
  if (shouldFail) {
    throw new Error('Simulated failure');
  }
  return { text: 'Hello from LLM', ...metadata };
}

function extractMetadata(result: OperationResult) {
  return {
    confidence: result.confidence,
    costUsd: result.costUsd,
    tokens: result.tokens,
  };
}

function extractErrorMetadata(_error: unknown) {
  return { error: true };
}

async function main() {
  console.log('--- 1. Normal execution ---');
  const ok = await breaker.execute(
    () => simulateOperation(false, { confidence: 0.9, costUsd: 0.01, tokens: 150 }),
    { onSuccess: extractMetadata, onFailure: extractErrorMetadata },
  );
  console.log('Result:', ok);

  console.log('\n--- 2. Trigger error threshold ---');
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(() => simulateOperation(true), {
        onSuccess: extractMetadata,
        onFailure: extractErrorMetadata,
      });
    } catch (err) {
      console.log('Caught:', (err as Error).message);
    }
  }
  console.log('State after failures:', breaker.getState());

  console.log('\n--- 3. Fallback when OPEN ---');
  const fallbackResult = await breaker.execute(() => simulateOperation(false), {
    fallback: async () => ({ text: 'Fallback response' }),
  });
  console.log('Fallback result:', fallbackResult);

  console.log('\n--- 4. Wait for recovery (HALF_OPEN) ---');
  await new Promise((resolve) => setTimeout(resolve, 6000));
  console.log('State after timeout:', breaker.getState());

  const recovery = await breaker.execute(
    () => simulateOperation(false, { confidence: 0.95, costUsd: 0.005, tokens: 100 }),
    { onSuccess: extractMetadata, onFailure: extractErrorMetadata },
  );
  console.log('Recovery result:', recovery);
  console.log('State after success:', breaker.getState());

  console.log('\n--- 5. Manual reset ---');
  breaker.forceState('openai-gpt4', 'OPEN');
  console.log('State after force:', breaker.getState());
  breaker.reset();
  console.log('State after reset:', breaker.getState());

  console.log('\n--- 6. Stats ---');
  console.log(breaker.getStats());
}

main().catch(console.error);
