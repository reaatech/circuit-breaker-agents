import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryLeaderElection } from '../src/leader/LeaderElection.js';

describe('MemoryLeaderElection', () => {
  beforeEach(() => {
    MemoryLeaderElection.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should acquire leadership when no leader exists', async () => {
    const election = new MemoryLeaderElection('instance-1', 5000);
    const result = await election.tryAcquireLeadership();

    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(1);
    expect(election.getIsLeader()).toBe(true);
  });

  it('should not allow another instance to acquire while lease is valid', async () => {
    const election1 = new MemoryLeaderElection('instance-1', 5000);
    await election1.tryAcquireLeadership();

    const election2 = new MemoryLeaderElection('instance-2', 5000);
    const result = await election2.tryAcquireLeadership();

    expect(result.isLeader).toBe(false);
    expect(election2.getIsLeader()).toBe(false);
    expect(election2.getLeaderId()).toBe('instance-1');
  });

  it('should allow takeover after lease expires', async () => {
    const election1 = new MemoryLeaderElection('instance-1', 5000);
    await election1.tryAcquireLeadership();

    vi.advanceTimersByTime(6000);

    const election2 = new MemoryLeaderElection('instance-2', 5000);
    const result = await election2.tryAcquireLeadership();

    expect(result.isLeader).toBe(true);
    expect(result.fencingToken).toBe(2);
  });

  it('should renew lease for current leader', async () => {
    const election = new MemoryLeaderElection('instance-1', 5000);
    const result1 = await election.tryAcquireLeadership();
    expect(result1.fencingToken).toBe(1);

    vi.advanceTimersByTime(3000);

    const result2 = await election.tryAcquireLeadership();
    expect(result2.isLeader).toBe(true);
    expect(result2.fencingToken).toBe(2);
  });

  it('should release leadership', async () => {
    const election1 = new MemoryLeaderElection('instance-1', 5000);
    await election1.tryAcquireLeadership();

    await election1.releaseLeadership();

    expect(election1.getIsLeader()).toBe(false);

    const election2 = new MemoryLeaderElection('instance-2', 5000);
    const result = await election2.tryAcquireLeadership();
    expect(result.isLeader).toBe(true);
  });

  it('should use monotonically increasing fencing tokens across acquisitions', async () => {
    const election1 = new MemoryLeaderElection('instance-1', 5000);
    const r1 = await election1.tryAcquireLeadership();
    expect(r1.fencingToken).toBe(1);

    await election1.releaseLeadership();

    const r2 = await election1.tryAcquireLeadership();
    expect(r2.fencingToken).toBe(2);

    await election1.releaseLeadership();

    const election2 = new MemoryLeaderElection('instance-2', 5000);
    const r3 = await election2.tryAcquireLeadership();
    expect(r3.fencingToken).toBe(3);
  });
});
