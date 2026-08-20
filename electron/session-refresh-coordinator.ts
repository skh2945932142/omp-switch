export interface RefreshExecution<T> {
  response: Promise<T>;
  complete: Promise<T>;
  completeIsForced: boolean;
}

interface ActiveRefresh<T> {
  complete: Promise<T>;
  completeIsForced: boolean;
  forced?: Promise<T>;
}

/** Coalesces normal refreshes while preserving an explicit request for a forced rebuild. */
export class SessionRefreshCoordinator<T> {
  private readonly active = new Map<string, ActiveRefresh<T>>();

  run(key: string, force: boolean, start: (force: boolean) => RefreshExecution<T>): Promise<T> {
    const current = this.active.get(key);
    if (current) {
      if (force && !current.completeIsForced) return this.queueForced(key, current, start);
      return current.forced ?? current.complete;
    }

    let execution: RefreshExecution<T>;
    try {
      execution = start(force);
    } catch (error) {
      return Promise.reject(error);
    }
    const task: ActiveRefresh<T> = {
      complete: execution.complete,
      completeIsForced: execution.completeIsForced,
    };
    this.active.set(key, task);
    void execution.complete.then(
      () => { if (!task.forced && this.active.get(key) === task) this.active.delete(key); },
      () => { if (!task.forced && this.active.get(key) === task) this.active.delete(key); },
    );
    return execution.response;
  }

  private queueForced(key: string, task: ActiveRefresh<T>, start: (force: boolean) => RefreshExecution<T>): Promise<T> {
    if (!task.forced) {
      const startForced = (): Promise<T> => start(true).complete;
      task.forced = task.complete.then(startForced, startForced);
      void task.forced.then(
        () => { if (this.active.get(key) === task) this.active.delete(key); },
        () => { if (this.active.get(key) === task) this.active.delete(key); },
      );
    }
    return task.forced;
  }
}
