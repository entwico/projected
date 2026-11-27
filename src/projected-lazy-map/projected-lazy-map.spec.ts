import { describe, expect, it, vi } from 'vitest';

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

    const result1 = map.getByKey('1');

    expect(result1 instanceof Promise).toBe(true);

    await result1;

    const result2 = map.getByKey('1');

    expect(result2 instanceof Promise).toBe(false);
    expect(result2).toBe(testData[0]);
  });

  it('should return sync values when all cached (getByKeys)', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    await map.getByKeys(['1', '2', '3']);

    const result = map.getByKeys(['1', '2']);

    expect(result instanceof Promise).toBe(false);
    expect(result).toEqual([testData[0], testData[1]]);
  });

  it('should return async when some keys not cached (getByKeys)', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => testData.filter((item) => ids.includes(item.id)),
    });

    await map.getByKey('1');

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

    const initial = await map.getByKey('3');

    expect(initial?.title).toBe('title3-v1');
    expect(fetchCount).toBe(1);

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

    await map.getByKeys(['3', '4']);

    expect(fetchCount).toBe(1);

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

    const initial = await map.getByKey('3');

    expect(initial).toEqual(testData[2]);

    shouldFail = true;

    await expect(map.refresh('3')).rejects.toThrow('refresh error');

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

describe('batching', () => {
  function createMap(options?: { delay?: number; maxChunkSize?: number }) {
    const values = vi.fn((ids: string[]) => testData.filter((item) => ids.includes(item.id)));
    const map = new ProjectedLazyMap<string, TestObject>({ key: (item) => item.id, values, ...options });

    return { map, values };
  }

  it('should fetch the keys of all callers of one tick in one request, each key once', async () => {
    const { map, values } = createMap();

    const [one, same, many] = await Promise.all([
      map.getByKey('1'),
      map.getByKey('1'),
      map.getByKeys(['2', '1', '3', '3']),
    ]);

    expect(one).toBe(same);
    expect(many.map((item) => item.id)).toEqual(['2', '1', '3', '3']);
    expect(values.mock.calls).toEqual([[['1', '2', '3']]]);
  });

  it('should fetch only the keys that are not cached', async () => {
    const { map, values } = createMap();

    await map.getByKeys(['1', '2']);

    const result = await map.getByKeys(['1', '3', '2', '4']);

    expect(result.map((item) => item.id)).toEqual(['1', '3', '2', '4']);
    expect(values.mock.calls).toEqual([[['1', '2']], [['3', '4']]]);
  });

  it('should batch callers that arrive within the delay window', async () => {
    const { map, values } = createMap({ delay: 50 });

    const first = map.getByKey('1');

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = map.getByKey('2');

    expect(values).not.toHaveBeenCalled();

    expect(await first).toBe(testData[0]);
    expect(await second).toBe(testData[1]);
    expect(values.mock.calls).toEqual([[['1', '2']]]);
  });

  it('should fetch separately for callers of different ticks when there is no delay', async () => {
    const { map, values } = createMap();

    const first = map.getByKey('1');

    await new Promise((resolve) => setTimeout(resolve, 10));

    await map.getByKey('2');
    await first;

    expect(values.mock.calls).toEqual([[['1']], [['2']]]);
  });

  it('should split a batch into requests of at most maxChunkSize keys', async () => {
    const { map, values } = createMap({ maxChunkSize: 2 });

    const result = await map.getByKeys(['1', '2', '3', '4', '5']);

    expect(result.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(values.mock.calls.map(([keys]) => keys)).toEqual([['1', '2'], ['3', '4'], ['5']]);
  });
});

describe('errors', () => {
  it('should reject instead of throwing when values throws synchronously', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: () => {
        throw new Error('sync error');
      },
    });

    const result = map.getByKey('1');

    expect(result).toBeInstanceOf(Promise);

    await expect(result).rejects.toThrow('sync error');
  });

  it('should reject every caller of a failed batch', async () => {
    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: async () => {
        throw new Error('fetch error');
      },
    });

    const results = await Promise.allSettled([map.getByKey('1'), map.getByKeys(['2', '3']), map.refresh('4')]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('should fetch again after a failed fetch', async () => {
    const values = vi.fn<(ids: string[]) => Promise<TestObject[]>>()
      .mockRejectedValueOnce(new Error('fetch error'))
      .mockImplementation(async (ids) => testData.filter((item) => ids.includes(item.id)));

    const map = new ProjectedLazyMap<string, TestObject>({ key: (item) => item.id, values });

    await expect(map.getByKey('1')).rejects.toThrow('fetch error');

    expect(await map.getByKey('1')).toBe(testData[0]);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it('should not reject a caller whose keys were not part of the failed request', async () => {
    const requests: { keys: string[]; deferred: PromiseWithResolvers<TestObject[]> }[] = [];

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        const deferred = Promise.withResolvers<TestObject[]>();

        requests.push({ keys, deferred });

        return deferred.promise;
      },
    });

    const first = Promise.allSettled([map.getByKey('1')]);

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    const second = Promise.allSettled([map.getByKey('2')]);

    requests[0]!.deferred.reject(new Error('fetch error'));

    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests[1]!.deferred.resolve([testData[1]!]);

    expect(await first).toEqual([expect.objectContaining({ status: 'rejected' })]);
    expect(await second).toEqual([{ status: 'fulfilled', value: testData[1] }]);
  });
});

describe('invalidation', () => {
  function createMap(cache?: boolean) {
    const values = vi.fn((ids: string[]) => testData.filter((item) => ids.includes(item.id)));

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values,
      ...(cache !== undefined && { cache }),
    });

    return { map, values };
  }

  it('should fetch a deleted key again and keep the others', async () => {
    const { map, values } = createMap();

    await map.getByKeys(['1', '2']);

    map.delete('1');

    expect(map.getByKey('2')).toBe(testData[1]);
    expect(await map.getByKey('1')).toBe(testData[0]);
    expect(values.mock.calls).toEqual([[['1', '2']], [['1']]]);
  });

  it('should accept an array of keys to delete', async () => {
    const { map, values } = createMap();

    await map.getByKeys(['1', '2', '3']);

    map.delete(['1', '3']);

    expect(map.getByKey('2')).toBe(testData[1]);

    await map.getByKeys(['1', '2', '3']);

    expect(values.mock.calls).toEqual([[['1', '2', '3']], [['1', '3']]]);
  });

  it('should fetch everything again after clear', async () => {
    const { map, values } = createMap();

    await map.getByKeys(['1', '2']);

    map.clear();

    const result = map.getByKeys(['1', '2']);

    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual([testData[0], testData[1]]);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it('should serve the refreshed value synchronously afterwards', async () => {
    let version = 1;

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: (ids) => ids.map((id) => ({ id, title: `v${version}` })),
    });

    await map.getByKey('1');

    version = 2;

    await map.refresh('1');

    expect(map.getByKey('1')).toEqual({ id: '1', title: 'v2' });
  });

  it('should fetch on every read with cache: false', async () => {
    const { map, values } = createMap(false);

    expect(await map.getByKey('1')).toBe(testData[0]);
    expect(await map.refresh('1')).toBe(testData[0]);

    const again = map.getByKeys(['1']);

    expect(again).toBeInstanceOf(Promise);
    expect(await again).toEqual([testData[0]]);
    expect(values).toHaveBeenCalledTimes(3);
  });
});

describe('falsy values', () => {
  it('should return and cache falsy values', async () => {
    const values = vi.fn((keys: number[]) => keys);
    const map = new ProjectedLazyMap<number, number>({ key: (item) => item, values });

    expect(await map.getByKeysSparse([0, 1])).toEqual([0, 1]);
    expect(map.getByKey(0)).toBe(0);
    expect(values).toHaveBeenCalledTimes(1);
  });
});

describe('clear during a fetch', () => {
  function createMap() {
    const requests: PromiseWithResolvers<TestObject[]>[] = [];

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: () => {
        const request = Promise.withResolvers<TestObject[]>();

        requests.push(request);

        return request.promise;
      },
    });

    return { map, requests };
  }

  it.each([
    ['getByKey', (map: ProjectedLazyMap<string, TestObject>) => map.getByKey('1')],
    ['getByKeys', (map: ProjectedLazyMap<string, TestObject>) => map.getByKeys(['1'])],
    ['refresh', (map: ProjectedLazyMap<string, TestObject>) => map.refresh('1')],
  ])('should not cache what a %s fetched before the clear', async (_, read) => {
    const { map, requests } = createMap();

    const before = read(map);

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    map.clear();

    requests[0]!.resolve([{ id: '1', title: 'before clear' }]);

    // the caller that asked before the clear still gets its answer
    expect([await before].flat()).toEqual([{ id: '1', title: 'before clear' }]);

    const after = map.getByKey('1');

    expect(after).toBeInstanceOf(Promise);

    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests[1]!.resolve([{ id: '1', title: 'after clear' }]);

    expect(await after).toEqual({ id: '1', title: 'after clear' });
  });
});

describe('delete during a fetch', () => {
  function createMap() {
    const requests: PromiseWithResolvers<TestObject[]>[] = [];

    const map = new ProjectedLazyMap<string, TestObject>({
      key: (item) => item.id,
      values: () => {
        const request = Promise.withResolvers<TestObject[]>();

        requests.push(request);

        return request.promise;
      },
    });

    return { map, requests };
  }

  it.each([
    ['getByKey', (map: ProjectedLazyMap<string, TestObject>) => map.getByKey('1')],
    ['getByKeys', (map: ProjectedLazyMap<string, TestObject>) => map.getByKeys(['1'])],
    ['refresh', (map: ProjectedLazyMap<string, TestObject>) => map.refresh('1')],
  ])('should not cache what a %s fetched before the delete', async (_, read) => {
    const { map, requests } = createMap();

    const before = read(map);

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    map.delete('1');

    requests[0]!.resolve([{ id: '1', title: 'before delete' }]);

    // the caller that asked before the delete still gets its answer
    expect([await before].flat()).toEqual([{ id: '1', title: 'before delete' }]);

    const after = map.getByKey('1');

    expect(after).toBeInstanceOf(Promise);

    await vi.waitFor(() => expect(requests).toHaveLength(2));

    requests[1]!.resolve([{ id: '1', title: 'after delete' }]);

    expect(await after).toEqual({ id: '1', title: 'after delete' });
  });

  it('should still cache the other keys of the same fetch', async () => {
    const { map, requests } = createMap();

    const fetched = map.getByKeys(['1', '2', '3']);

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    map.delete(['1', '3']);

    requests[0]!.resolve(testData);

    await fetched;

    expect(map.getByKey('2')).toBe(testData[1]);
    expect(map.getByKey('1')).toBeInstanceOf(Promise);
    expect(map.getByKey('3')).toBeInstanceOf(Promise);
  });

  it('should cache a key again that was deleted before its fetch started', async () => {
    const { map, requests } = createMap();

    map.delete('1');

    const fetched = map.getByKey('1');

    await vi.waitFor(() => expect(requests).toHaveLength(1));

    requests[0]!.resolve(testData);

    await fetched;

    expect(map.getByKey('1')).toBe(testData[0]);
  });
});
