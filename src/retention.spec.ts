import { countAlive } from '@entwico/dash/testing';
import { runInContexts } from '@entwico/dash/testing/node';
import { describe, expect, it } from 'vitest';

import { ProjectedLazyMap } from './projected-lazy-map/projected-lazy-map.js';
import { ProjectedMap } from './projected-map/projected-map.js';
import { ProjectedValue } from './projected-value/projected-value.js';

// what must not stay in memory once it is replaced or removed: a projection lives for the life of
// the process, so whatever it keeps of one fetch or one caller, it keeps of all of them

type Item = { id: string; payload: number[] };

/** A remote source: every fetch answers with new items, which only the weak references remember. */
function createSource() {
  const fetched = new Map<string, WeakRef<Item>[]>();
  let failing = false;

  function fetch(ids: readonly string[]): Item[] {
    if (failing) {
      throw new Error('source failed');
    }

    return ids.map((id) => {
      const item: Item = { id, payload: Array.from({ length: 1000 }, () => 0) };

      fetched.set(id, [...fetched.get(id) ?? [], new WeakRef(item)]);

      return item;
    });
  }

  return {
    fetch,
    fail: (value: boolean) => void (failing = value),
    /** Every version of the item that was fetched, oldest first. */
    versions: (id: string): WeakRef<Item>[] => fetched.get(id) ?? [],
    all: (): WeakRef<Item>[] => fetched.values().toArray().flat(),
  };
}

const ids = ['a', 'b', 'c'];

/** Waits for `action` and drops its result: a test that awaited it itself would be what keeps it in memory. */
async function settled(action: () => unknown): Promise<void> {
  await action();
}

async function failed(action: () => unknown): Promise<boolean> {
  try {
    await action();

    return false;
  } catch {
    return true;
  }
}

describe('a ProjectedValue that stays in use', () => {
  function createValue(cache?: boolean) {
    const source = createSource();
    const value = new ProjectedValue({ value: () => source.fetch(['a'])[0]!, ...(cache !== undefined && { cache }) });

    return { source, value };
  }

  it('keeps the value it serves', async () => {
    const { source, value } = createValue();

    await settled(() => value.get());

    expect(await countAlive(source.all())).toBe(1);
  });

  it('keeps nothing of a value that was cleared', async () => {
    const { source, value } = createValue();

    await settled(() => value.get());
    value.clear();

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing of a value that a refresh replaced', async () => {
    const { source, value } = createValue();

    await settled(() => value.get());
    await settled(() => value.refresh());
    await settled(() => value.refresh());

    expect(await countAlive(source.versions('a').slice(0, 2))).toBe(0);
  });

  it('keeps nothing when it does not cache', async () => {
    const { source, value } = createValue(false);

    await settled(() => value.get());
    await settled(() => value.refresh());

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing of the requests that read it, a failed refresh in between', async () => {
    const { source, value } = createValue();

    const contexts = await runInContexts(50, async () => {
      await settled(() => value.get());
      source.fail(true);
      await failed(() => value.refresh());
      source.fail(false);
      await settled(() => value.refresh());
    });

    expect(await countAlive(contexts)).toBe(0);
  });

  it('keeps nothing of the requests that waited for the same fetch', async () => {
    const { value } = createValue();

    const contexts = await runInContexts(50, async () => {
      value.clear();
      await Promise.all([value.get(), value.get(), value.refresh()]);
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('a ProjectedMap that stays in use', () => {
  function createMap(cache?: boolean) {
    const source = createSource();
    let present = ids;

    const map = new ProjectedMap<string, Item>({
      key: (item) => item.id,
      values: (keys) => source.fetch((keys ?? present).filter((id) => present.includes(id))),
      ...(cache !== undefined && { cache }),
    });

    return { source, map, remove: (id: string) => void (present = present.filter((other) => other !== id)) };
  }

  it('keeps the entries it serves', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());

    expect(await countAlive(source.all())).toBe(3);
  });

  it('keeps nothing of an entry that was deleted', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());
    map.delete('a');

    expect(await countAlive(source.versions('a'))).toBe(0);
  });

  it('keeps nothing of an entry that a partial refresh replaced', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());
    await settled(() => map.refresh('a'));

    expect(await countAlive(source.versions('a').slice(0, 1))).toBe(0);
  });

  it('keeps nothing of an entry that a partial refresh no longer found', async () => {
    const { source, map, remove } = createMap();

    await settled(() => map.getAll());
    remove('a');
    await settled(() => map.refresh('a'));

    expect(await countAlive(source.versions('a'))).toBe(0);
  });

  it('keeps nothing of an entry that was deleted while a refresh was fetching it', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());

    const refreshed = map.refresh();

    map.delete('a');
    await refreshed;
    // the retry that confirms the deletion fetches it once more
    await expect.poll(() => source.versions('a').length).toBe(3);

    expect(await countAlive(source.versions('a').slice(0, 2))).toBe(0);
  });

  it('keeps nothing of the entries that a full refresh replaced', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());

    const replaced = source.all();

    await settled(() => map.refresh());

    expect(await countAlive(replaced)).toBe(0);
  });

  it('keeps nothing of entries that were cleared', async () => {
    const { source, map } = createMap();

    await settled(() => map.getAll());
    map.clear();

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing when it does not cache', async () => {
    const { source, map } = createMap(false);

    await settled(() => map.getAll());
    await settled(() => map.refresh());

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing of the requests that read it, a failed refresh in between', async () => {
    const { source, map } = createMap();

    const contexts = await runInContexts(50, async () => {
      await settled(() => map.getByKey('a'));
      source.fail(true);
      await failed(() => map.refresh('a'));
      source.fail(false);
      await settled(() => map.refresh());
    });

    expect(await countAlive(contexts)).toBe(0);
  });

  it('keeps nothing of the requests whose refreshes were queued behind another', async () => {
    const { map } = createMap();

    await settled(() => map.getAll());

    const contexts = await runInContexts(50, async () => {
      await Promise.all([map.refresh(), map.refresh('a'), map.refresh(['b', 'c']), map.refresh()]);
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});

describe('a ProjectedLazyMap that stays in use', () => {
  function createLazyMap(cache?: boolean) {
    const source = createSource();
    let present = ids;

    const map = new ProjectedLazyMap<string, Item>({
      key: (item) => item.id,
      values: (keys) => source.fetch(keys.filter((id) => present.includes(id))),
      ...(cache !== undefined && { cache }),
    });

    return { source, map, remove: (id: string) => void (present = present.filter((other) => other !== id)) };
  }

  it('keeps the entries it serves', async () => {
    const { source, map } = createLazyMap();

    await settled(() => map.getByKeys(ids));

    expect(await countAlive(source.all())).toBe(3);
  });

  it('keeps nothing of an entry that was deleted', async () => {
    const { source, map } = createLazyMap();

    await settled(() => map.getByKeys(ids));
    map.delete('a');
    map.delete(['b']);

    expect(await countAlive([...source.versions('a'), ...source.versions('b')])).toBe(0);
  });

  it('keeps nothing of an entry that a refresh replaced', async () => {
    const { source, map } = createLazyMap();

    await settled(() => map.getByKey('a'));
    await settled(() => map.refresh('a'));

    expect(await countAlive(source.versions('a').slice(0, 1))).toBe(0);
  });

  it('keeps nothing of an entry that a refresh no longer found', async () => {
    const { source, map, remove } = createLazyMap();

    await settled(() => map.getByKey('a'));
    remove('a');
    await settled(() => map.refresh('a'));

    expect(await countAlive(source.versions('a'))).toBe(0);
  });

  it('keeps nothing of entries that were cleared', async () => {
    const { source, map } = createLazyMap();

    await settled(() => map.getByKeys(ids));
    map.clear();

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing when it does not cache', async () => {
    const { source, map } = createLazyMap(false);

    await settled(() => map.getByKeys(ids));
    await settled(() => map.refresh(ids));

    expect(await countAlive(source.all())).toBe(0);
  });

  it('keeps nothing of the requests that read it, a failed fetch in between', async () => {
    const { source, map } = createLazyMap();

    const contexts = await runInContexts(50, async () => {
      map.clear();
      await settled(() => map.getByKey('a'));
      source.fail(true);
      await failed(() => map.refresh('b'));
      source.fail(false);
      await settled(() => map.refresh(ids));
    });

    expect(await countAlive(contexts)).toBe(0);
  });

  it('keeps nothing of the requests whose fetches went out as one', async () => {
    const { map } = createLazyMap();

    const contexts = await runInContexts(50, async () => {
      map.clear();
      await Promise.all([map.getByKey('a'), map.getByKeys(['a', 'b']), map.refresh('c'), map.getByKey('missing')]);
    });

    expect(await countAlive(contexts)).toBe(0);
  });
});
