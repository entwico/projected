import { describe, expect, it } from 'vitest';

import { ProjectedMap, createProjectedMap } from './projected-map.js';

const testData = [
  { id: '1', title: 'title1' },
  { id: '2', title: 'title2' },
  { id: '3', title: 'title3' },
  { id: '4', title: 'title4' },
  { id: '5', title: 'title5' },
];

type TestObject = (typeof testData)[0];

describe('sync behavior', () => {
  it('should return sync value when cached', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    // first call - async (fetching)
    const result1 = map.getByKey('1');

    expect(result1 instanceof Promise).toBe(true);

    await result1;

    // second call - sync (cached)
    const result2 = map.getByKey('1');

    expect(result2 instanceof Promise).toBe(false);
    expect(result2).toBe(testData[0]);
  });

  it('should return sync values for all get methods when cached', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    // populate cache
    await map.getByKey('1');

    // all methods should be sync now
    expect(map.getByKey('2') instanceof Promise).toBe(false);
    expect(map.getByKeys(['1', '2']) instanceof Promise).toBe(false);
    expect(map.getByKeysSparse(['1', '2']) instanceof Promise).toBe(false);
    expect(map.getAll() instanceof Promise).toBe(false);
    expect(map.getAllAsMap() instanceof Promise).toBe(false);
    expect(map.get('1') instanceof Promise).toBe(false);
    expect(map.get(['1', '2']) instanceof Promise).toBe(false);
  });

  it('should return promise from refresh', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    // refresh always returns a promise
    const result = map.refresh();

    expect(result instanceof Promise).toBe(true);

    await result;
  });
});

it('should create map with createProjectedMap', () => {
  const map = createProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => testData,
  });

  expect(map).toBeTruthy();
  expect(map).toBeInstanceOf(ProjectedMap);
});

it('should fetch one', async () => {
  const map = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => testData,
  });

  expect(map).toBeTruthy();

  const res = await map.getByKey('3');

  expect(res).toBeTruthy();
  expect(res?.title).toBe('title3');
});

it('shouldn\'t get many if keys array is empty', async () => {
  const projectedMap = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => Promise.resolve(testData),
  });

  expect(projectedMap).toBeTruthy();

  const res = await projectedMap.getByKeys([]);

  expect(res.length).toBe(0);
});

it('should fetch many', async () => {
  const projectedMap = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => Promise.resolve(testData),
  });

  expect(projectedMap).toBeTruthy();

  const res = await projectedMap.getByKeys(['4', '3', '5']);

  expect(res.length).toBe(3);

  expect(res[0]).toBeTruthy();
  expect(res[0]!.id).toBe('4');
  expect(res[0]!.title).toBe('title4');
  expect(res[1]).toBeTruthy();
  expect(res[1]!.id).toBe('3');
  expect(res[1]!.title).toBe('title3');
  expect(res[2]).toBeTruthy();
  expect(res[2]!.id).toBe('5');
  expect(res[2]!.title).toBe('title5');
});

it('should return sparse arrays', async () => {
  const projectedMap = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => Promise.resolve(testData),
  });

  expect(projectedMap).toBeTruthy();

  const sparse = await projectedMap.getByKeysSparse(['4', '6', '5']);

  expect(sparse.length).toBe(3);

  expect(sparse[0]).toBeTruthy();
  expect(sparse[0]!.id).toBe('4');
  expect(sparse[0]!.title).toBe('title4');
  expect(sparse[1]).toBeUndefined();
  expect(sparse[2]).toBeTruthy();
  expect(sparse[2]!.id).toBe('5');
  expect(sparse[2]!.title).toBe('title5');

  const dense = await projectedMap.getByKeys(['4', '6', '5']);

  expect(dense.length).toBe(2);

  expect(dense[0]).toBeTruthy();
  expect(dense[0]!.id).toBe('4');
  expect(dense[0]!.title).toBe('title4');
  expect(dense[1]).toBeTruthy();
  expect(dense[1]!.id).toBe('5');
  expect(dense[1]!.title).toBe('title5');
});

it('should propagate errors', async () => {
  const projectedMap = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: async () => {
      throw new Error('fetch error');
    },
  });

  expect(projectedMap).toBeTruthy();

  await expect(projectedMap.getByKey('3')).rejects.toThrow('fetch error');
  await expect(projectedMap.getByKeys(['3', '4'])).rejects.toThrow('fetch error');
});

it('should implement mixed get method', async () => {
  const projectedMap = new ProjectedMap<string, TestObject>({
    key: (item) => item.id,
    values: () => Promise.resolve(testData),
  });

  const one = await projectedMap.get('3');
  const many = await projectedMap.get(['4', '6', '5']);

  expect(one).toBeTruthy();
  expect(one!.id).toBe('3');

  expect(many[0]).toBeTruthy();
  expect(many[0]!.id).toBe('4');
  expect(many[0]!.title).toBe('title4');
  expect(many[1]).toBeTruthy();
  expect(many[1]!.id).toBe('5');
  expect(many[1]!.title).toBe('title5');
});

describe('refresh', () => {
  it('should fetch and resolve to fresh map when nothing is cached', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    const fresh = await map.refresh();

    expect(fresh.size).toBe(5);
  });

  it('should resolve to fresh map after fetch completes', async () => {
    let fetchCount = 0;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => {
        fetchCount++;

        return testData.map((item) => ({ ...item, title: `${item.title}-v${fetchCount}` }));
      },
    });

    // populate cache
    const initial = await map.getByKey('1');

    expect(initial?.title).toBe('title1-v1');
    expect(fetchCount).toBe(1);

    // refresh resolves to fresh map
    const fresh = await map.refresh();

    expect(fresh.get('1')?.title).toBe('title1-v2');
    expect(fetchCount).toBe(2);
  });

  it('should keep stale value on refresh error and reject promise', async () => {
    let shouldFail = false;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => {
        if (shouldFail) {
          throw new Error('refresh error');
        }

        return testData;
      },
    });

    // populate cache
    const initial = await map.getByKey('1');

    expect(initial).toEqual(testData[0]);

    // make next fetch fail
    shouldFail = true;

    // refresh should reject
    await expect(map.refresh()).rejects.toThrow('refresh error');

    // cache should still have the original value
    const afterError = await map.getByKey('1');

    expect(afterError).toEqual(testData[0]);
  });

  it('should not trigger multiple fetches when called multiple times', async () => {
    let fetchCount = 0;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));

        return testData;
      },
    });

    // populate cache
    await map.getByKey('1');

    expect(fetchCount).toBe(1);

    // call refresh multiple times - all return same promise
    const p1 = map.refresh();
    const p2 = map.refresh();
    const p3 = map.refresh();

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await p1;

    // should only have fetched twice (initial + one refresh)
    expect(fetchCount).toBe(2);
  });
});
