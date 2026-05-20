import { describe, expect, it } from 'vitest';

import { ProjectedValue, createProjectedValue } from './projected-value.js';

const testValue = { id: '1', title: 'title1' };

describe('sync behavior', () => {
  it('should return sync value when cached', async () => {
    const value = new ProjectedValue({
      value: () => testValue,
    });

    // first call - async (fetching)
    const result1 = value.get();

    expect(result1 instanceof Promise).toBe(true);

    await result1;

    // second call - sync (cached)
    const result2 = value.get();

    expect(result2 instanceof Promise).toBe(false);
    expect(result2).toBe(testValue);
  });

  it('should return promise from refresh', async () => {
    const value = new ProjectedValue({
      value: () => testValue,
    });

    // refresh always returns a promise
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

    // populate cache
    const initial = await value.get();

    expect(initial.title).toBe('title1');
    expect(fetchCount).toBe(1);

    // refresh resolves to fresh value
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

    // populate cache
    const initial = await value.get();

    expect(initial).toEqual(testValue);

    // make next fetch fail
    shouldFail = true;

    // refresh should reject
    await expect(value.refresh()).rejects.toThrow('refresh error');

    // cache should still have the original value
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

    // populate cache
    await value.get();

    expect(fetchCount).toBe(1);

    // call refresh multiple times - all return same promise
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
