---
"projected": major
---

returned values are now typed `ReadonlyDeep<V>` (recursive readonly). The `protection: 'freeze' | 'none'` option and the `deepFreeze` utility are removed — runtime freezing is no longer applied. Use `structuredClone(value) as never as V` if you genuinely need a mutable copy.
