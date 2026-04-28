import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBAdapter } from '../src/adapters/DynamoDBAdapter.js';
import type { DynamoDBClient, GetItemCommandOutput, ScanCommandOutput } from '@aws-sdk/client-dynamodb';

function createMockDynamoDBClient(): DynamoDBClient {
  const items = new Map<string, Record<string, unknown>>();

  const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const cmdName = command.constructor.name;

    if (cmdName === 'GetItemCommand') {
      const key = (command.input.Key as Record<string, unknown>);
      const pkAttr = key.PK as { S?: string } | undefined;
      const skAttr = key.SK as { S?: string } | undefined;
      const pk = pkAttr?.S ?? '';
      const sk = skAttr?.S ?? '';
      const item = items.get(`${pk}#${sk}`);
      return { Item: item ?? undefined } as GetItemCommandOutput;
    }

    if (cmdName === 'PutItemCommand') {
      const key = (command.input.Item as Record<string, unknown>);
      const pkAttr = key.PK as { S?: string } | undefined;
      const skAttr = key.SK as { S?: string } | undefined;
      const pk = pkAttr?.S ?? '';
      const sk = skAttr?.S ?? '';
      items.set(`${pk}#${sk}`, command.input.Item as Record<string, unknown>);
      return {};
    }

    if (cmdName === 'DeleteItemCommand') {
      const key = (command.input.Key as Record<string, unknown>);
      const pkAttr = key.PK as { S?: string } | undefined;
      const skAttr = key.SK as { S?: string } | undefined;
      const pk = pkAttr?.S ?? '';
      const sk = skAttr?.S ?? '';
      items.delete(`${pk}#${sk}`);
      return {};
    }

    if (cmdName === 'ScanCommand') {
      const prefixAttr = (command.input.ExpressionAttributeValues as Record<string, unknown> | undefined)?.[':prefix'] as { S?: string } | undefined;
      const prefix = prefixAttr?.S ?? '';
      const allItems = Array.from(items.values()).filter((item) => {
        const pkAttr = item.PK as { S?: string } | undefined;
        const pk = pkAttr?.S ?? '';
        return pk.startsWith(prefix);
      });
      return { Items: allItems } as ScanCommandOutput;
    }

    return {};
  });

  return {
    send,
    destroy: vi.fn(),
  } as unknown as DynamoDBClient;
}

function makeState(overrides: Record<string, unknown> = {}) {
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

describe('DynamoDBAdapter', () => {
  let mockClient: DynamoDBClient;
  let adapter: DynamoDBAdapter;

  beforeEach(() => {
    mockClient = createMockDynamoDBClient();
    adapter = new DynamoDBAdapter(mockClient);
  });

  it('should connect successfully', async () => {
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });

  it('should save and load state', async () => {
    const state = makeState();
    await adapter.saveState(state as any);
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded?.circuit_id).toBe('test-circuit');
    expect(loaded?.state).toBe('CLOSED');
  });

  it('should delete state', async () => {
    await adapter.saveState(makeState() as any);
    await adapter.deleteState('test-circuit');
    const loaded = await adapter.loadState('test-circuit');
    expect(loaded).toBeNull();
  });

  it('should save batch', async () => {
    await adapter.saveBatch([
      makeState({ circuit_id: 'a' }) as any,
      makeState({ circuit_id: 'b' }) as any,
    ]);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(2);
  });

  it('should acquire leadership', async () => {
    const result = await adapter.tryAcquireLeadership!('instance-1', 5000);
    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(1);
  });

  it('should not allow another instance to acquire leadership', async () => {
    await adapter.tryAcquireLeadership!('instance-1', 5000);
    const result = await adapter.tryAcquireLeadership!('instance-2', 5000);
    expect(result.isLeader).toBe(false);
  });

  it('should release leadership', async () => {
    await adapter.tryAcquireLeadership!('instance-1', 5000);
    await adapter.releaseLeadership!('instance-1');

    const result = await adapter.tryAcquireLeadership!('instance-2', 5000);
    expect(result.isLeader).toBe(true);
  });

  it('should return healthy from healthCheck', async () => {
    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should throw on connect error', async () => {
    const failingClient = createMockDynamoDBClient();
    failingClient.send = vi.fn(async () => { throw new Error('connection failed'); });
    const failingAdapter = new DynamoDBAdapter(failingClient);
    await expect(failingAdapter.connect()).rejects.toThrow('connection failed');
    expect(failingAdapter.isConnected()).toBe(false);
  });

  it('should return unhealthy from healthCheck on error', async () => {
    const failingClient = createMockDynamoDBClient();
    failingClient.send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'DescribeTableCommand') {
        throw new Error('health check failed');
      }
      return {};
    });
    const failingAdapter = new DynamoDBAdapter(failingClient);
    const health = await failingAdapter.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toBe('Error: health check failed');
  });

  it('should return empty array from loadAll when no items', async () => {
    const emptyClient = createMockDynamoDBClient();
    const emptyAdapter = new DynamoDBAdapter(emptyClient);
    const all = await emptyAdapter.loadAll();
    expect(all).toEqual([]);
  });

  it('should handle tryAcquireLeadership error gracefully', async () => {
    const failingClient = createMockDynamoDBClient();
    failingClient.send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'GetItemCommand') {
        throw new Error('dynamodb error');
      }
      return {};
    });
    const failingAdapter = new DynamoDBAdapter(failingClient);
    const result = await failingAdapter.tryAcquireLeadership!('instance-1', 5000);
    expect(result.isLeader).toBe(false);
    expect(result.fencingToken).toBe(0);
  });

  it('should filter invalid data in loadAll', async () => {
    // Manually put invalid item
    const rawClient = createMockDynamoDBClient();
    rawClient.send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const cmdName = command.constructor.name;
    if (cmdName === 'DescribeTableCommand') {
      return { Table: { TableName: 'circuit_breakers', TableStatus: 'ACTIVE' } };
    }

    if (cmdName === 'ScanCommand') {
        return {
          Items: [
            { PK: { S: 'CIRCUIT#valid' }, SK: { S: 'STATE' }, circuit_id: { S: 'valid' }, state: { S: 'CLOSED' }, last_state_change: { N: '1' }, version: { N: '1' } },
            { PK: { S: 'CIRCUIT#invalid' }, SK: { S: 'STATE' }, invalid: { S: 'true' } },
          ],
        };
      }
      return {};
    });
    const rawAdapter = new DynamoDBAdapter(rawClient);
    const all = await rawAdapter.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].circuit_id).toBe('valid');
  });
});
