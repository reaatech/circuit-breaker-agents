import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { CircuitBreakerStateSchema, type CircuitBreakerState } from 'circuit-breaker-core';
import type { PersistenceAdapter, HealthStatus, LeadershipResult } from '../types/adapter.js';
import { parseState } from '../utils/parseState.js';

export class DynamoDBAdapter implements PersistenceAdapter {
  private connected = false;

  constructor(
    private client: DynamoDBClient,
    private readonly tableName: string = 'circuit_breakers',
    private readonly ttlSeconds: number = 86400
  ) {}

  async connect(): Promise<void> {
    try {
      await this.client.send(new DescribeTableCommand({ TableName: this.tableName }));
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client.destroy();
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async saveState(state: CircuitBreakerState): Promise<void> {
    const validated = CircuitBreakerStateSchema.parse(state);
    await this.client.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        PK: `CIRCUIT#${validated.circuit_id}`,
        SK: 'STATE',
        ...validated,
        ttl: Math.floor(Date.now() / 1000) + this.ttlSeconds,
      }),
      ConditionExpression: 'attribute_not_exists(#version) OR #version < :version',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: marshall({ ':version': validated.version }),
    }));
  }

  async loadState(circuitId: string): Promise<CircuitBreakerState | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: `CIRCUIT#${circuitId}`, SK: 'STATE' }),
    }));

    if (!result.Item) return null;
    return parseState(unmarshall(result.Item) as Record<string, unknown>);
  }

  async deleteState(circuitId: string): Promise<void> {
    await this.client.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ PK: `CIRCUIT#${circuitId}`, SK: 'STATE' }),
    }));
  }

  async saveBatch(states: CircuitBreakerState[]): Promise<void> {
    for (const state of states) {
      await this.saveState(state);
    }
  }

  /**
   * Loads all circuit states using a Scan operation with a prefix filter.
   * Scan is expensive at scale; prefer individual loadState() calls for hot paths.
   */
  async loadAll(): Promise<CircuitBreakerState[]> {
    const { ScanCommand: ScanCmd } = await import('@aws-sdk/client-dynamodb');
    const result = await this.client.send(new ScanCmd({
      TableName: this.tableName,
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: marshall({ ':prefix': 'CIRCUIT#' }),
    }));

    return (result.Items ?? [])
      .map((item) => parseState(unmarshall(item) as Record<string, unknown>))
      .filter((s): s is CircuitBreakerState => s !== null);
  }

  async tryAcquireLeadership(instanceId: string, leaseMs: number): Promise<LeadershipResult> {
    const leaderKey = 'LEADER#circuit_breaker_sync';
    const now = Date.now();
    const leaseExpiry = now + leaseMs;

    try {
      const existing = await this.client.send(new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: leaderKey, SK: 'LEADER' }),
      }));

      let newToken = 1;
      let conditionExpression = 'attribute_not_exists(PK)';

      if (existing.Item) {
        const data = unmarshall(existing.Item) as Record<string, unknown>;
        const leaseExpires = Number(data.lease_expires_at ?? 0);
        const leaderId = typeof data.leader_id === 'string' ? data.leader_id : '';
        const fencingToken = Number(data.fencing_token ?? 0);

        if (leaseExpires > now && leaderId !== instanceId) {
          return { isLeader: false, fencingToken };
        }
        newToken = fencingToken + 1;
        conditionExpression = 'leader_id = :instanceId OR lease_expires_at < :now';
      }

      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          PK: leaderKey,
          SK: 'LEADER',
          leader_id: instanceId,
          lease_expires_at: leaseExpiry,
          fencing_token: newToken,
          updated_at: now,
        }),
        ConditionExpression: conditionExpression,
        ExpressionAttributeValues: marshall({
          ...(conditionExpression.includes(':instanceId') && { ':instanceId': instanceId }),
          ...(conditionExpression.includes(':now') && { ':now': now }),
        }),
      }));

      return { isLeader: true, fencingToken: newToken };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        const existing = await this.client.send(new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: leaderKey, SK: 'LEADER' }),
        }));
        if (existing.Item) {
          const data = unmarshall(existing.Item) as Record<string, unknown>;
          return { isLeader: false, fencingToken: Number(data.fencing_token ?? 0) };
        }
      }
      return { isLeader: false, fencingToken: 0 };
    }
  }

  async releaseLeadership(instanceId: string): Promise<void> {
    try {
      await this.client.send(new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: 'LEADER#circuit_breaker_sync', SK: 'LEADER' }),
        ConditionExpression: 'leader_id = :instanceId',
        ExpressionAttributeValues: marshall({ ':instanceId': instanceId }),
      }));
    } catch {
      // Ignore if not the leader or condition fails
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.client.send(new DescribeTableCommand({ TableName: this.tableName }));
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(error) };
    }
  }
}
