import { describe, expect, it, vi } from 'vitest';

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

describe('partial refresh', () => {
  it('should call values with the requested keys', async () => {
    const calls: (string[] | undefined)[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        calls.push(keys);

        if (keys === undefined) {
          return testData;
        }

        return testData.filter((item) => keys.includes(item.id));
      },
    });

    await map.refresh();

    expect(calls).toEqual([undefined]);

    await map.refresh(['2', '3']);

    expect(calls).toEqual([undefined, ['2', '3']]);
  });

  it('should upsert returned entries into the resolved map', async () => {
    let version = 1;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        const items = keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));

        return items.map((item) => ({ ...item, title: `${item.title}-v${version}` }));
      },
    });

    await map.refresh();

    expect((map.getByKey('1') as TestObject).title).toBe('title1-v1');
    expect((map.getByKey('2') as TestObject).title).toBe('title2-v1');

    version = 2;

    await map.refresh(['2']);

    // only '2' is refreshed
    expect((map.getByKey('1') as TestObject).title).toBe('title1-v1');
    expect((map.getByKey('2') as TestObject).title).toBe('title2-v2');
  });

  it('should delete requested keys that are missing from the result', async () => {
    let liveIds = ['1', '2', '3', '4', '5'];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        const pool = testData.filter((i) => liveIds.includes(i.id));

        return keys === undefined ? pool : pool.filter((i) => keys.includes(i.id));
      },
    });

    await map.refresh();

    expect((map.getAll() as TestObject[]).map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']);

    // upstream deletes '2' and '4'
    liveIds = ['1', '3', '5'];

    await map.refresh(['2', '4']);

    // '2' and '4' should be gone; '1', '3', '5' still there
    expect(map.getByKey('2') as unknown).toBeUndefined();
    expect(map.getByKey('4') as unknown).toBeUndefined();
    expect((map.getByKey('1') as TestObject).id).toBe('1');
    expect((map.getByKey('3') as TestObject).id).toBe('3');
    expect((map.getByKey('5') as TestObject).id).toBe('5');
  });

  it('should add newly created keys via partial refresh', async () => {
    let pool: TestObject[] = [...testData];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => (keys === undefined ? pool : pool.filter((i) => keys.includes(i.id))),
    });

    await map.refresh();

    expect(map.getByKey('6')).toBeUndefined();

    pool = [...pool, { id: '6', title: 'title6' }];

    await map.refresh(['6']);

    expect((map.getByKey('6') as TestObject).title).toBe('title6');
  });

  it('should accept single-key form', async () => {
    let version = 1;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        const items = keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));

        return items.map((item) => ({ ...item, title: `${item.title}-v${version}` }));
      },
    });

    await map.refresh();

    version = 2;

    await map.refresh('3');

    expect((map.getByKey('3') as TestObject).title).toBe('title3-v2');
  });

  it('should filter to requested keys when the consumer returns more than asked', async () => {
    let version = 1;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      // consumer ignores `keys` and always returns everything
      values: () => testData.map((item) => ({ ...item, title: `${item.title}-v${version}` })),
    });

    await map.refresh();

    expect((map.getByKey('1') as TestObject).title).toBe('title1-v1');
    expect((map.getByKey('5') as TestObject).title).toBe('title5-v1');

    version = 2;

    await map.refresh(['2']);

    // only '2' merged; other entries stay v1 despite being in the fetch result
    expect((map.getByKey('1') as TestObject).title).toBe('title1-v1');
    expect((map.getByKey('2') as TestObject).title).toBe('title2-v2');
    expect((map.getByKey('5') as TestObject).title).toBe('title5-v1');
  });

  it('should fall back to full refresh when no resolved map is present', async () => {
    const calls: (string[] | undefined)[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        calls.push(keys);

        return keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));
      },
    });

    // first call is a partial — but nothing is resolved yet → full refresh
    const result = await map.refresh(['2']);

    expect(result.size).toBe(5);
    expect(calls).toEqual([undefined]);
  });

  it('should treat refresh([]) as a full refresh', async () => {
    const calls: (string[] | undefined)[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        calls.push(keys);

        return keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));
      },
    });

    await map.refresh();
    await map.refresh([]);

    expect(calls).toEqual([undefined, undefined]);
  });

  it('should keep stale entries on partial refresh error', async () => {
    let shouldFail = false;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (shouldFail) {
          throw new Error('partial error');
        }

        return keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));
      },
    });

    await map.refresh();

    shouldFail = true;

    await expect(map.refresh(['2'])).rejects.toThrow('partial error');

    // stale '2' still there
    expect((map.getByKey('2') as TestObject).title).toBe('title2');
  });
});

describe('sort', () => {
  it('should apply sort on full refresh', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData.toReversed(),
      sort: (a, b) => a.id.localeCompare(b.id),
    });

    const fresh = await map.refresh();

    expect([...fresh.values()].map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('should apply sort on partial refresh that adds a new entry', async () => {
    let pool: TestObject[] = [...testData];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => (keys === undefined ? pool : pool.filter((i) => keys.includes(i.id))),
      sort: (a, b) => a.id.localeCompare(b.id),
    });

    await map.refresh();

    pool = [...pool, { id: '0', title: 'title0' }];

    await map.refresh(['0']);

    expect((map.getAll() as TestObject[]).map((i) => i.id)).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('should apply sort on partial refresh that re-orders entries via mutation', async () => {
    const items: TestObject[] = testData.map((item) => ({ ...item }));

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => (keys === undefined ? items : items.filter((i) => keys.includes(i.id))),
      sort: (a, b) => a.title.localeCompare(b.title),
    });

    await map.refresh();

    expect((map.getAll() as TestObject[]).map((i) => i.title)).toEqual([
      'title1', 'title2', 'title3', 'title4', 'title5',
    ]);

    // mutate '2' to a title that should sort first
    const idx = items.findIndex((i) => i.id === '2');

    items[idx] = { id: '2', title: 'aaa' };

    await map.refresh(['2']);

    expect((map.getAll() as TestObject[]).map((i) => i.title)).toEqual([
      'aaa', 'title1', 'title3', 'title4', 'title5',
    ]);
  });
});

describe('delete', () => {
  it('should remove entries from the resolved map', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    await map.refresh();

    map.delete('2');

    expect(map.getByKey('2')).toBeUndefined();
    expect((map.getAll() as TestObject[]).map((i) => i.id)).toEqual(['1', '3', '4', '5']);
  });

  it('should accept an array of keys', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    await map.refresh();
    map.delete(['1', '3', '5']);

    expect((map.getAll() as TestObject[]).map((i) => i.id)).toEqual(['2', '4']);
  });

  it('should be a no-op when the map is not resolved', () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: () => testData,
    });

    expect(() => map.delete('1')).not.toThrow();
    expect(() => map.delete(['1', '2'])).not.toThrow();
  });

  it('should not trigger any fetch', async () => {
    const values = vi.fn((keys: string[] | undefined) =>
      keys === undefined ? testData : testData.filter((i) => keys.includes(i.id)),
    );

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values,
    });

    await map.refresh();
    values.mockClear();

    map.delete('1');
    map.delete(['2', '3']);

    expect(values).not.toHaveBeenCalled();
  });
});

type InflightSlot = {
  resolve: (value: TestObject[]) => void;
  reject: (err: any) => void;
  keys: string[] | undefined;
};

describe('drain (concurrent refresh)', () => {
  function controllable() {
    const inflight: InflightSlot[] = [];

    const values = (keys: string[] | undefined) =>
      new Promise<TestObject[]>((resolve, reject) => {
        inflight.push({ resolve, reject, keys });
      });

    return { values, inflight };
  }

  it('should coalesce rapid partial calls within the debounce window', async () => {
    const { values, inflight } = controllable();

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          // initial full
          return testData;
        }

        return values(keys);
      },
    });

    // initial full
    await map.refresh();

    // three rapid partials within the debounce window
    const p1 = map.refresh(['1']);
    const p2 = map.refresh(['2']);
    const p3 = map.refresh(['3']);

    // all should share the same eventual fetch
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    // wait for debounce to fire
    await vi.waitFor(() => expect(inflight.length).toBe(1));

    // dispatched call should request all three coalesced keys
    expect(new Set(inflight[0]!.keys!)).toEqual(new Set(['1', '2', '3']));

    inflight[0]!.resolve(testData.filter((i) => inflight[0]!.keys!.includes(i.id)));

    await p1;
  });

  it('should subsume a queued partial when a full is queued after it', async () => {
    const fetches: ('full' | string[])[] = [];

    const inflight: { resolve: (v: TestObject[]) => void }[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        fetches.push(keys === undefined ? 'full' : [...keys]);

        return new Promise<TestObject[]>((resolve) => {
          inflight.push({
            resolve: (v) => resolve(v),
          });
        });
      },
    });

    // initial full
    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    // start a partial — it will go through the debounce window
    const partial1 = map.refresh(['1', '2']);

    await vi.waitFor(() => expect(inflight.length).toBe(2));

    // partial(1,2) is now inflight. Schedule a full and another partial.
    const full = map.refresh();
    const partial2 = map.refresh(['3', '1']);

    // full subsumes pending partials, so partial2 should share full's promise
    expect(full).toBe(partial2);

    // resolve the inflight partial — that triggers drain, which starts full
    inflight[1]!.resolve(testData.filter((i) => ['1', '2'].includes(i.id)));

    await partial1;

    // drain should have queued full
    await vi.waitFor(() => expect(inflight.length).toBe(3));

    // the queued op must be a full, not a partial(3,1)
    expect(fetches[2]).toBe('full');

    inflight[2]!.resolve(testData);

    await full;
    await partial2;
  });

  it('should return the same promise for refresh() called twice in a row while idle', async () => {
    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: async () => {
        await new Promise((r) => setTimeout(r, 30));

        return testData;
      },
    });

    const a = map.refresh();
    const b = map.refresh();

    expect(a).toBe(b);

    await a;
  });

  it('should return the inflight full promise when a partial is requested mid-full', async () => {
    let resolveFull: ((v: TestObject[]) => void) | null = null;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          return new Promise<TestObject[]>((resolve) => {
            resolveFull = resolve;
          });
        }

        return testData.filter((i) => keys.includes(i.id));
      },
    });

    // initial fetch lazily via getCache
    const fetched = map.getAllAsMap() as Promise<Map<string, TestObject>>;

    // wait for the full fetch to be in flight (resolveFull assigned)
    await vi.waitFor(() => expect(resolveFull).not.toBeNull());

    // partial request while full is inflight — falls back to the inflight full
    const partial = map.refresh(['1']);

    resolveFull!(testData);

    const [m1, m2] = await Promise.all([fetched, partial]);

    expect(m1.size).toBe(5);
    expect(m2.size).toBe(5);
  });

  it('should run partial after full completes when full is in flight first', async () => {
    let resolveFull: ((v: TestObject[]) => void) | null = null;
    const fetches: ('full' | string[])[] = [];

    let inflightPartial: ((v: TestObject[]) => void) | null = null;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          fetches.push('full');

          return new Promise<TestObject[]>((resolve) => {
            resolveFull = resolve;
          });
        }

        fetches.push([...keys]);

        return new Promise<TestObject[]>((resolve) => {
          inflightPartial = (v) => resolve(v);
        });
      },
    });

    // resolved cache
    const initial = map.refresh();

    await vi.waitFor(() => expect(resolveFull).not.toBeNull());
    resolveFull!(testData);
    await initial;

    // start a full, then a partial — partial is subsumed
    resolveFull = null;

    const full = map.refresh();
    const partial = map.refresh(['1']);

    expect(full).toBe(partial);

    await vi.waitFor(() => expect(resolveFull).not.toBeNull());
    resolveFull!(testData);
    await full;

    // partial was dropped because it was subsumed by full
    expect(fetches.filter((f) => Array.isArray(f))).toHaveLength(0);
    // inflightPartial was never assigned because the partial fetch was never started
    expect(inflightPartial).toBeNull();
  });

  it('should queue keys for a follow-up fetch when partial is inflight', async () => {
    const fetches: string[][] = [];
    const inflight: { resolve: (v: TestObject[]) => void; keys: string[] }[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          return testData;
        }

        fetches.push([...keys]);

        return new Promise<TestObject[]>((resolve) => {
          inflight.push({ resolve, keys });
        });
      },
    });

    await map.refresh();

    // first partial — wait for it to dispatch so the next call hits the
    // inflight-partial branch (NOT the debounce-coalescing branch)
    const p1 = map.refresh(['1']);

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    expect(fetches[0]).toEqual(['1']);

    // second partial while first is inflight — no full is queued
    const p2 = map.refresh(['2']);

    // distinct deferred from p1 (new batch)
    expect(p2).not.toBe(p1);

    // resolve the first fetch — drain should dispatch the queued keys as a second fetch
    inflight[0]!.resolve(testData.filter((i) => i.id === '1'));
    await p1;

    await vi.waitFor(() => expect(inflight.length).toBe(2));
    expect(fetches[1]).toEqual(['2']);

    inflight[1]!.resolve(testData.filter((i) => i.id === '2'));
    await p2;

    expect(fetches).toEqual([['1'], ['2']]);
  });

  it('should cancel a pending debounce when a full refresh is requested', async () => {
    const fetches: ('full' | string[])[] = [];
    const inflight: { resolve: (v: TestObject[]) => void; keys: string[] | undefined }[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        fetches.push(keys === undefined ? 'full' : [...keys]);

        return new Promise<TestObject[]>((resolve) => {
          inflight.push({ resolve, keys });
        });
      },
    });

    // initial full to reach resolved state
    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    // queue a partial — sits inside the debounce window
    const partial = map.refresh(['1']);

    // before the debounce fires, request a full
    const full = map.refresh();

    // the debounce timer was cleared, so the partial's deferred is consumed by the full
    expect(partial).toBe(full);

    // wait long enough that any non-cancelled debounce would have fired
    await new Promise((r) => setTimeout(r, 100));

    // only the full fetch should be dispatched — partial(['1']) must NOT show up
    expect(inflight.length).toBe(2);
    expect(fetches[1]).toBe('full');

    inflight[1]!.resolve(testData);

    const [m1, m2] = await Promise.all([partial, full]);

    expect(m1.size).toBe(5);
    expect(m2.size).toBe(5);
    expect(fetches.filter((f) => Array.isArray(f))).toHaveLength(0);
  });

  it('should resolve a partial with an empty map when clear() is called mid-flight', async () => {
    let resolvePartial: ((v: TestObject[]) => void) | null = null;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          return testData;
        }

        return new Promise<TestObject[]>((resolve) => {
          resolvePartial = resolve;
        });
      },
    });

    await map.refresh();

    const partial = map.refresh(['2']);

    await vi.waitFor(() => expect(resolvePartial).not.toBeNull());

    // invalidate the whole cache while the partial is in flight
    map.clear();

    // partial returns a value but there is no resolved map to merge into
    resolvePartial!([{ id: '2', title: 'title2-fresh' }]);

    const result = await partial;

    // mergePartial's defensive branch — nothing to merge into → empty map
    expect(result.size).toBe(0);

    // next read triggers a fresh full fetch
    const fresh = await map.getAllAsMap();

    expect(fresh.size).toBe(5);
  });
});

describe('kitchen sink', () => {
  it('should handle the canonical concurrent scenario', async () => {
    // Scenario:
    //   t0: refresh([1,2])  -> partial inflight
    //   t1: refresh()       -> full queued, partial keys dropped
    //   t2: refresh([3,1])  -> dropped (subsumed by queued full)
    //   t3: partial(1,2) resolves
    //   t4: drain -> full starts -> resolves
    // Expectations:
    //   - only one partial fetch (with keys 1,2) and one full fetch run, in that order.
    //   - partial([3,1]) is never dispatched.
    //   - all three caller promises resolve to the post-full map.

    const fetches: ('full' | string[])[] = [];
    const inflight: { resolve: (v: TestObject[]) => void; keys: string[] | undefined }[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        fetches.push(keys === undefined ? 'full' : [...keys]);

        return new Promise<TestObject[]>((resolve) => {
          inflight.push({ resolve, keys });
        });
      },
    });

    // initial full to get into resolved state
    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    // t0
    const p1 = map.refresh(['1', '2']);

    // wait for the debounce window so partial(1,2) actually dispatches
    await vi.waitFor(() => expect(inflight.length).toBe(2));

    expect(new Set(inflight[1]!.keys!)).toEqual(new Set(['1', '2']));

    // t1
    const pFull = map.refresh();
    // t2
    const p2 = map.refresh(['3', '1']);

    // both pFull and p2 should share a promise (full subsumes)
    expect(pFull).toBe(p2);
    // p1 is the partial promise (different from pFull)
    expect(p1).not.toBe(pFull);

    // t3 — resolve the inflight partial
    inflight[1]!.resolve(testData.filter((i) => ['1', '2'].includes(i.id)));

    // t4 — drain should dispatch full
    await vi.waitFor(() => expect(inflight.length).toBe(3));
    expect(fetches[2]).toBe('full');

    inflight[2]!.resolve(testData);

    // all caller promises resolve
    const [m1, mFull, m2] = await Promise.all([p1, pFull, p2]);

    expect(m1.size).toBe(5);
    expect(mFull.size).toBe(5);
    expect(m2.size).toBe(5);

    // partial([3,1]) was never dispatched
    const dispatchedKeys = fetches.filter((f) => Array.isArray(f));

    expect(dispatchedKeys).toHaveLength(1);
    expect(new Set(dispatchedKeys[0] as string[])).toEqual(new Set(['1', '2']));
  });

  it('should not resurrect a key when delete races with an in-flight partial refresh', async () => {
    // delete during in-flight refresh tombstones the key — the partial result is dropped
    // for that key, and a retry refresh is scheduled to confirm the post-delete state.
    const inflight: InflightSlot[] = [];

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        if (keys === undefined) {
          return testData;
        }

        return new Promise<TestObject[]>((resolve, reject) => {
          inflight.push({ resolve, reject, keys });
        });
      },
    });

    await map.refresh();

    const partial = map.refresh(['2']);

    // wait for partial fetch to be in flight
    await vi.waitFor(() => expect(inflight.length).toBe(1));

    // local delete while in flight — tombstones key '2'
    map.delete('2');
    expect(map.getByKey('2')).toBeUndefined();

    // first partial returns a (stale) '2' — it should NOT resurrect, retry is queued
    inflight[0]!.resolve([{ id: '2', title: 'title2-stale' }]);
    await partial;

    // still gone — tombstone suppressed the resurrection
    expect(map.getByKey('2')).toBeUndefined();

    // retry is scheduled — wait for it to dispatch
    await vi.waitFor(() => expect(inflight.length).toBe(2));
    expect(inflight[1]!.keys).toEqual(['2']);

    // the retry's fetch decides reality — server now agrees '2' is gone
    inflight[1]!.resolve([]);

    // give the merge a tick
    await vi.waitFor(() => expect(map.getByKey('2')).toBeUndefined());
  });
});

describe('tombstones', () => {
  function controllable() {
    const inflight: InflightSlot[] = [];

    const values = (keys: string[] | undefined): Promise<TestObject[]> =>
      new Promise<TestObject[]>((resolve, reject) => {
        inflight.push({ resolve, reject, keys });
      });

    return { values, inflight };
  }

  it('should not tombstone delete calls made when nothing is in flight', async () => {
    let version = 1;

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values: (keys) => {
        const items = keys === undefined ? testData : testData.filter((i) => keys.includes(i.id));

        return items.map((item) => ({ ...item, title: `${item.title}-v${version}` }));
      },
    });

    await map.refresh();

    // no inflight — delete is a plain local removal
    map.delete('2');
    expect(map.getByKey('2')).toBeUndefined();

    // subsequent refresh upserts '2' normally (no tombstone)
    version = 2;
    await map.refresh(['2']);

    expect((map.getByKey('2') as TestObject).title).toBe('title2-v2');
  });

  it('should drop resurrection from a full refresh that races with a delete', async () => {
    const { values, inflight } = controllable();

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values,
    });

    // initial full
    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    // schedule a full refresh, then delete '3' while it's in flight
    const full = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(2));

    map.delete('3');
    expect(map.getByKey('3')).toBeUndefined();

    // full returns everything (server snapshot still has '3')
    inflight[1]!.resolve(testData);
    await full;

    // '3' must not be in the rebuilt map
    expect(map.getByKey('3')).toBeUndefined();

    // a retry partial for '3' is scheduled
    await vi.waitFor(() => expect(inflight.length).toBe(3));
    expect(inflight[2]!.keys).toEqual(['3']);

    inflight[2]!.resolve([]);
    await vi.waitFor(() => expect(map.getByKey('3')).toBeUndefined());
  });

  it('should let the retry upsert the key when no further delete arrives', async () => {
    const { values, inflight } = controllable();

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values,
    });

    // initial full
    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    const partial = map.refresh(['2']);

    await vi.waitFor(() => expect(inflight.length).toBe(2));

    map.delete('2');

    // first partial returns '2' — tombstoned, suppressed
    inflight[1]!.resolve([{ id: '2', title: 'title2-fresh' }]);
    await partial;

    expect(map.getByKey('2')).toBeUndefined();

    // retry dispatches; no new delete in the meantime — tombstone empty now
    await vi.waitFor(() => expect(inflight.length).toBe(3));
    expect(inflight[2]!.keys).toEqual(['2']);

    // retry's fetch returns '2' — this time we accept it (tombstone was cleared)
    inflight[2]!.resolve([{ id: '2', title: 'title2-final' }]);

    await vi.waitFor(() => expect(map.getByKey('2')).toBeDefined());
    expect((map.getByKey('2') as TestObject).title).toBe('title2-final');
  });

  it('should clear tombstones on refresh error', async () => {
    const { values, inflight } = controllable();

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values,
    });

    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    const partial = map.refresh(['2']);

    await vi.waitFor(() => expect(inflight.length).toBe(2));

    map.delete('2');

    // partial errors — tombstones must be cleared, no retry scheduled
    inflight[1]!.reject(new Error('boom'));

    await expect(partial).rejects.toThrow('boom');

    // a subsequent refresh of '2' should treat it normally (no leftover tombstone)
    const followup = map.refresh(['2']);

    await vi.waitFor(() => expect(inflight.length).toBe(3));
    inflight[2]!.resolve([{ id: '2', title: 'title2-back' }]);
    await followup;

    expect((map.getByKey('2') as TestObject).title).toBe('title2-back');
  });

  it('should not tombstone keys not touched during inflight', async () => {
    // delete '4' while inflight for ['2'] — '4' is tombstoned, but the inflight doesn't
    // include '4' so no resurrection check fires for it. The tombstone is cleared at the
    // end of the refresh window anyway.
    const { values, inflight } = controllable();

    const map = new ProjectedMap<string, TestObject>({
      key: (item) => item.id,
      values,
    });

    const initial = map.refresh();

    await vi.waitFor(() => expect(inflight.length).toBe(1));
    inflight[0]!.resolve(testData);
    await initial;

    const partial = map.refresh(['2']);

    await vi.waitFor(() => expect(inflight.length).toBe(2));

    map.delete('4');
    expect(map.getByKey('4')).toBeUndefined();

    inflight[1]!.resolve(testData.filter((i) => i.id === '2'));
    await partial;

    // '4' stays gone, no resurrection
    expect(map.getByKey('4')).toBeUndefined();

    // a fresh partial for '4' after tombstones cleared should add it back
    const followup = map.refresh(['4']);

    await vi.waitFor(() => expect(inflight.length).toBe(3));
    inflight[2]!.resolve(testData.filter((i) => i.id === '4'));
    await followup;

    expect((map.getByKey('4') as TestObject).id).toBe('4');
  });
});
