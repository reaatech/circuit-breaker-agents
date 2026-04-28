import type { Redis } from 'ioredis';
import { CircuitBreakerStateSchema, type CircuitBreakerState } from 'circuit-breaker-core';
import type { PersistenceAdapter, HealthStatus, LeadershipResult } from '../types/adapter.js';
import { parseState } from '../utils/parseState.js';

const SAVE_SCRIPT = `
  local current = redis.call('HGET', KEYS[1], 'version')
  if not current or tonumber(current) < tonumber(ARGV[1]) then
    redis.call('HMSET', KEYS[1], unpack(ARGV, 2, #ARGV))
    redis.call('EXPIRE', KEYS[1], ARGV[#ARGV])
    return 1
  end
  return 0
`;

export class RedisAdapter implements PersistenceAdapter {
  private connected = false;
  private saveScriptSha: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string = 'cb',
    private readonly ttlSeconds: number = 86400
  ) {}

  async connect(): Promise<void> {
    await this.redis.ping();
    await this.loadSaveScript();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async saveState(state: CircuitBreakerState): Promise<void> {
    const validated = CircuitBreakerStateSchema.parse(state);
    const key = this.key(validated.circuit_id);

    const args = [
      validated.version.toString(),
      'circuit_id', validated.circuit_id,
      'state', validated.state,
      'failure_count', validated.failure_count.toString(),
      'success_count', validated.success_count.toString(),
      'last_state_change', validated.last_state_change.toString(),
      'half_open_expected_calls', validated.half_open_expected_calls.toString(),
      'half_open_completed_calls', validated.half_open_completed_calls.toString(),
      'backoff_multiplier', validated.backoff_multiplier.toString(),
      'version', validated.version.toString(),
    ];

    if (validated.last_failure_time !== undefined) {
      args.push('last_failure_time', validated.last_failure_time.toString());
    }

    args.push(this.ttlSeconds.toString());

    try {
      if (this.saveScriptSha) {
        await this.redis.evalsha(this.saveScriptSha, 1, key, ...args);
      } else {
        await this.redis.eval(SAVE_SCRIPT, 1, key, ...args);
      }
    } catch (error) {
      if (this.isNoScriptError(error) && this.saveScriptSha) {
        await this.loadSaveScript();
        await this.redis.eval(SAVE_SCRIPT, 1, key, ...args);
      } else {
        throw error;
      }
    }
  }

  async loadState(circuitId: string): Promise<CircuitBreakerState | null> {
    const data = await this.redis.hgetall(this.key(circuitId));
    if (Object.keys(data).length === 0) return null;
    return parseState(this.parseRedisHash(data));
  }

  async deleteState(circuitId: string): Promise<void> {
    await this.redis.del(this.key(circuitId));
  }

  async saveBatch(states: CircuitBreakerState[]): Promise<void> {
    for (const state of states) {
      await this.saveState(state);
    }
  }

  async loadAll(): Promise<CircuitBreakerState[]> {
    const results: CircuitBreakerState[] = [];
    let cursor = '0';
    const pattern = `${this.keyPrefix}:circuit:*`;

    do {
      const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;

      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of keys) {
          pipeline.hgetall(key);
        }
        const pipelineResults = await pipeline.exec();

        if (pipelineResults) {
          for (const [, data] of pipelineResults) {
            if (data && typeof data === 'object') {
              const parsed = parseState(this.parseRedisHash(data as Record<string, string>));
              if (parsed) results.push(parsed);
            }
          }
        }
      }
    } while (cursor !== '0');

    return results;
  }

  async tryAcquireLeadership(instanceId: string, leaseMs: number): Promise<LeadershipResult> {
    const key = `${this.keyPrefix}:leader`;
    const now = Date.now();
    const leaseExpiry = now + leaseMs;

    const lua = `
      local current = redis.call('HMGET', KEYS[1], 'leader_id', 'lease_expires_at', 'fencing_token')
      local leaderId = current[1]
      local leaseExpires = tonumber(current[2]) or 0
      local token = tonumber(current[3]) or 0

      if not leaderId or leaseExpires < tonumber(ARGV[1]) or leaderId == ARGV[2] then
        local newToken = token + 1
        redis.call('HMSET', KEYS[1], 'leader_id', ARGV[2], 'lease_expires_at', ARGV[3], 'fencing_token', newToken)
        return newToken
      end
      return 0
    `;

    const result = await this.redis.eval(lua, 1, key, now.toString(), instanceId, leaseExpiry.toString());
    if (result === 0) {
      const data = await this.redis.hgetall(key);
      return { isLeader: false, fencingToken: parseInt(data.fencing_token ?? '0', 10) };
    }
    return { isLeader: true, fencingToken: result as number };
  }

  async releaseLeadership(instanceId: string): Promise<void> {
    const key = `${this.keyPrefix}:leader`;
    const lua = `
      local current = redis.call('HGET', KEYS[1], 'leader_id')
      if current == ARGV[1] then
        redis.call('DEL', KEYS[1])
        return 1
      end
      return 0
    `;
    await this.redis.eval(lua, 1, key, instanceId);
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(error) };
    }
  }

  private key(circuitId: string): string {
    return `${this.keyPrefix}:circuit:${circuitId}`;
  }

  private async loadSaveScript(): Promise<void> {
    const loaded = await this.redis.script('LOAD', SAVE_SCRIPT);
    if (typeof loaded === 'string') {
      this.saveScriptSha = loaded;
    } else {
      this.saveScriptSha = null;
    }
  }

  private isNoScriptError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('NOSCRIPT');
  }

  private parseRedisHash(data: Record<string, string>): Record<string, unknown> {
    return {
      circuit_id: data.circuit_id,
      state: data.state,
      failure_count: parseInt(data.failure_count ?? '0', 10),
      success_count: parseInt(data.success_count ?? '0', 10),
      last_failure_time: data.last_failure_time ? parseInt(data.last_failure_time, 10) : undefined,
      last_state_change: parseInt(data.last_state_change ?? '0', 10),
      half_open_expected_calls: parseInt(data.half_open_expected_calls ?? '0', 10),
      half_open_completed_calls: parseInt(data.half_open_completed_calls ?? '0', 10),
      backoff_multiplier: parseInt(data.backoff_multiplier ?? '1', 10),
      version: parseInt(data.version ?? '1', 10),
    };
  }
}
