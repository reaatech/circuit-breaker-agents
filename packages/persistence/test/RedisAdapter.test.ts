import type { CircuitBreakerState } from '@reaatech/circuit-breaker-core';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisAdapter } from '../src/adapters/RedisAdapter.js';

function createMockRedis(): Redis {
  const store = new Map<string, Map<string, string>>();
  const scripts = new Map<string, string>();
  let scriptCounter = 0;

  const redis = {
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
    hgetall: vi.fn(async (key: string) => {
      const data = store.get(key);
      if (!data) return {};
      const result: Record<string, string> = {};
      data.forEach((v, k) => {
        result[k] = v;
      });
      return result;
    }),
    hmset: vi.fn(async (key: string, data: Record<string, string | number>) => {
      let map = store.get(key);
      if (!map) {
        map = new Map();
        store.set(key, map);
      }
      for (const [k, v] of Object.entries(data)) {
        map.set(k, String(v));
      }
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    scan: vi.fn(async (_cursor: string, ...args: string[]) => {
      const matchIndex = args.indexOf('MATCH');
      const pattern = matchIndex >= 0 ? String(args[matchIndex + 1]) : '*';
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      const matching: string[] = [];
      for (const key of store.keys()) {
        if (regex.test(key)) matching.push(key);
      }
      return ['0', matching];
    }),
    keys: vi.fn(async (pattern: string) => {
      const results: string[] = [];
      for (const key of store.keys()) {
        // Simple glob matching for test
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
        if (regex.test(key)) results.push(key);
      }
      return results;
    }),
    script: vi.fn(async (cmd: string, script: string) => {
      if (cmd === 'LOAD') {
        scriptCounter++;
        const sha = `sha${scriptCounter}`;
        scripts.set(sha, script);
        return sha;
      }
      return '';
    }),
    evalsha: vi.fn(async (sha: string, _numKeys: number, key: string, ...args: string[]) => {
      // Fallback to eval behavior for test
      return redis.eval?.(sha, _numKeys, key, ...args);
    }),
    eval: vi.fn(async (_script: string, _numKeys: number, key: string, ...args: string[]) => {
      const script = scripts.get(_script) ?? _script;

      // Simulate the save script logic
      if (script.includes('version') && script.includes('HMSET')) {
        const version = Number.parseInt(args[0], 10);
        const current = store.get(key);
        const currentVersion = current ? Number.parseInt(current.get('version') ?? '0', 10) : 0;

        if (!current || currentVersion < version) {
          let map = store.get(key);
          if (!map) {
            map = new Map();
            store.set(key, map);
          }
          // args are: version, k1, v1, k2, v2, ...
          for (let i = 1; i < args.length; i += 2) {
            if (args[i] && args[i + 1] !== undefined) {
              map.set(args[i], args[i + 1]);
            }
          }
          return 1;
        }
        return 0;
      }

      // Simulate release leader script (contains DEL)
      if (script.includes('leader_id') && script.includes('DEL')) {
        const instanceId = args[0];
        const leaderMap = store.get(key);
        if (leaderMap?.get('leader_id') === instanceId) {
          store.delete(key);
          return 1;
        }
        return 0;
      }

      // Simulate acquire leader script
      if (script.includes('leader_id')) {
        const now = Number.parseInt(args[0], 10);
        const instanceId = args[1];
        const leaseExpiry = Number.parseInt(args[2], 10);

        const leaderMap = store.get(key);
        const leaderId = leaderMap?.get('leader_id');
        const leaseExpires = leaderMap
          ? Number.parseInt(leaderMap.get('lease_expires_at') ?? '0', 10)
          : 0;
        const token = leaderMap ? Number.parseInt(leaderMap.get('fencing_token') ?? '0', 10) : 0;

        if (!leaderId || leaseExpires < now || leaderId === instanceId) {
          const newToken = token + 1;
          let map = store.get(key);
          if (!map) {
            map = new Map();
            store.set(key, map);
          }
          map.set('leader_id', instanceId);
          map.set('lease_expires_at', leaseExpiry.toString());
          map.set('fencing_token', newToken.toString());
          return newToken;
        }
        return 0;
      }

      return 0;
    }),
    pipeline: vi.fn(() => {
      const commands: Array<{ cmd: string; args: unknown[] }> = [];
      const pipeline = {
        hmset: vi.fn((key: string, data: Record<string, unknown>) => {
          commands.push({ cmd: 'hmset', args: [key, data] });
          return pipeline;
        }),
        expire: vi.fn((key: string, ttl: number) => {
          commands.push({ cmd: 'expire', args: [key, ttl] });
          return pipeline;
        }),
        hgetall: vi.fn((key: string) => {
          commands.push({ cmd: 'hgetall', args: [key] });
          return pipeline;
        }),
        exec: vi.fn(async () => {
          const results: Array<[null | Error, unknown]> = [];
          for (const command of commands) {
            if (command.cmd === 'hmset') {
              await redis.hmset?.(
                command.args[0] as string,
                command.args[1] as Record<string, string>,
              );
              results.push([null, 'OK']);
            } else if (command.cmd === 'expire') {
              await redis.expire?.(command.args[0] as string, command.args[1] as number);
              results.push([null, 1]);
            } else if (command.cmd === 'hgetall') {
              const data = await redis.hgetall?.(command.args[0] as string);
              results.push([null, data]);
            }
          }
          return results;
        }),
      };
      return pipeline;
    }),
  } as unknown as Redis;

  return redis;
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

describe('RedisAdapter', () => {
  let mockRedis: Redis;
  let adapter: RedisAdapter;

  beforeEach(() => {
    mockRedis = createMockRedis();
    adapter = new RedisAdapter(mockRedis);
  });

  it('should connect successfully', async () => {
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('should save and load state', async () => {
    await adapter.connect();
    const state = makeState();
    await adapter.saveState(state);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.circuit_id).toBe('test-circuit');
    expect(loaded?.state).toBe('CLOSED');
  });

  it('should delete state', async () => {
    await adapter.connect();
    await adapter.saveState(makeState());
    await adapter.deleteState('test-circuit');
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded).toBeNull();
  });

  it('should save batch', async () => {
    await adapter.connect();
    await adapter.saveBatch([makeState({ circuit_id: 'a' }), makeState({ circuit_id: 'b' })]);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(2);
  });

  it('should acquire leadership', async () => {
    await adapter.connect();
    const result = await adapter.tryAcquireLeadership?.('instance-1', 5000);
    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(1);
  });

  it('should not allow another instance to acquire leadership', async () => {
    await adapter.connect();
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    const result = await adapter.tryAcquireLeadership?.('instance-2', 5000);
    expect(result.isLeader).toBe(false);
  });

  it('should release leadership', async () => {
    await adapter.connect();
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    await adapter.releaseLeadership?.('instance-1');

    const result = await adapter.tryAcquireLeadership?.('instance-2', 5000);
    expect(result.isLeader).toBe(true);
  });

  it('should return healthy from healthCheck', async () => {
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should save state with last_failure_time', async () => {
    await adapter.connect();
    const state = makeState({ last_failure_time: Date.now() });
    await adapter.saveState(state);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.last_failure_time).toBe(state.last_failure_time);
  });

  it('should fallback to eval when script sha is not loaded', async () => {
    // Create adapter without calling connect (no script loaded)
    const freshAdapter = new RedisAdapter(mockRedis);
    const state = makeState();
    await freshAdapter.saveState(state);
    const loaded = await freshAdapter.loadState('test-circuit');
    expect(loaded?.circuit_id).toBe('test-circuit');
  });

  it('should return empty array from loadAll when no keys', async () => {
    await adapter.connect();
    const emptyRedis = createMockRedis();
    const emptyAdapter = new RedisAdapter(emptyRedis);
    const all = await emptyAdapter.loadAll();
    expect(all).toEqual([]);
  });

  it('should not release leadership when held by another instance', async () => {
    await adapter.connect();
    await adapter.tryAcquireLeadership?.('instance-1', 5000);
    await adapter.releaseLeadership?.('instance-2');
    // instance-1 should still be leader
    const result = await adapter.tryAcquireLeadership?.('instance-1', 5000);
    expect(result.isLeader).toBe(true);
  });

  it('should return unhealthy from healthCheck on error', async () => {
    const failingRedis = createMockRedis();
    failingRedis.ping = vi.fn(async () => {
      throw new Error('redis down');
    });
    const failingAdapter = new RedisAdapter(failingRedis);
    const health = await failingAdapter.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toBe('Error: redis down');
  });

  it('should recover from NOSCRIPT error on evalsha', async () => {
    // Simulate the save script being loaded then evicted
    await adapter.connect();

    // Override evalsha to throw NOSCRIPT once, then succeed
    let evalshaCallCount = 0;
    const originalEvalsha = mockRedis.evalsha as ReturnType<typeof vi.fn>;
    originalEvalsha.mockImplementation(
      async (sha: string, _numKeys: number, key: string, ...args: string[]) => {
        evalshaCallCount++;
        if (evalshaCallCount === 1) {
          const error = new Error('NOSCRIPT No matching script. Please use EVAL.');
          error.name = 'ReplyError';
          throw error;
        }
        // Fall back to the eval mock for subsequent calls
        const evalFn = mockRedis.eval as ReturnType<typeof vi.fn>;
        return evalFn(sha, _numKeys, key, ...args);
      },
    );

    const state = makeState();
    await adapter.saveState(state);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.circuit_id).toBe('test-circuit');
  });
});
