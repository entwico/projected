---
"@entwico/projected": patch
---

`clear()` now also invalidates a fetch that is still running: its result is no longer written into the cache, and a read after the `clear()` waits for a fresh fetch (`ProjectedValue`, `ProjectedMap`, `ProjectedLazyMap`)
