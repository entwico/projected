import { bench, describe } from 'vitest';

import { ProjectedLazyMap } from '../projected-lazy-map/projected-lazy-map.js';
import { ProjectedMap } from '../projected-map/projected-map.js';
import { ProjectedValue } from '../projected-value/projected-value.js';

/**
 * Benchmark to measure promise overhead in projected classes.
 *
 * We're measuring:
 * 1. Cache hits - how much overhead do we have when returning cached values?
 * 2. Many single calls - what happens with thousands of individual getByKey calls?
 */

describe('ProjectedValue - cache hit overhead', () => {
  const projectedValue = new ProjectedValue({
    value: () => ({ id: 1, name: 'test' }),
  });

  bench(
    'get() - with await (async path)',
    async () => {
      await projectedValue.get();
    },
    { warmupIterations: 1 },
  );

  bench(
    'get() - sync access via instanceof check',
    async () => {
      // ensure cache is populated
      const result = projectedValue.get();

      if (result instanceof Promise) {
        await result;
      } else {
        void result;
      }
    },
    { warmupIterations: 1 },
  );
});

describe('ProjectedMap - cache hit overhead', () => {
  const projectedMap = new ProjectedMap({
    key: (item: { id: number }) => item.id,
    values: () => [
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
      { id: 3, name: 'three' },
    ],
  });

  bench(
    'getByKey() - with await (async path)',
    async () => {
      await projectedMap.getByKey(1);
    },
    { warmupIterations: 1 },
  );

  bench(
    'getByKey() - sync access via instanceof check',
    async () => {
      const result = projectedMap.getByKey(1);

      if (result instanceof Promise) {
        await result;
      } else {
        void result;
      }
    },
    { warmupIterations: 1 },
  );

  bench(
    'getByKeys() - with await (async path)',
    async () => {
      await projectedMap.getByKeys([1, 2, 3]);
    },
    { warmupIterations: 1 },
  );

  bench(
    'getByKeys() - sync access via instanceof check',
    async () => {
      const result = projectedMap.getByKeys([1, 2, 3]);

      if (result instanceof Promise) {
        await result;
      } else {
        void result;
      }
    },
    { warmupIterations: 1 },
  );
});

describe('ProjectedLazyMap - cache hit overhead', () => {
  const projectedLazyMap = new ProjectedLazyMap({
    key: (item: { id: number }) => item.id,
    values: (keys: number[]) => keys.map((id) => ({ id, name: `item-${id}` })),
  });

  // pre-populate cache
  const setupLazyMap = async () => {
    await projectedLazyMap.getByKeys([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  };

  bench(
    'getByKey() - single cached value (sync with instanceof check)',
    async () => {
      await setupLazyMap();

      const result = projectedLazyMap.getByKey(1);

      if (result instanceof Promise) {
        await result;
      } else {
        void result;
      }
    },
    { warmupIterations: 1 },
  );

  bench(
    'getByKeys() - multiple cached values (sync with instanceof check)',
    async () => {
      await setupLazyMap();

      const result = projectedLazyMap.getByKeys([1, 2, 3]);

      if (result instanceof Promise) {
        await result;
      } else {
        void result;
      }
    },
    { warmupIterations: 1 },
  );
});

describe('ProjectedLazyMap - many single calls (the problem case)', () => {
  bench('1000 individual getByKey() calls - all cache hits (sync)', async () => {
    const map = new ProjectedLazyMap({
      key: (item: { id: number }) => item.id,
      values: (keys: number[]) => keys.map((id) => ({ id, name: `item-${id}` })),
    });

    // pre-populate cache with 1000 items
    await map.getByKeys(Array.from({ length: 1000 }, (_, i) => i));

    // now make 1000 individual calls - all cache hits (sync returns)
    for (let i = 0; i < 1000; i++) {
      const result = map.getByKey(i);

      if (result instanceof Promise) {
        await result;
      }
    }
  });

  bench('1000 individual getByKey() calls - all cache misses (batched)', async () => {
    const map = new ProjectedLazyMap({
      key: (item: { id: number }) => item.id,
      values: (keys: number[]) => keys.map((id) => ({ id, name: `item-${id}` })),
      delay: 10,
    });

    // make 1000 individual calls - all cache misses, should batch
    const promises = Array.from({ length: 1000 }, (_, i) => map.getByKey(i));

    await Promise.all(promises);
  });
});

describe('Baseline comparisons', () => {
  bench('raw synchronous map lookup (1000x)', () => {
    const map = new Map<number, { id: number; name: string }>();

    for (let i = 0; i < 1000; i++) {
      map.set(i, { id: i, name: `item-${i}` });
    }

    for (let i = 0; i < 1000; i++) {
      map.get(i);
    }
  });

  bench('Promise.resolve() per lookup (1000x)', async () => {
    const map = new Map<number, { id: number; name: string }>();

    for (let i = 0; i < 1000; i++) {
      map.set(i, { id: i, name: `item-${i}` });
    }

    for (let i = 0; i < 1000; i++) {
      await Promise.resolve(map.get(i));
    }
  });

  bench('new Promise() per lookup (1000x)', async () => {
    const map = new Map<number, { id: number; name: string }>();

    for (let i = 0; i < 1000; i++) {
      map.set(i, { id: i, name: `item-${i}` });
    }

    for (let i = 0; i < 1000; i++) {
      await new Promise((resolve) => resolve(map.get(i)));
    }
  });
});

describe('Wrapper overhead comparison', () => {
  const cache = new Map<number, { id: number; name: string }>();

  for (let i = 0; i < 100; i++) {
    cache.set(i, { id: i, name: `item-${i}` });
  }

  bench('raw T | Promise<T> - instanceof check', () => {
    for (let i = 0; i < 1000; i++) {
      const result: { id: number; name: string } | Promise<{ id: number; name: string }> = cache.get(i % 100)!;

      if (result instanceof Promise) {
        // would await here
      } else {
        // use result directly
        void result.id;
      }
    }
  });

  // factory pattern with object literal
  const createWrapper = <T>(value: T | Promise<T>) => ({
    _value: value,
    isSync: () => !(value instanceof Promise),
    getSync: () => {
      if (value instanceof Promise) throw new Error('async');

      return value;
    },
  });

  bench('object literal factory - construction', () => {
    for (let i = 0; i < 1000; i++) {
      createWrapper(cache.get(i % 100)!);
    }
  });

  bench('object literal factory - isSync() check', () => {
    for (let i = 0; i < 1000; i++) {
      const result = createWrapper(cache.get(i % 100)!);

      if (result.isSync()) {
        void result.getSync().id;
      }
    }
  });

  // plain object with value property (no methods)
  bench('plain object {value} + external check', () => {
    for (let i = 0; i < 1000; i++) {
      const result = { value: cache.get(i % 100)! };

      if (!(result.value instanceof Promise)) {
        void result.value.id;
      }
    }
  });

  // utility functions approach
  const maybeThen = <T, R>(value: T | Promise<T>, fn: (v: T) => R | Promise<R>): R | Promise<R> => {
    if (value instanceof Promise) {
      return value.then(fn);
    }

    return fn(value);
  };

  const isPromise = <T>(value: T | Promise<T>): value is Promise<T> => value instanceof Promise;

  bench('maybeThen() utility function', () => {
    for (let i = 0; i < 1000; i++) {
      const result = cache.get(i % 100)!;

      maybeThen(result, (v) => v.id);
    }
  });

  bench('isPromise() utility + direct access', () => {
    for (let i = 0; i < 1000; i++) {
      const result = cache.get(i % 100)!;

      if (!isPromise(result)) {
        void result.id;
      }
    }
  });

  bench('Promise.resolve() - always async', async () => {
    for (let i = 0; i < 1000; i++) {
      const result = await Promise.resolve(cache.get(i % 100)!);

      void result.id;
    }
  });
});

describe('Real-world scenario: nested validation (15k promises)', () => {
  // simulates form validation where each field validator might call multiple cached lookups
  // e.g., 100 fields × 5 validators × 30 rule checks = 15,000 calls

  const cache = new Map<string, { valid: boolean; message: string }>();

  // pre-populate validation rules cache
  for (let i = 0; i < 500; i++) {
    cache.set(`rule-${i}`, { valid: true, message: '' });
  }

  bench('15k cached lookups - current (async)', async () => {
    const asyncGet = async (key: string) => cache.get(key);

    for (let i = 0; i < 15_000; i++) {
      await asyncGet(`rule-${i % 500}`);
    }
  });

  bench('15k cached lookups - sync when possible', () => {
    const syncGet = (key: string) => cache.get(key);

    for (let i = 0; i < 15_000; i++) {
      syncGet(`rule-${i % 500}`);
    }
  });

  bench('15k cached lookups - MaybePromise pattern', async () => {
    // simulates what ProjectedPromise would do
    const maybeAsyncGet = (
      key: string,
    ): { valid: boolean; message: string } | Promise<{ valid: boolean; message: string }> => {
      const cached = cache.get(key);

      if (cached) {
        return cached; // sync return
      }

      return Promise.resolve({ valid: false, message: 'not found' }); // async fallback
    };

    for (let i = 0; i < 15_000; i++) {
      const result = maybeAsyncGet(`rule-${i % 500}`);

      if (result instanceof Promise) {
        await result;
      }
    }
  });
});
