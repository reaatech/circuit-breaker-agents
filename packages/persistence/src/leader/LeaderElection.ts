import type { LeadershipResult } from '../types/adapter.js';

export abstract class LeaderElection {
  protected isLeader = false;
  protected fencingToken = 0;
  protected leaderId: string | null = null;

  constructor(
    protected readonly instanceId: string,
    protected readonly leaseDurationMs: number,
  ) {}

  abstract tryAcquireLeadership(): Promise<LeadershipResult>;
  abstract releaseLeadership(): Promise<void>;

  getIsLeader(): boolean {
    return this.isLeader;
  }

  getFencingToken(): number {
    return this.fencingToken;
  }

  getLeaderId(): string | null {
    return this.leaderId;
  }
}

export class MemoryLeaderElection extends LeaderElection {
  private static leader: { instanceId: string; expiresAt: number; token: number } | null = null;
  private static globalTokenCounter = 0;

  tryAcquireLeadership(): Promise<LeadershipResult> {
    const now = Date.now();
    const leaseExpiry = now + this.leaseDurationMs;

    if (!MemoryLeaderElection.leader || MemoryLeaderElection.leader.expiresAt <= now) {
      MemoryLeaderElection.globalTokenCounter++;
      const newToken = MemoryLeaderElection.globalTokenCounter;
      MemoryLeaderElection.leader = {
        instanceId: this.instanceId,
        expiresAt: leaseExpiry,
        token: newToken,
      };
      this.isLeader = true;
      this.fencingToken = newToken;
      this.leaderId = this.instanceId;
      return Promise.resolve({ isLeader: true, fencingToken: newToken });
    }

    if (MemoryLeaderElection.leader.instanceId === this.instanceId) {
      MemoryLeaderElection.globalTokenCounter++;
      const newToken = MemoryLeaderElection.globalTokenCounter;
      MemoryLeaderElection.leader = {
        instanceId: this.instanceId,
        expiresAt: leaseExpiry,
        token: newToken,
      };
      this.isLeader = true;
      this.fencingToken = newToken;
      this.leaderId = this.instanceId;
      return Promise.resolve({ isLeader: true, fencingToken: newToken });
    }

    this.isLeader = false;
    this.leaderId = MemoryLeaderElection.leader.instanceId;
    return Promise.resolve({ isLeader: false, fencingToken: MemoryLeaderElection.leader.token });
  }

  releaseLeadership(): Promise<void> {
    if (MemoryLeaderElection.leader?.instanceId === this.instanceId) {
      MemoryLeaderElection.leader = null;
    }
    this.isLeader = false;
    this.leaderId = null;
    return Promise.resolve();
  }

  static reset(): void {
    MemoryLeaderElection.leader = null;
    MemoryLeaderElection.globalTokenCounter = 0;
  }
}
