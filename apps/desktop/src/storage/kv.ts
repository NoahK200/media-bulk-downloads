export interface Store {
  durableGet<T>(key: string): Promise<T | null>;
  durableSet<T>(key: string, value: T): Promise<void>;
  durableUpdate<T>(key: string, update: (current: T | null) => T, maxRetries?: number): Promise<T>;
  close(): void;
}

export async function openStore(path: string): Promise<Store> {
  const kv = await Deno.openKv(path);
  return {
    async durableGet<T>(key: string): Promise<T | null> {
      const res = await kv.get<T>([key]);
      return res.value ?? null;
    },
    async durableSet<T>(key: string, value: T): Promise<void> {
      await kv.set([key], value);
    },
    async durableUpdate<T>(key: string, update: (current: T | null) => T, maxRetries = 200): Promise<T> {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const current = await kv.get<T>([key]);
        const next = update(current.value ?? null);
        const committed = await kv.atomic().check(current).set([key], next).commit();
        if (committed.ok) return next;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5, attempt)));
      }
      throw new Error(`KV update contention exceeded ${maxRetries} retries for ${key}`);
    },
    close() {
      kv.close();
    },
  };
}
