---
"@entwico/projected": patch
---

`ProjectedLazyMap`: `delete(key)` now also invalidates a fetch of that key that is still running — its result is no longer written back into the cache
