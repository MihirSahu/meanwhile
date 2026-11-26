import type { ResearchBundle } from "./scene-provider";

/** Bounded process-local evidence cache. Failed/canceled/in-flight work is never shared. */
export class ResearchCache {
  private entries = new Map<
    string,
    { expires: number; bundle: ResearchBundle }
  >();
  constructor(
    private readonly capacity = 32,
    private readonly now = Date.now,
  ) {}
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.bundle);
  }
  set(key: string, bundle: ResearchBundle, ttlSeconds: number) {
    if (ttlSeconds <= 0) return;
    this.entries.delete(key);
    while (this.entries.size >= this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, {
      bundle: structuredClone(bundle),
      expires: this.now() + ttlSeconds * 1000,
    });
  }
  clear() {
    this.entries.clear();
  }
  delete(key: string) {
    this.entries.delete(key);
  }
}

export const researchCache = new ResearchCache();
