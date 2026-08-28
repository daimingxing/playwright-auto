import { describe, expect, it } from 'vitest';
import { MAX_EXPLORATION_WORKERS, createExplorationCoordinator } from '../../server/src/services/import/exploration-lease';

describe('Exploration Lease', () => {
  it('同一租约同时只有一个持有者，等待者在释放后继续', async () => {
    const coordinator = createExplorationCoordinator();
    const log: string[] = [];
    let releaseHolder!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    const first = coordinator.withLease('crm/default/page-a', async () => {
      log.push('holder-start');
      await held;
      log.push('holder-end');
      return 'first';
    });
    await waitUntil(() => log.includes('holder-start'));

    let waiterStarted = false;
    const second = coordinator.withLease('crm/default/page-a', async () => {
      waiterStarted = true;
      log.push('waiter');
      return 'second';
    });

    await wait(20);
    expect(waiterStarted).toBe(false);

    releaseHolder();
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    expect(log).toEqual(['holder-start', 'holder-end', 'waiter']);
  });

  it('不同租约可以并行，worker 不超过 4 个', async () => {
    const coordinator = createExplorationCoordinator();
    let peak = 0;
    const jobs = Array.from({ length: 6 }, (_, index) =>
      coordinator.withWorker(async () => {
        peak = Math.max(peak, coordinator.activeWorkers);
        await wait(40);
        return index;
      })
    );

    await Promise.all(jobs);
    expect(peak).toBe(MAX_EXPLORATION_WORKERS);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

/**
 * 等待条件成立或超时。
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 500) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('等待条件超时');
    }

    await wait(5);
  }
}

/**
 * 短暂等待。
 */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
