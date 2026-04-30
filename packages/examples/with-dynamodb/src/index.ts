import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CircuitBreaker, DynamoDBAdapter } from '@reaatech/circuit-breaker-agents';

/**
 * DynamoDB persistence example.
 *
 * Prerequisites:
 *   - AWS credentials configured (env vars, ~/.aws/credentials, or IAM role)
 *   - DynamoDB table must exist (or use on-demand creation)
 */

async function main() {
  const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const adapter = new DynamoDBAdapter(client, 'circuit_breakers');

  await adapter.connect();
  console.log('DynamoDB adapter connected:', adapter.isConnected());

  const breaker = new CircuitBreaker({
    name: 'agent-tool-calculator',
    failureThreshold: 5,
    recoveryTimeoutMs: 15000,
    persistence: adapter,
  });

  // The adapter uses conditional writes for optimistic locking:
  //   attribute_not_exists(version) OR version < :localVersion
  // To load persisted state, call execute() -- state is lazy-loaded on first execution.
  console.log('State before execution:', breaker.getState());

  try {
    await breaker.execute(() => Promise.resolve({ result: 42 }));
    console.log('State after execution:', breaker.getState());
  } catch (err) {
    console.error('Execution failed:', (err as Error).message);
  }

  await adapter.disconnect();
}

main().catch(console.error);
