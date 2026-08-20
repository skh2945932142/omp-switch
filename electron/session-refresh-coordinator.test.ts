import { describe, expect, it } from "vitest";
import { SessionRefreshCoordinator } from "./session-refresh-coordinator";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("SessionRefreshCoordinator", () => {
  it("merges concurrent normal refreshes into one task", async () => {
    const coordinator = new SessionRefreshCoordinator<string>();
    const pending = deferred<string>();
    let starts = 0;
    const start = (force: boolean) => {
      starts += 1;
      expect(force).toBe(false);
      return { response: pending.promise, complete: pending.promise, completeIsForced: false };
    };

    const first = coordinator.run("default", false, start);
    const second = coordinator.run("default", false, start);
    expect(starts).toBe(1);
    pending.resolve("indexed");
    await expect(first).resolves.toBe("indexed");
    await expect(second).resolves.toBe("indexed");
  });

  it("runs a requested forced rebuild after an active incremental refresh", async () => {
    const coordinator = new SessionRefreshCoordinator<string>();
    const normal = deferred<string>();
    const forced = deferred<string>();
    const starts: boolean[] = [];
    const start = (force: boolean) => {
      starts.push(force);
      const promise = force ? forced.promise : normal.promise;
      return { response: promise, complete: promise, completeIsForced: force };
    };

    const incremental = coordinator.run("default", false, start);
    const rebuild = coordinator.run("default", true, start);
    expect(starts).toEqual([false]);
    normal.resolve("incremental");
    await expect(incremental).resolves.toBe("incremental");
    await Promise.resolve();
    expect(starts).toEqual([false, true]);
    forced.resolve("rebuilt");
    await expect(rebuild).resolves.toBe("rebuilt");
  });

  it("does not queue a second rebuild behind an initial full index", async () => {
    const coordinator = new SessionRefreshCoordinator<string>();
    const quick = deferred<string>();
    const complete = deferred<string>();
    let starts = 0;
    const start = () => {
      starts += 1;
      return { response: quick.promise, complete: complete.promise, completeIsForced: true };
    };

    const first = coordinator.run("default", false, start);
    const rebuild = coordinator.run("default", true, start);
    quick.resolve("quick");
    complete.resolve("complete");
    await expect(first).resolves.toBe("quick");
    await expect(rebuild).resolves.toBe("complete");
    expect(starts).toBe(1);
  });
});
