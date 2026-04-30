import { Firestore } from '@google-cloud/firestore';
import { CircuitBreaker, FirestoreAdapter } from '@reaatech/circuit-breaker-agents';

/**
 * Firestore persistence example.
 *
 * Prerequisites:
 *   - Set GOOGLE_APPLICATION_CREDENTIALS or use Application Default Credentials
 *   - Firestore database must exist
 */

async function main() {
  const firestore = new Firestore({ projectId: process.env.GCP_PROJECT_ID });
  const adapter = new FirestoreAdapter(firestore, 'circuit_breakers');

  await adapter.connect();
  console.log('Firestore adapter connected:', adapter.isConnected());

  const breaker = new CircuitBreaker({
    name: 'agent-tool-search',
    failureThreshold: 3,
    recoveryTimeoutMs: 10000,
    persistence: adapter,
  });

  // Trip the circuit with 3 failures
  console.log('Simulating failures to trip the circuit...');
  for (let i = 0; i < 3; i++) {
    try {
      await breaker.execute(() => Promise.reject(new Error('search timeout')));
    } catch {
      // expected
    }
  }

  console.log('Circuit state:', breaker.getState());
  console.log('Persisted stats:', breaker.getStats());

  // The state is saved to Firestore automatically after transitions.
  // On restart, the breaker will load the persisted state for the same circuit ID.

  await adapter.disconnect();
}

main().catch(console.error);
