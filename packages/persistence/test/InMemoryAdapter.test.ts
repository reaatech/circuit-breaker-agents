import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAdapter } from '../src/adapters/InMemoryAdapter.js';
import type { CircuitBreakerState } from 'circuit-breaker-core';

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

describe('InMemoryAdapter', () => {
  let adapter: InMemoryAdapter;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
    adapter.clear();
  });

  it('should connect and disconnect', async () => {
    expect(adapter.isConnected()).toBe(true);
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('should save and load state', async () => {
    const state = makeState();
    await adapter.saveState(state);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded).toEqual(state);
  });

  it('should return null for missing state', async () => {
    const loaded = await adapter.loadState('missing');
    expect(loaded).toBeNull();
  });

  it('should update state with newer version', async () => {
    const state1 = makeState({ version: 1, failure_count: 1 });
    await adapter.saveState(state1);

    const state2 = makeState({ version: 2, failure_count: 2 });
    await adapter.saveState(state2);

    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.failure_count).toBe(2);
    expect(loaded?.version).toBe(2);
  });

  it('should not downgrade version', async () => {
    const state2 = makeState({ version: 2, failure_count: 2 });
    await adapter.saveState(state2);

    const state1 = makeState({ version: 1, failure_count: 1 });
    await adapter.saveState(state1);

    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.failure_count).toBe(2);
    expect(loaded?.version).toBe(2);
  });

  it('should delete state', async () => {
    await adapter.saveState(makeState());
    await adapter.deleteState('test-circuit');
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded).toBeNull();
  });

  it('should save batch', async () => {
    const states = [
      makeState({ circuit_id: 'a' }),
      makeState({ circuit_id: 'b' }),
    ];
    await adapter.saveBatch(states);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.circuit_id).sort()).toEqual(['a', 'b']);
  });

  it('should validate state with zod', async () => {
    const invalid = { circuit_id: 'bad', state: 'INVALID' } as unknown as CircuitBreakerState;
    await expect(adapter.saveState(invalid)).rejects.toThrow();
  });

  it('should return healthy from healthCheck', async () => {
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
