import { CircuitBreaker, RedisAdapter } from '@reaatech/circuit-breaker-agents';
import { Redis } from 'ioredis';

/**
 * Redis persistence example.
 *
 * Prerequisites:
 *   - Redis server running (local or managed)
 */

async function main() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const adapter = new RedisAdapter(redis, 'cb', 86400);

  await adapter.connect();
  console.log('Redis adapter connected:', adapter.isConnected());

  const breaker = new CircuitBreaker({
    name: 'agent-tool-code-interpreter',
    failureThreshold: 3,
    recoveryTimeoutMs: 10000,
    persistence: adapter,
  });

  // The Redis adapter uses a Lua script for atomic compare-and-set
  console.log('State before execution:', breaker.getState());

  try {
    await breaker.execute(() => Promise.resolve({ output: 'Code executed successfully' }));
    console.log('State after execution:', breaker.getState());
  } catch (err) {
    console.error('Execution failed:', (err as Error).message);
  }

  // Leader election is available via the adapter
  if (adapter.tryAcquireLeadership) {
    const leadership = await adapter.tryAcquireLeadership('instance-1', 5000);
    console.log('Leadership acquired:', leadership.isLeader, 'token:', leadership.fencingToken);
  }

  await adapter.disconnect();
}

main().catch(console.error);
