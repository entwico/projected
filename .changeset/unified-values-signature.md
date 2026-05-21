---
"projected": major
---

`values` callback signature changes. `ProjectedMap.values` is now called with `K[] | undefined` — `undefined` means return everything, an array means return only those entries. `ProjectedLazyMap` / `Resolver` `values` must now return `V[]` instead of `Maybe<V>[]` — keys absent from the result are treated as missing (previously `undefined` slots were silently skipped).
