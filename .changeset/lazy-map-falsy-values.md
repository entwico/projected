---
"@entwico/projected": patch
---

`ProjectedLazyMap`: falsy values (`0`, `''`, `false`) are returned by `getByKeys` / `getByKeysSparse` and cached instead of being treated as missing
