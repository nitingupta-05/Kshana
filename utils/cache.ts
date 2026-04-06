import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'kshana_cache_';

export const cacheSet = async (key: string, value: any) => {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ v: value, t: Date.now() }));
  } catch {}
};

export const cacheGet = async <T>(key: string, maxAgeMs = 60_000): Promise<T | null> => {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { v, t } = JSON.parse(raw);
    if (Date.now() - t > maxAgeMs) return null;
    return v as T;
  } catch {
    return null;
  }
};

export const cacheClear = async (key: string) => {
  try { await AsyncStorage.removeItem(PREFIX + key); } catch {}
};
