import { describe, expect, it } from 'vitest';

import { ProjectedLazyMap, createProjectedLazyMap } from './projected-lazy-map.js';

const testData = [
  { id: '1', title: 'title1' },
  { id: '2', title: 'title2' },
  { id: '3', title: 'title3' },
  { id: '4', title: 'title4' },
  { id: '5', title: 'title5' },
];

type TestObject = (typeof testData)[0];

describe('sync behavior', () => {
  it('should return sync value when cached (getByKey)', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
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

  it('should return sync values when all cached (getByKeys)', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    // populate cache
    await map.getByKeys(['1', '2', '3']);

    // all cached - should be sync
    const result = map.getByKeys(['1', '2']);

    expect(result instanceof Promise).toBe(false);
    expect(result).toEqual([testData[0], testData[1]]);
  });

  it('should return async when some keys not cached (getByKeys)', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    // populate cache with only '1'
    await map.getByKey('1');

    // '2' not cached - should be async
    const result = map.getByKeys(['1', '2']);

    expect(result instanceof Promise).toBe(true);

    const values = await result;

    expect(values).toEqual([testData[0], testData[1]]);
  });

  it('should return promise from refresh', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    // refresh always returns a promise
    const result = map.refresh('1');

    expect(result instanceof Promise).toBe(true);

    await result;
  });
});

describe('fetcher', () => {
  it('should create map with createProjectedLazyMap', () => {
    const map = createProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    expect(map).toBeTruthy();
    expect(map).toBeInstanceOf(ProjectedLazyMap);
  });

  it('should fetch one', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
      delay: 1000,
    });

    expect(map).toBeTruthy();

    const res = await map.getByKey('3');

    expect(res).toBeTruthy();
    expect(res?.title).toBe('title3');
  });

  it('should fetch one (buffered)', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    expect(projectedMap).toBeTruthy();

    const res = await projectedMap.getByKey('3');

    expect(res).toBeTruthy();
    expect(res?.title).toBe('title3');
  });

  it('shouldn\'t get many if keys array is empty', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    expect(projectedMap).toBeTruthy();

    const res = await projectedMap.getByKeys([]);

    expect(res.length).toBe(0);
  });

  it('should fetch many', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
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

  it('should fetch many (buffered)', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
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

  it('should fetch many (buffered) with multiple parallel fetches', async () => {
    const delays = [500, 200];

    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => {
        const delay = delays.shift();

        await new Promise((resolve) => setTimeout(resolve, delay));

        return testData.filter((item) => ids.includes(item.id));
      },
      delay: 1000,
      maxChunkSize: 2,
    });

    expect(projectedMap).toBeTruthy();

    const [res1, res2] = await Promise.all([
      projectedMap.getByKeys(['4', '3', '5']),
      projectedMap.getByKeys(['2', '3', '1']),
    ]);

    expect(res1.length).toBe(3);

    expect(res1[0]).toBeTruthy();
    expect(res1[0]!.id).toBe('4');
    expect(res1[0]!.title).toBe('title4');
    expect(res1[1]).toBeTruthy();
    expect(res1[1]!.id).toBe('3');
    expect(res1[1]!.title).toBe('title3');
    expect(res1[2]).toBeTruthy();
    expect(res1[2]!.id).toBe('5');
    expect(res1[2]!.title).toBe('title5');

    expect(res2.length).toBe(3);

    expect(res2[0]).toBeTruthy();
    expect(res2[0]!.id).toBe('2');
    expect(res2[0]!.title).toBe('title2');
    expect(res2[1]).toBeTruthy();
    expect(res2[1]!.id).toBe('3');
    expect(res2[1]!.title).toBe('title3');
    expect(res2[2]).toBeTruthy();
    expect(res2[2]!.id).toBe('1');
    expect(res2[2]!.title).toBe('title1');
  });

  it('should return sparse arrays', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
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
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => {
        throw new Error(`fetch error ${ids.join(',')}`);
      },
    });

    expect(projectedMap).toBeTruthy();

    await expect(projectedMap.getByKey('3')).rejects.toThrow('fetch error 3');
    await expect(projectedMap.getByKeys(['3', '4'])).rejects.toThrow('fetch error 3,4');
  });

  it('should implement mixed get method', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
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
});

describe('cache', () => {
  it('should create a fully functional cache by default', async () => {
    const projectedMap = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    expect(projectedMap).toBeTruthy();

    const res = await projectedMap.getByKey('3');

    expect(res).toBeTruthy();
    expect(res?.title).toBe('title3');

    // expect(cache).toBeTruthy();

    // // because it's a noop cache
    // expect(cache.has('3')).toBeFalsy();
    // expect(cache.get('3')).toBeUndefined();
    // expect(() => cache.delete('3')).not.toThrow();
    // expect(() => cache.clear()).not.toThrow();
  });

  it('should use custom cache', async () => {
    const cache = new Map();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
      delay: 1000,
      cache,
    });

    expect(map).toBeTruthy();

    const res = await map.getByKey('3');

    expect(res).toBeTruthy();
    expect(res?.title).toBe('title3');

    expect(cache.has('3')).toBeTruthy();

    const res2 = await map.getByKey('3');

    expect(res2).toBeTruthy();
    expect(res2?.title).toBe('title3');

    cache.delete('3');

    expect(cache.has('3')).toBeFalsy();
    expect(cache.get('3')).toBeUndefined();

    const res3 = await map.getByKey('3');

    expect(res3).toBeTruthy();
    expect(res3?.title).toBe('title3');

    const res4 = await map.getByKeys(['3', '4', '5']);

    expect(res4.length).toBe(3);

    expect(res4[0]).toBeTruthy();
    expect(res4[0]!.id).toBe('3');
    expect(res4[0]!.title).toBe('title3');
    expect(res4[1]).toBeTruthy();
    expect(res4[1]!.id).toBe('4');
    expect(res4[1]!.title).toBe('title4');
    expect(res4[2]).toBeTruthy();
    expect(res4[2]!.id).toBe('5');
    expect(res4[2]!.title).toBe('title5');

    expect(cache.has('3')).toBeTruthy();
    expect(cache.has('4')).toBeTruthy();
    expect(cache.has('5')).toBeTruthy();
  });

  it('should not cache not found items', async () => {
    const cache = new Map();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
      delay: 1000,
      cache,
    });

    const many = await map.getByKeys(['3', '7', '6', '5']);

    expect(many.length).toBe(2);

    const one = await map.getByKey('8');

    expect(one).toBeUndefined();

    expect(cache.has('3')).toBeTruthy();
    expect(cache.has('5')).toBeTruthy();
    expect(cache.has('6')).toBeFalsy();
    expect(cache.has('7')).toBeFalsy();
    expect(cache.has('8')).toBeFalsy();
  });

  it('should not perform handle if all keys are found in cache', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
      delay: 1000,
      cache: new Map(),
    });

    const cacheMissed = await map.getByKeys(['3', '4', '5']);

    expect(cacheMissed.length).toBe(3);

    const cacheHits = await map.getByKeys(['3', '4', '5']);

    expect(cacheHits.length).toBe(3);
  });
});

describe('refresh', () => {
  it('should fetch and resolve to fresh value for uncached key', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    const fresh = await map.refresh('3');

    expect(fresh).toEqual(testData[2]);
  });

  it('should resolve to fresh value for single key', async () => {
    let fetchCount = 0;
    const cache = new Map<string, TestObject>();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => {
        fetchCount++;

        return testData
          .filter((item) => ids.includes(item.id))
          .map((item) => ({ ...item, title: `${item.title}-v${fetchCount}` }));
      },
      cache,
    });

    // populate cache
    const initial = await map.getByKey('3');

    expect(initial?.title).toBe('title3-v1');
    expect(fetchCount).toBe(1);

    // refresh resolves to fresh value
    const fresh = await map.refresh('3');

    expect(fresh?.title).toBe('title3-v2');
    expect(fetchCount).toBe(2);
  });

  it('should resolve to fresh values for multiple keys', async () => {
    let fetchCount = 0;
    const cache = new Map<string, TestObject>();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => {
        fetchCount++;

        return testData
          .filter((item) => ids.includes(item.id))
          .map((item) => ({ ...item, title: `${item.title}-v${fetchCount}` }));
      },
      cache,
    });

    // populate cache
    await map.getByKeys(['3', '4']);

    expect(fetchCount).toBe(1);

    // refresh resolves to fresh values
    const fresh = await map.refresh(['3', '4', '5']);

    expect(fresh.length).toBe(3);
    expect(fresh[0]?.title).toBe('title3-v2');
    expect(fresh[1]?.title).toBe('title4-v2');
    expect(fresh[2]?.title).toBe('title5-v2');
    expect(fetchCount).toBe(2);
  });

  it('should keep stale value on refresh error and reject promise', async () => {
    let shouldFail = false;
    const cache = new Map<string, TestObject>();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => {
        if (shouldFail) {
          throw new Error('refresh error');
        }

        return testData.filter((item) => ids.includes(item.id));
      },
      cache,
    });

    // populate cache
    const initial = await map.getByKey('3');

    expect(initial).toEqual(testData[2]);

    // make next fetch fail
    shouldFail = true;

    // refresh should reject
    await expect(map.refresh('3')).rejects.toThrow('refresh error');

    // cache should still have the original value
    expect(cache.get('3')).toEqual(testData[2]);
  });

  it('should evict cache entry when refresh returns nothing for a single key', async () => {
    let liveIds = ['1', '2', '3'];
    const cache = new Map<string, TestObject>();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id) && liveIds.includes(item.id)),
      cache,
    });

    await map.getByKey('2');

    expect(cache.has('2')).toBe(true);

    // upstream deletes '2'
    liveIds = ['1', '3'];

    const fresh = await map.refresh('2');

    expect(fresh).toBeUndefined();
    expect(cache.has('2')).toBe(false);
  });

  it('should evict cache entries when refresh returns nothing for some of the requested keys', async () => {
    let liveIds = ['1', '2', '3'];
    const cache = new Map<string, TestObject>();

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id) && liveIds.includes(item.id)),
      cache,
    });

    await map.getByKeys(['1', '2', '3']);

    expect(cache.has('1')).toBe(true);
    expect(cache.has('2')).toBe(true);
    expect(cache.has('3')).toBe(true);

    // upstream deletes '2'
    liveIds = ['1', '3'];

    const fresh = await map.refresh(['1', '2', '3']);

    expect(fresh[0]).toBeTruthy();
    expect(fresh[1]).toBeUndefined();
    expect(fresh[2]).toBeTruthy();

    expect(cache.has('1')).toBe(true);
    expect(cache.has('2')).toBe(false);
    expect(cache.has('3')).toBe(true);
  });

  it('should no-op on refresh([])', async () => {
    let callCount = 0;

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => {
        callCount++;

        return testData.filter((item) => ids.includes(item.id));
      },
    });

    const fresh = await map.refresh([]);

    expect(fresh).toEqual([]);
    expect(callCount).toBe(0);
  });
});
