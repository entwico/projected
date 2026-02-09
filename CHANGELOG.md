# [2.1.0](https://github.com/smnbbrv/projected/compare/v2.0.1...v2.1.0) (2026-02-05)


### Features

* add maybeThen and maybeCatch ([12a8583](https://github.com/smnbbrv/projected/commit/12a8583eef4d75bb0713b7f138b55d7a3a0153fb))

## [2.0.1](https://github.com/smnbbrv/projected/compare/v2.0.0...v2.0.1) (2026-02-05)


### Bug Fixes

* refresh return promise and can throw ([51f4005](https://github.com/smnbbrv/projected/commit/51f4005e9b50c8b9e438e266e98420f966dca6da))

# [2.0.0](https://github.com/smnbbrv/projected/compare/v1.4.0...v2.0.0) (2026-02-03)


### Bug Fixes

* update license ([a2c9b16](https://github.com/smnbbrv/projected/commit/a2c9b16996ed298524590d843b5ebb71548cef96))


### Features

* return MaybePromise from all methods, allow undefined values ([ee48251](https://github.com/smnbbrv/projected/commit/ee482516ae930308363302752ce5394b77c4a8bd))


### BREAKING CHANGES

* All get methods now return T | Promise<T> instead of always Promise<T>. ProjectedValue now allows undefined as a valid return value.

# [1.4.0](https://github.com/smnbbrv/projected/compare/v1.3.0...v1.4.0) (2026-02-03)


### Bug Fixes

* update license ([9029902](https://github.com/smnbbrv/projected/commit/902990265646a95d5411c6829a3cc37820eb356e))


### Features

* add refresh method ([fe2a447](https://github.com/smnbbrv/projected/commit/fe2a44712ad383d07db6b4e0bd443dff49961655))

# [1.3.0](https://github.com/smnbbrv/projected/compare/v1.2.0...v1.3.0) (2025-02-16)


### Bug Fixes

* remove async from synchronous methods ([fc9fe4b](https://github.com/smnbbrv/projected/commit/fc9fe4bf1c9f9b6519985c2f047830d108712ab1))


### Features

* get rid of dependencies ([bf709a7](https://github.com/smnbbrv/projected/commit/bf709a7026ac185c60b5d988ab0ec2afb41c06a0))

# [1.2.0](https://github.com/smnbbrv/proxy-collections/compare/v1.1.1...v1.2.0) (2025-02-15)


### Features

* add projected value ([9b84bc7](https://github.com/smnbbrv/proxy-collections/commit/9b84bc7ab0279662661f2463a6d53953eb646a7e))

## [1.1.1](https://github.com/smnbbrv/projected/compare/v1.1.0...v1.1.1) (2025-01-05)


### Bug Fixes

* fix the inline documentation ([697274e](https://github.com/smnbbrv/projected/commit/697274e9551988cc9a81ba820df92ae8b955c829))

# [1.1.0](https://github.com/smnbbrv/projected/compare/v1.0.0...v1.1.0) (2025-01-05)


### Features

* add ProjectedMap ([24f2444](https://github.com/smnbbrv/projected/commit/24f244442b325ea4cd0b383dc4d47e0687414a67))

# 1.0.0 (2024-12-10)


### Bug Fixes

* fix deps ([b85a5c5](https://github.com/smnbbrv/projected/commit/b85a5c58aa39a98246dad0d12bd297f28e8f35dc))


### Features

* init ([167fd0d](https://github.com/smnbbrv/projected/commit/167fd0d93d3a6074360aaa5c1ae95bd5ed100f8c))
