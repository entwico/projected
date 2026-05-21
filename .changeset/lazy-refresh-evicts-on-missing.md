---
"projected": major
---

`ProjectedLazyMap.refresh()` now evicts cache entries for keys that are missing from the fetch result, instead of keeping the stale value
