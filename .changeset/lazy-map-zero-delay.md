---
'@entwico/projected': major
---

ProjectedLazyMap no longer waits 50ms before dispatching a batch — same-tick calls still coalesce; pass `delay` explicitly to restore a window
