import { describe, expect, it, vi } from 'vitest';

import { ProjectedValue, createProjectedValue } from './projected-value.js';

const testValue = { id: '1', title: 'title1' };

describe('sync behavior', () => {
  it('should return sync value when cached', async () => {
    const value = new ProjectedValue({
      value: () => testValue,
    });

    const result1 = value.get();

    expect(result1 instanceof Promise).toBe(true);

    await result1;

    const result2 = value.get();

    expect(result2 instanceof Promise).toBe(false);
    expect(result2).toBe(testValue);
  });

  it('should return promise from refresh', async () => {
    const value = new ProjectedValue({
      value: () => testValue,
    });

    const result = value.refresh();

    expect(result instanceof Promise).toBe(true);

    await result;
  });
});

it('should create value with createProjectedValue', () => {
  const value = createProjectedValue({
    value: () => testValue,
  });

  expect(value).toBeTruthy();
  expect(value).toBeInstanceOf(ProjectedValue);
});

it('should implement get', async () => {
  const value = new ProjectedValue({
    value: () => testValue,
  });

  expect(value).toBeTruthy();

  const res = await value.get();

  expect(res).toEqual({ id: '1', title: 'title1' });
});

it('should allow undefined as a return value', async () => {
  const value = new ProjectedValue({
    value: () => {},
  });

  const res = await value.get();

  expect(res).toBe(undefined);
});

it('should implement clear', async () => {
  const value = new ProjectedValue({
    value: () => structuredClone(testValue),
  });

  const res1 = await value.get();

  expect(res1).toEqual({ id: '1', title: 'title1' });

  const res2 = await value.get();

  // same object
  expect(res2).toBe(res1);

  value.clear();

  const res3 = await value.get();

  // new object same value
  expect(res1).toEqual({ id: '1', title: 'title1' });
  expect(res3).not.toBe(res1);
});

it('should propagate errors', async () => {
  const projectedValue = new ProjectedValue({
    value: async () => {
      throw new Error('fetch error');
    },
  });

  expect(projectedValue).toBeTruthy();

  await expect(projectedValue.get()).rejects.toThrow('fetch error');
});

describe('refresh', () => {
  it('should fetch and resolve to fresh value when nothing is cached', async () => {
    const value = new ProjectedValue({
      value: () => testValue,
    });

    const fresh = await value.refresh();

    expect(fresh).toEqual(testValue);
  });

  it('should resolve to fresh value after fetch completes', async () => {
    let fetchCount = 0;

    const value = new ProjectedValue({
      value: () => {
        fetchCount++;

        return { id: '1', title: `title${fetchCount}` };
      },
    });

    const initial = await value.get();

    expect(initial.title).toBe('title1');
    expect(fetchCount).toBe(1);

    const fresh = await value.refresh();

    expect(fresh.title).toBe('title2');
    expect(fetchCount).toBe(2);
  });

  it('should keep stale value on refresh error and reject promise', async () => {
    let shouldFail = false;

    const value = new ProjectedValue({
      value: () => {
        if (shouldFail) {
          throw new Error('refresh error');
        }

        return testValue;
      },
    });

    const initial = await value.get();

    expect(initial).toEqual(testValue);

    shouldFail = true;

    await expect(value.refresh()).rejects.toThrow('refresh error');

    const afterError = await value.get();

    expect(afterError).toBe(initial);
  });

  it('should not trigger multiple fetches when called multiple times', async () => {
    let fetchCount = 0;

    const value = new ProjectedValue({
      value: async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));

        return { id: '1', title: `title${fetchCount}` };
      },
    });

    await value.get();

    expect(fetchCount).toBe(1);

    const p1 = value.refresh();
    const p2 = value.refresh();
    const p3 = value.refresh();

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await p1;

    // should only have fetched twice (initial + one refresh)
    expect(fetchCount).toBe(2);
  });
});

describe('fetching', () => {
  it('should share one fetch between concurrent get calls', async () => {
    const fetch = vi.fn(async () => structuredClone(testValue));
    const value = new ProjectedValue({ value: fetch });

    const first = value.get();
    const second = value.get();

    expect(second).toBe(first);

    await first;

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should reject instead of throwing when the value function throws synchronously', async () => {
    const value = new ProjectedValue({
      value: (): typeof testValue => {
        throw new Error('sync error');
      },
    });

    const result = value.get();

    expect(result).toBeInstanceOf(Promise);

    await expect(result).rejects.toThrow('sync error');
  });

  it('should fetch again after a failed fetch', async () => {
    const fetch = vi.fn<() => Promise<typeof testValue>>()
      .mockRejectedValueOnce(new Error('fetch error'))
      .mockResolvedValue(testValue);

    const value = new ProjectedValue({ value: fetch });

    await expect(value.get()).rejects.toThrow('fetch error');

    expect(await value.get()).toBe(testValue);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([0, '', false, null])('should cache the falsy value %j', async (falsy) => {
    const fetch = vi.fn(() => falsy);
    const value = new ProjectedValue({ value: fetch });

    await value.get();

    expect(value.get()).toBe(falsy);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('cache: false', () => {
  it('should fetch on every get', async () => {
    const fetch = vi.fn(() => structuredClone(testValue));
    const value = new ProjectedValue({ value: fetch, cache: false });

    const first = await value.get();
    const second = value.get();

    expect(second).toBeInstanceOf(Promise);
    expect(await second).not.toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should resolve refresh to the fresh value without keeping it', async () => {
    const fetch = vi.fn(() => structuredClone(testValue));
    const value = new ProjectedValue({ value: fetch, cache: false });

    expect(await value.refresh()).toEqual(testValue);
    expect(value.get()).toBeInstanceOf(Promise);
  });
});

describe('stale-while-revalidate', () => {
  it('should serve the stale value synchronously while a refresh is in flight', async () => {
    const pending = Promise.withResolvers<string>();
    const fetch = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce('stale')
      .mockReturnValueOnce(pending.promise);

    const value = new ProjectedValue({ value: fetch });

    await value.get();

    const refresh = value.refresh();

    expect(value.get()).toBe('stale');

    pending.resolve('fresh');

    await refresh;

    expect(value.get()).toBe('fresh');
  });

  it('should fetch again on get after clear, even though a value was cached', async () => {
    const fetch = vi.fn(() => structuredClone(testValue));
    const value = new ProjectedValue({ value: fetch });

    await value.get();

    value.clear();

    expect(value.get()).toBeInstanceOf(Promise);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('fetches that were overtaken', () => {
  function createValue() {
    const requests: PromiseWithResolvers<string>[] = [];

    const value = new ProjectedValue({
      value: () => {
        const request = Promise.withResolvers<string>();

        requests.push(request);

        return request.promise;
      },
    });

    return { value, requests };
  }

  it('should not cache what was fetched before a clear', async () => {
    const { value, requests } = createValue();

    const before = value.get();

    value.clear();

    const after = value.get();

    requests[0]!.resolve('before clear');

    // the caller that asked before the clear still gets its answer
    expect(await before).toBe('before clear');
    expect(value.get()).toBe(after);

    requests[1]!.resolve('after clear');

    expect(await after).toBe('after clear');
    expect(value.get()).toBe('after clear');
  });

  it('should keep the value fetched after a clear when the earlier fetch answers last', async () => {
    const { value, requests } = createValue();

    const before = value.get();

    value.clear();

    const after = value.get();

    requests[1]!.resolve('after clear');
    await after;

    requests[0]!.resolve('before clear');
    await before;

    expect(value.get()).toBe('after clear');
  });

  it('should stay empty when the fetch from before a clear fails', async () => {
    const { value, requests } = createValue();

    const before = value.get();

    value.clear();

    const after = value.get();

    requests[0]!.reject(new Error('fetch error'));

    await expect(before).rejects.toThrow('fetch error');

    expect(value.get()).toBe(after);

    requests[1]!.resolve('after clear');

    expect(await after).toBe('after clear');
  });

  it('should keep the refreshed value when the fetch it overtook answers last', async () => {
    const { value, requests } = createValue();

    const initial = value.get();
    const refreshed = value.refresh();

    requests[1]!.resolve('refreshed');
    await refreshed;

    requests[0]!.resolve('initial');
    await initial;

    expect(value.get()).toBe('refreshed');
  });
});
