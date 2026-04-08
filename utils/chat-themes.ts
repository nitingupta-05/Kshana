import type { ChatTheme } from '@/types/chat';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'kshana_chat_themes_v1';

export const DEFAULT_THEME: ChatTheme = {
  myBubble: '#F59E0B',
  theirBubble: '#292524',
  myText: '#FFF7ED',
  theirText: '#FFF7ED',
};

export const PRESET_THEMES: Record<string, ChatTheme> = {
  default: DEFAULT_THEME,
  ocean: { myBubble: '#0ea5e9', theirBubble: '#1e293b', myText: '#fff', theirText: '#e2e8f0' },
  forest: { myBubble: '#10b981', theirBubble: '#1c2617', myText: '#fff', theirText: '#d1fae5' },
  sunset: { myBubble: '#f97316', theirBubble: '#292524', myText: '#fff', theirText: '#fed7aa' },
  rose: { myBubble: '#ec4899', theirBubble: '#2d1b2e', myText: '#fff', theirText: '#fce7f3' },
  purple: { myBubble: '#a855f7', theirBubble: '#1e1b4b', myText: '#fff', theirText: '#e9d5ff' },
};

let _cache: Record<string, ChatTheme> = {};

export const getChatTheme = async (conversationId: string): Promise<ChatTheme> => {
  if (_cache[conversationId]) return _cache[conversationId];
  try {
    const raw = await AsyncStorage.getItem(THEME_KEY);
    if (raw) {
      const all = JSON.parse(raw);
      _cache = all;
      return all[conversationId] ?? DEFAULT_THEME;
    }
  } catch {}
  return DEFAULT_THEME;
};

export const setChatTheme = async (conversationId: string, theme: ChatTheme) => {
  try {
    const raw = await AsyncStorage.getItem(THEME_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[conversationId] = theme;
    _cache = all;
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify(all));
  } catch {}
};
