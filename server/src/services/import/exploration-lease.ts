export const MAX_EXPLORATION_WORKERS = 4;

/**
 * 探索租约与 worker 名额。同一租约同时只有一个持有者；不同页面最多 4 个 worker。
 */
export function createExplorationCoordinator(maxWorkers = MAX_EXPLORATION_WORKERS) {
  return new ExplorationCoordinator(maxWorkers);
}

/**
 * 进程内探索租约协调器。每个应用实例各自一份，测试互不抢锁。
 */
export class ExplorationCoordinator {
  private readonly leases = new Map<string, LeaseGate>();
  private running = 0;
  private readonly workerWaiters: Array<() => void> = [];

  constructor(private readonly maxWorkers: number) {}

  /**
   * 占用探索租约。同一 key 同时只有一个函数执行，其它调用排队等待后继续。
   */
  async withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const gate = this.leases.get(key) ?? new LeaseGate();
    this.leases.set(key, gate);
    await gate.acquire();

    try {
      return await fn();
    } finally {
      gate.release();
      if (!gate.busy) {
        this.leases.delete(key);
      }
    }
  }

  /**
   * 占用一个隔离 worker 名额，超出上限时等待。
   */
  async withWorker<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireWorker();

    try {
      return await fn();
    } finally {
      this.releaseWorker();
    }
  }

  /**
   * 当前正在执行的 worker 数量，供并行上限测试观察。
   */
  get activeWorkers() {
    return this.running;
  }

  /**
   * 申请 worker 名额。
   */
  private acquireWorker() {
    if (this.running < this.maxWorkers) {
      this.running += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.workerWaiters.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  /**
   * 归还 worker 名额并唤醒等待者。
   */
  private releaseWorker() {
    this.running -= 1;
    const next = this.workerWaiters.shift();
    next?.();
  }
}

/**
 * 单个租约的互斥门闩。
 */
class LeaseGate {
  busy = false;
  private readonly waiters: Array<() => void> = [];

  /**
   * 成为持有者，或等到前一个持有者释放。
   */
  acquire() {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.busy = true;
        resolve();
      });
    });
  }

  /**
   * 释放租约并唤醒下一个等待者。
   */
  release() {
    const next = this.waiters.shift();

    if (next) {
      next();
      return;
    }

    this.busy = false;
  }
}
