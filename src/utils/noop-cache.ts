import type { ProjectedMapCache } from '../types/cache.js';

export const NOOP_CACHE = {
  has: () => false,
  get: () => {},
  set: () => {},
  delete: () => {},
  clear: () => {},
} as ProjectedMapCache<any, any>;
