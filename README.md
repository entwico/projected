# projected

A TypeScript library for managing data fetching and caching from remote sources. Handles the complexity of lazy loading, request deduplication, caching, and background refresh - regardless of how many consumers request the same data.

## Why?

When building applications that fetch data from APIs, databases, or other remote sources, you often face these challenges:

- **Multiple consumers requesting the same data** - leads to duplicate network calls
- **Managing cache state** - knowing when data is fresh, stale, or being fetched
- **Graceful refresh** - updating data without blocking consumers (stale-while-revalidate)
- **Request batching** - combining many individual lookups into efficient batch requests
- **Synchronous access to cached data** - avoiding unnecessary async overhead for cached values

This library provides three utilities that solve these problems with a clean, type-safe API.

## Installation

```bash
npm i @entwico/projected
```

## Features

- **Sync returns when cached** - all methods return `T | Promise<T>`, avoiding Promise overhead for cached values
- **Request deduplication** - multiple consumers share the same in-flight request
- **Background refresh** - `refresh()` returns a promise for fresh data (or error), keeps stale value in cache on error
- **Request batching** - `ProjectedLazyMap` batches individual lookups into single batch requests
- **Pluggable cache** - use built-in `Map`, LRU cache, or any custom implementation
- **Deep freeze protection** - optionally freeze returned objects to prevent accidental mutations

## API Overview

| Class                    | Use Case                                        | Fetches                       |
| ------------------------ | ----------------------------------------------- | ----------------------------- |
| `ProjectedValue<V>`      | Single value (e.g., config, user session)       | Once, on first access         |
| `ProjectedMap<K, V>`     | Small collections (e.g., categories, countries) | All items at once             |
| `ProjectedLazyMap<K, V>` | Large collections (e.g., users, products)       | Only requested items, batched |

## ProjectedValue

Caches a single value fetched from a remote source.

```ts
import { ProjectedValue } from "@entwico/projected";

const config = new ProjectedValue({
  value: async () => {
    const response = await fetch("/api/config");
    return response.json();
  },
});

// first call - fetches from remote
const result1 = await config.get();

// second call - returns T (not Promise), but await still works
const result2 = await config.get();
```

### Methods

| Method      | Return Type       | Description                                               |
| ----------- | ----------------- | --------------------------------------------------------- |
| `get()`     | `T \| Promise<T>` | Returns cached value (sync) or fetches and caches (async) |
| `refresh()` | `Promise<T>`      | Fetches fresh value, updates cache, rejects on error      |
| `clear()`   | `void`            | Clears cache, next `get()` will fetch fresh               |

### Sync vs Async

Methods return `T | Promise<T>`. You can always use `await` - it works on both:

```ts
// always works, regardless of cache state
const value = await config.get();
```

For performance-critical code, check with `instanceof Promise` to avoid async overhead:

```ts
const result = config.get();

if (result instanceof Promise) {
  // first call or after clear() - need to await
  const value = await result;
} else {
  // cached - use directly, no async overhead
  console.log(result);
}
```

## ProjectedMap

Caches an entire collection, fetched all at once. Unlike `ProjectedValue`, it allows accessing individual items by key. Unlike `ProjectedLazyMap`, it provides access to all items at once. Best for small, frequently-accessed collections where you need both.

```ts
import { ProjectedMap } from "@entwico/projected";

type Country = { code: string; name: string };

const countries = new ProjectedMap<string, Country>({
  key: (country) => country.code,
  values: async (keys) => {
    const url = keys ? `/api/countries?codes=${keys.join(",")}` : "/api/countries";
    const response = await fetch(url);
    return response.json();
  },
});

// fetches all countries, caches them
await countries.getByKey("US"); // { code: 'US', name: 'United States' }

// all subsequent calls return T (not Promise) - can still use await
await countries.getByKey("DE");
await countries.getByKeys(["FR", "IT"]);
await countries.getAll();
await countries.getAllAsMap();
```

### Partial Refresh

`refresh(key | keys)` re-fetches just the requested entries via `values(keys)` and merges
them into the cached map. Requested keys absent from the result are deleted — which is
how you propagate upstream deletions:

```ts
// re-fetch a single country
await countries.refresh("US");

// re-fetch many (rapid calls within ~50ms are coalesced into one fetch)
await Promise.all([countries.refresh("US"), countries.refresh(["DE", "FR"])]);

// if the upstream no longer returns 'US', it's removed from the cached map
```

Coalescing rules:

- Rapid `refresh(keys)` calls within a 50ms window are merged into a single fetch.
- A `refresh()` (full) requested while a partial is in flight is queued and runs after the partial completes; it subsumes any pending partial keys.
- A `refresh(keys)` called against a map that has not yet been resolved falls back to a full refresh.

### Sort

Optional `sort` is applied on every materialization — both full refresh and partial merge —
so iteration order stays stable as entries are added or updated:

```ts
const countries = new ProjectedMap<string, Country>({
  key: (country) => country.code,
  values: async (keys) => fetchCountries(keys),
  sort: (a, b) => a.name.localeCompare(b.name),
});

await countries.getAll(); // sorted by name
```

### Local Delete

`delete(key | keys)` removes entries from the cached map without triggering a fetch.
Useful when the entry is gone: the change can be reflected immediately.

```ts
await countries.delete("US");
await countries.delete(["DE", "FR"]);
```

### Methods

| Method                  | Return Type                          | Description                                                   |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `getByKey(key)`         | `T \| undefined \| Promise<...>`     | Get single item by key                                        |
| `getByKeys(keys)`       | `T[] \| Promise<T[]>`                | Get multiple items (skips missing)                            |
| `getByKeysSparse(keys)` | `(T \| undefined)[] \| Promise<...>` | Get multiple items (keeps order, undefined for missing)       |
| `getAll()`              | `T[] \| Promise<T[]>`                | Get all items as array (order follows `sort` if configured)   |
| `getAllAsMap()`         | `Map<K, T> \| Promise<...>`          | Get all items as Map                                          |
| `get(keyOrKeys)`        | mixed                                | Shorthand for `getByKey` or `getByKeys`                       |
| `refresh()`             | `Promise<Map<K, T>>`                 | Full re-fetch via `values(undefined)`                         |
| `refresh(keyOrKeys)`    | `Promise<Map<K, T>>`                 | Partial re-fetch via `values(keys)`; missing keys are evicted |
| `delete(keyOrKeys)`     | `void`                               | Remove entries from the cached map locally (no fetch)         |
| `clear()`               | `void`                               | Clears cache                                                  |

## ProjectedLazyMap

Fetches items on-demand with automatic request batching. Best for large collections where you only need specific items.

```ts
import { ProjectedLazyMap } from "@entwico/projected";

type User = { id: string; name: string };

const users = new ProjectedLazyMap<string, User>({
  key: (user) => user.id,
  // return only the users that exist — keys absent from the result are treated as missing
  values: async (ids) => {
    const response = await fetch(`/api/users?ids=${ids.join(",")}`);
    return response.json();
  },
  delay: 0, // extra batching window in ms (default 0 — same-tick calls still batch)
  maxChunkSize: 1000, // max items per batch (default)
  cache: true, // use built-in Map cache (default)
});

// these three calls in the same tick get batched into one request
const [user1, user2, user3] = await Promise.all([users.getByKey("user1"), users.getByKey("user2"), users.getByKey("user3")]);

// subsequent calls for cached users return T (not Promise)
await users.getByKey("user1");
```

### Request Batching

When multiple `getByKey()` calls happen within the `delay` window, they're combined into a single `values()` call. With the default `delay: 0` the window covers all calls made in the same tick — the dispatch timer only fires after microtasks drain, so `Promise.all` fan-outs still coalesce. Set a positive `delay` to widen the window at the cost of that much latency on every uncached fetch:

```ts
// all these calls in the same tick...
users.getByKey("a");
users.getByKey("b");
users.getByKey("c");

// ...result in one values() call with ['a', 'b', 'c']
```

### Custom Cache

Use any cache implementing `ProjectedMapCache` interface (compatible with `Map`, `lru-cache`, etc.):

```ts
import { LRUCache } from "lru-cache";

const users = new ProjectedLazyMap<string, User>({
  key: (user) => user.id,
  values: async (ids) => fetchUsers(ids),
  cache: new LRUCache({ max: 1000 }),
});
```

Disable caching:

```ts
const users = new ProjectedLazyMap<string, User>({
  key: (user) => user.id,
  values: async (ids) => fetchUsers(ids),
  cache: false,
});
```

### Methods

| Method                  | Return Type                                     | Description                                                     |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `getByKey(key)`         | `T \| undefined \| Promise<...>`                | Get single item (sync if cached)                                |
| `getByKeys(keys)`       | `T[] \| Promise<T[]>`                           | Get multiple items (sync if all cached)                         |
| `getByKeysSparse(keys)` | `(T \| undefined)[] \| Promise<...>`            | Get multiple items preserving order                             |
| `get(keyOrKeys)`        | mixed                                           | Shorthand for `getByKey` or `getByKeys`                         |
| `refresh(keyOrKeys)`    | `Promise<T \| undefined \| (T \| undefined)[]>` | Fetches fresh value(s); missing keys are evicted from the cache |
| `delete(keyOrKeys)`     | `void`                                          | Removes item(s) from cache                                      |
| `clear()`               | `void`                                          | Clears entire cache                                             |

## Common Options

All three classes support these options:

| Option       | Type                           | Default  | Description                            |
| ------------ | ------------------------------ | -------- | -------------------------------------- |
| `protection` | `'freeze' \| 'none'`           | `'none'` | Deep freeze returned objects           |
| `cache`      | `boolean \| ProjectedMapCache` | `true`   | Enable/disable or provide custom cache |

`ProjectedMap` additionally accepts:

| Option | Type               | Default | Description                                                             |
| ------ | ------------------ | ------- | ----------------------------------------------------------------------- |
| `sort` | `(a, b) => number` | —       | Optional comparator applied on every materialization (full and partial) |

### Protection

Enable `protection: 'freeze'` to prevent accidental mutations:

```ts
const config = new ProjectedValue({
  value: async () => ({ setting: "value" }),
  protection: "freeze",
});

const result = await config.get();
result.setting = "new"; // throws TypeError in strict mode
```

## Refresh Pattern

All classes implement `refresh()` for cache updates with error visibility:

```ts
// triggers fetch and returns promise
const freshValue = await users.refresh("user1");

// or fire-and-forget with error handling
users.refresh("user1").catch((err) => logger.error("refresh failed", err));

// stale-while-revalidate: get cached value, then refresh in background
const stale = users.getByKey("user1"); // sync if cached
users.refresh("user1").catch(handleError); // background refresh
```

Key behaviors:

- Returns a Promise that resolves to the **fresh** value
- On error: rejects the promise, but **keeps stale value in cache**
- Multiple `refresh()` calls during a fetch share the same promise
- For maps: a requested key that the fetch result omits is treated as missing and **evicted** from the cache. This is how you propagate upstream deletions.

## Guaranteed Sync Access Pattern

For server applications that prefetch data at startup, you can guarantee sync access by:

1. Prefetching data during initialization
2. Using `clear()` + background refetch instead of blocking refresh
3. Asserting sync returns in your getters

```ts
const map = new ProjectedMap<string, Category>({
  protection: "freeze",
  key: (v) => v.id,
  values: () => fetchCategories(),
});

// on startup - prefetch and wait
export async function init() {
  await map.getAll();

  // subscribe to changes - clear triggers lazy refetch on next access
  // or use refresh() for immediate background refetch
  dataChanges$.subscribe(() => map.clear());
}

// after init, these always return sync - use assertion for pure return types
export function getAllCategories(): Category[] {
  const result = map.getAll();

  if (result instanceof Promise) {
    throw new Error("Categories not initialized");
  }

  return result;
}

export function getCategory(id: string): Category | undefined {
  const result = map.getByKey(id);

  if (result instanceof Promise) {
    throw new Error("Categories not initialized");
  }

  return result;
}
```

This gives you pure sync return types with no `MaybePromise` wrapper, while still benefiting from the caching and refresh infrastructure.

## TypeScript

Full type inference is supported:

```ts
const map = new ProjectedMap({
  key: (item: { id: string }) => item.id,
  values: async () => [{ id: "1", name: "test" }],
});

// result is { id: string; name: string } | undefined
const result = await map.getByKey("1");
```

## License

[MIT](LICENSE)
