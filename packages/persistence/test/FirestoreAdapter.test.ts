import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  Transaction,
  WriteResult,
} from '@google-cloud/firestore';
import type { CircuitBreakerState } from '@reaatech/circuit-breaker-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreAdapter } from '../src/adapters/FirestoreAdapter.js';

function createMockFirestore(): Firestore {
  const docs = new Map<string, Record<string, unknown>>();

  const mockDoc = (id: string): DocumentReference =>
    ({
      id,
      path: `circuit_breakers/${id}`,
      get: vi.fn(async () => {
        const data = docs.get(id);
        return {
          exists: !!data,
          data: () => data ?? undefined,
          id,
        } as DocumentSnapshot;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        docs.set(id, data);
        return {} as WriteResult;
      }),
      delete: vi.fn(async () => {
        docs.delete(id);
        return {} as WriteResult;
      }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        docs.set(id, { ...(docs.get(id) ?? {}), ...data });
        return {} as WriteResult;
      }),
    }) as unknown as DocumentReference;

  const mockCollection = (name: string): CollectionReference =>
    ({
      id: name,
      path: name,
      doc: vi.fn((id: string) => mockDoc(id)),
      limit: vi.fn(function () {
        return this as unknown as Query;
      }),
      get: vi.fn(async () => {
        const allDocs: QueryDocumentSnapshot[] = [];
        docs.forEach((data, docId) => {
          allDocs.push({
            id: docId,
            data: () => data,
            exists: true,
          } as unknown as QueryDocumentSnapshot);
        });
        return { docs: allDocs, empty: allDocs.length === 0 } as unknown as QuerySnapshot;
      }),
    }) as unknown as CollectionReference;

  const batchOps: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];

  return {
    collection: vi.fn((name: string) => mockCollection(name)),
    batch: vi.fn(() => ({
      set: vi.fn((ref: DocumentReference, data: Record<string, unknown>) => {
        batchOps.push({ ref, data });
      }),
      commit: vi.fn(async () => {
        for (const op of batchOps) {
          docs.set(op.ref.id, op.data);
        }
        batchOps.length = 0;
        return [{} as WriteResult];
      }),
    })),
    runTransaction: vi.fn(async (updateFn: (t: Transaction) => Promise<void>) => {
      const transaction = {
        get: vi.fn(async (docRef: DocumentReference) => {
          const data = docs.get(docRef.id);
          return {
            exists: !!data,
            data: () => data ?? undefined,
            id: docRef.id,
          } as DocumentSnapshot;
        }),
        set: vi.fn((docRef: DocumentReference, data: Record<string, unknown>) => {
          docs.set(docRef.id, data);
        }),
        update: vi.fn((docRef: DocumentReference, data: Record<string, unknown>) => {
          docs.set(docRef.id, { ...(docs.get(docRef.id) ?? {}), ...data });
        }),
        delete: vi.fn((docRef: DocumentReference) => {
          docs.delete(docRef.id);
        }),
      } as unknown as Transaction;
      await updateFn(transaction);
    }),
  } as unknown as Firestore;
}

function makeState(overrides: Partial<CircuitBreakerState> = {}): CircuitBreakerState {
  return {
    circuit_id: 'test-circuit',
    state: 'CLOSED',
    failure_count: 0,
    success_count: 0,
    last_state_change: Date.now(),
    half_open_expected_calls: 0,
    half_open_completed_calls: 0,
    backoff_multiplier: 1,
    version: 1,
    ...overrides,
  };
}

describe('FirestoreAdapter', () => {
  let mockFirestore: Firestore;
  let adapter: FirestoreAdapter;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    adapter = new FirestoreAdapter(mockFirestore);
  });

  it('should connect successfully', async () => {
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('should save and load state', async () => {
    const state = makeState();
    await adapter.saveState(state);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.circuit_id).toBe('test-circuit');
    expect(loaded?.state).toBe('CLOSED');
  });

  it('should not overwrite with older version', async () => {
    const stateV2 = makeState({ version: 2, failure_count: 5 });
    await adapter.saveState(stateV2);

    const stateV1 = makeState({ version: 1, failure_count: 1 });
    await adapter.saveState(stateV1);

    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.failure_count).toBe(5);
  });

  it('should delete state', async () => {
    await adapter.saveState(makeState());
    await adapter.deleteState('test-circuit');
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded).toBeNull();
  });

  it('should save batch', async () => {
    await adapter.saveBatch([makeState({ circuit_id: 'a' }), makeState({ circuit_id: 'b' })]);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(2);
  });

  it('should acquire leadership', async () => {
    const result = await adapter.tryAcquireLeadership?.('instance-1', 5000);
    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(1);
  });

  it('should not allow another instance to acquire leadership', async () => {
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    const result = await adapter.tryAcquireLeadership?.('instance-2', 5000);
    expect(result.isLeader).toBe(false);
  });

  it('should release leadership', async () => {
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    await adapter.releaseLeadership?.('instance-1');

    const result = await adapter.tryAcquireLeadership?.('instance-2', 5000);
    expect(result.isLeader).toBe(true);
  });

  it('should return healthy from healthCheck', async () => {
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should throw on connect error', async () => {
    const failingFirestore = {
      ...mockFirestore,
      collection: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => {
            throw new Error('connection failed');
          }),
        })),
        doc: vi.fn(),
      })),
    } as unknown as Firestore;
    const failingAdapter = new FirestoreAdapter(failingFirestore);
    await expect(failingAdapter.connect()).rejects.toThrow('connection failed');
    expect(failingAdapter.isConnected()).toBe(false);
  });

  it('should return unhealthy from healthCheck on error', async () => {
    const failingFirestore = {
      ...mockFirestore,
      collection: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => {
            throw new Error('health check failed');
          }),
        })),
        doc: vi.fn(),
      })),
    } as unknown as Firestore;
    const failingAdapter = new FirestoreAdapter(failingFirestore);
    const health = await failingAdapter.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toBe('Error: health check failed');
  });

  it('should filter invalid data in loadAll', async () => {
    await adapter.saveState(makeState({ circuit_id: 'valid' }));
    // Manually inject invalid data
    const colRef = (mockFirestore.collection as ReturnType<typeof vi.fn>)('circuit_breakers');
    const invalidDoc = colRef.doc('invalid');
    await invalidDoc.set({ invalid_field: true });
    const all = await adapter.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].circuit_id).toBe('valid');
  });

  it('should allow leader takeover after lease expires', async () => {
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    // Simulate lease expiry by manually setting lease in the past
    const leaderCol = (mockFirestore.collection as ReturnType<typeof vi.fn>)(
      'circuit_breaker_leaders',
    );
    const leaderDoc = leaderCol.doc('circuit_breaker_sync');
    await leaderDoc.set({
      leader_id: 'instance-1',
      lease_expires_at: Date.now() - 1000,
      fencing_token: 1,
      updated_at: Date.now() - 10000,
    });
    const result = await adapter.tryAcquireLeadership?.('instance-2', 5000);
    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(2);
  });
});
