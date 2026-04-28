import type { Firestore } from '@google-cloud/firestore';
import { CircuitBreakerStateSchema, type CircuitBreakerState } from 'circuit-breaker-core';
import type { PersistenceAdapter, HealthStatus, LeadershipResult } from '../types/adapter.js';
import { parseState } from '../utils/parseState.js';

interface FirestoreLeaderState {
  leader_id: string;
  lease_expires_at: number;
  fencing_token: number;
  updated_at: number;
}

export class FirestoreAdapter implements PersistenceAdapter {
  private connected = false;

  constructor(
    private readonly firestore: Firestore,
    private readonly collectionName: string = 'circuit_breakers',
    private readonly leaderCollectionName: string = 'circuit_breaker_leaders',
    private readonly leaderDocId: string = 'circuit_breaker_sync'
  ) {}

  async connect(): Promise<void> {
    try {
      await this.firestore.collection(this.collectionName).limit(1).get();
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async saveState(state: CircuitBreakerState): Promise<void> {
    const validated = CircuitBreakerStateSchema.parse(state);
    const docRef = this.firestore.collection(this.collectionName).doc(validated.circuit_id);

    await this.firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      const storedData = doc.data();

      if (!storedData || (storedData.version ?? 0) < validated.version) {
        transaction.set(docRef, {
          ...validated,
          updated_at: Date.now(),
        });
      }
    });
  }

  async loadState(circuitId: string): Promise<CircuitBreakerState | null> {
    const doc = await this.firestore.collection(this.collectionName).doc(circuitId).get();
    if (!doc.exists) return null;

    const data = doc.data();
    if (!data) return null;

    return parseState(data);
  }

  async deleteState(circuitId: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(circuitId).delete();
  }

  /**
   * Saves states sequentially with individual transactions.
   * For bulk writes, consider using Firestore's native `batch()` API directly.
   */
  async saveBatch(states: CircuitBreakerState[]): Promise<void> {
    for (const state of states) {
      await this.saveState(state);
    }
  }

  async loadAll(): Promise<CircuitBreakerState[]> {
    const snapshot = await this.firestore.collection(this.collectionName).get();
    return snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return data ? parseState(data) : null;
      })
      .filter((s): s is CircuitBreakerState => s !== null);
  }

  async tryAcquireLeadership(instanceId: string, leaseMs: number): Promise<LeadershipResult> {
    const leaderRef = this.firestore.collection(this.leaderCollectionName).doc(this.leaderDocId);
    const now = Date.now();
    const leaseExpiry = now + leaseMs;

    let result: LeadershipResult = { isLeader: false, fencingToken: 0 };

    await this.firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(leaderRef);

      if (!doc.exists) {
        transaction.set(leaderRef, {
          leader_id: instanceId,
          lease_expires_at: leaseExpiry,
          fencing_token: 1,
          updated_at: now,
        });
        result = { isLeader: true, fencingToken: 1 };
        return;
      }

      const data = doc.data() as FirestoreLeaderState | undefined;
      if (!data) {
        transaction.set(leaderRef, {
          leader_id: instanceId,
          lease_expires_at: leaseExpiry,
          fencing_token: 1,
          updated_at: now,
        });
        result = { isLeader: true, fencingToken: 1 };
        return;
      }

      if (data.lease_expires_at < now || data.leader_id === instanceId) {
        const newToken = data.fencing_token + 1;
        transaction.update(leaderRef, {
          leader_id: instanceId,
          lease_expires_at: leaseExpiry,
          fencing_token: newToken,
          updated_at: now,
        });
        result = { isLeader: true, fencingToken: newToken };
      } else {
        result = { isLeader: false, fencingToken: data.fencing_token };
      }
    });

    return result;
  }

  async releaseLeadership(instanceId: string): Promise<void> {
    const leaderRef = this.firestore.collection(this.leaderCollectionName).doc(this.leaderDocId);
    await this.firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(leaderRef);
      if (!doc.exists) return;
      const data = doc.data() as FirestoreLeaderState | undefined;
      if (data && data.leader_id === instanceId) {
        transaction.delete(leaderRef);
      }
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.firestore.collection(this.collectionName).limit(1).get();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(error) };
    }
  }
}

