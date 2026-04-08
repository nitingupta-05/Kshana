import { emitAuthRequired } from '@/utils/auth-events';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const normalizeApiBase = (raw: string) => {
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
};

const normalizeOrigin = (raw: string) =>
  raw.replace(/\/+$/, '').replace(/\/api$/, '');

const PRIMARY_API_INPUT =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  process.env.EXPO_PUBLIC_API_ORIGIN?.trim() ||
  'http://10.107.154.122:5001';

const FALLBACK_ORIGINS = Platform.select({
  android: ['http://10.0.2.2:5001', 'http://127.0.0.1:5001', 'http://localhost:5001'],
  default: ['http://localhost:5001', 'http://127.0.0.1:5001', 'http://10.0.2.2:5001'],
}) as string[];

const API_ORIGINS = Array.from(
  new Set([normalizeOrigin(PRIMARY_API_INPUT), ...FALLBACK_ORIGINS.map(normalizeOrigin)])
);

export const API_ORIGIN = API_ORIGINS[0];
export const API_BASE_URL = normalizeApiBase(API_ORIGIN);
export const getApiOrigin = () => API_ORIGIN;
export const getApiOrigins = () => [...API_ORIGINS];

const API_LOG_THROTTLE_MS = 5000;
let lastApiLogAt = 0;

const logApiError = (label: string, detail?: string) => {
  const now = Date.now();
  if (now - lastApiLogAt < API_LOG_THROTTLE_MS) return;
  lastApiLogAt = now;
  if (detail) {
    console.warn(label, detail);
  } else {
    console.warn(label);
  }
};

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out. Please try again.')), timeoutMs);
  });
  try {
    const response = await Promise.race([fetch(url, options), timeoutPromise]) as Response;
    return response;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildCandidateUrls = (url: string): string[] => {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (!parsed.pathname.startsWith('/api')) return [url];

    const candidates = API_ORIGINS.map((origin) => `${origin}${path}`);
    if (!candidates.includes(url)) candidates.unshift(url);
    return Array.from(new Set(candidates));
  } catch {
    return [url];
  }
};

const shouldTryNextOrigin = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('request timed out') ||
    lower.includes('socket') ||
    lower.includes('backend is sleeping') ||
    lower.includes('server is unavailable') ||
    lower.includes('unexpected server response')
  );
};

export const API_ENDPOINTS = {
  LOGIN: `${API_BASE_URL}/auth/login`,
  REGISTER: `${API_BASE_URL}/auth/register`,
  LOGOUT: `${API_BASE_URL}/auth/logout`,
  VERIFY: `${API_BASE_URL}/auth/verify`,
  PROFILE: `${API_BASE_URL}/user/profile`,
  UPDATE_PROFILE: `${API_BASE_URL}/user/update`,
  USERS: `${API_BASE_URL}/users`,
  CONVERSATIONS: `${API_BASE_URL}/conversations`,
  PRESENCE_ONLINE: `${API_BASE_URL}/presence/online`,
  SUGGESTIONS: `${API_BASE_URL}/suggestions`,
  REQUESTS: `${API_BASE_URL}/requests`,
  REQUESTS_INCOMING: `${API_BASE_URL}/requests/incoming`,
  REQUESTS_SENT: `${API_BASE_URL}/requests/sent`,
  NOTIFICATIONS: `${API_BASE_URL}/notifications`,
  NOTIFICATIONS_UNREAD_COUNT: `${API_BASE_URL}/notifications/unread-count`,
  PUSH_REGISTER: `${API_BASE_URL}/push/register`,
  CONVERSATIONS_UNREAD: `${API_BASE_URL}/conversations/unread-counts`,
};

export const conversationUrl = (conversationId: string) =>
  `${API_BASE_URL}/conversations/${conversationId}`;

export const conversationMessagesUrl = (conversationId: string) =>
  `${API_BASE_URL}/conversations/${conversationId}/messages`;

export const apiCall = async (
  url: string,
  method: string,
  body?: any,
  requiresAuth: boolean = false
): Promise<any> => {
  const headers: any = {
    'Content-Type': 'application/json',
  };

  if (requiresAuth) {
    const token = await AsyncStorage.getItem('authToken');
    if (!token) {
      await removeToken();
      emitAuthRequired();
      throw new Error('Session expired. Please login again.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const requestUrls = buildCandidateUrls(url);
  let lastError = 'Network error';

  for (let index = 0; index < requestUrls.length; index += 1) {
    const requestUrl = requestUrls[index];
    const hasFallback = index < requestUrls.length - 1;

    try {
      const response = await fetchWithTimeout(
        requestUrl,
        {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        },
        12000
      );

      const contentType = response.headers.get('content-type') || '';
      let data: any = null;

      if (contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch {
          throw new Error('Server error - invalid JSON response');
        }
      } else {
        const text = await response.text();
        const lower = text.toLowerCase();
        const nonJsonDetail = `${response.status} ${text.slice(0, 200)}`;

        if ((response.status === 404 || response.status === 521 || response.status >= 500) && hasFallback) {
          continue;
        }

        if (response.status === 521 || lower.includes('error code: 521')) {
          throw new Error('Backend is sleeping or unreachable. Please try again in a minute.');
        }

        if (response.status >= 500) {
          throw new Error('Server is unavailable. Please try again.');
        }

        logApiError('Non-JSON response:', `${nonJsonDetail} @ ${requestUrl}`);
        throw new Error('Unexpected server response.');
      }

      if (!response.ok) {
        if (response.status === 401) {
          await removeToken();
          emitAuthRequired();
          throw new Error('Session expired. Please login again.');
        }
        if (response.status === 404 && hasFallback) {
          continue;
        }
        throw new Error(data?.msg || data?.message || `Request failed (${response.status})`);
      }

      return data;
    } catch (error: any) {
      const msg = error?.message || 'Network error';
      lastError = msg;
      if (hasFallback && shouldTryNextOrigin(msg)) {
        continue;
      }
      logApiError('API Error:', `${msg} @ ${requestUrl}`);
      throw new Error(msg);
    }
  }

  logApiError('API Error:', lastError);
  throw new Error(lastError);
};

// ================= TOKEN MANAGEMENT =================

export const saveToken = async (token: string) => {
  try {
    await AsyncStorage.setItem('authToken', token);
  } catch (error) {
    console.error('Save token error:', error);
  }
};

export const getToken = async () => {
  try {
    return await AsyncStorage.getItem('authToken');
  } catch (error) {
    console.error('Get token error:', error);
    return null;
  }
};

export const removeToken = async () => {
  try {
    await AsyncStorage.removeItem('authToken');
  } catch (error) {
    console.error('Remove token error:', error);
  }
};

// ================= CREDENTIALS =================

export const saveLastCredentials = async (email: string, password: string) => {
  try {
    await AsyncStorage.setItem(
      'lastCredentials',
      JSON.stringify({ email: email.trim(), password })
    );
  } catch (error) {
    console.error('Save credentials error:', error);
  }
};

export const getLastCredentials = async () => {
  try {
    const raw = await AsyncStorage.getItem('lastCredentials');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email || !parsed?.password) return null;
    return { email: String(parsed.email), password: String(parsed.password) };
  } catch (error) {
    console.error('Get credentials error:', error);
    return null;
  }
};

// ================= AUTH HELPERS =================

export const verifyToken = async () => {
  try {
    const token = await getToken();
    if (!token) return false;

    const data = await apiCall(API_ENDPOINTS.VERIFY, 'GET', undefined, true);
    return data.valid === true;
  } catch (error) {
    console.error('Token verify failed:', error);
    return false;
  }
};

// ================= USER HELPERS =================

export const getProfile = async () => {
  return await apiCall(API_ENDPOINTS.PROFILE, 'GET', undefined, true);
};

export const updateProfile = async (payload: {
  name: string;
  description: string;
  profileImage?: string;
}) => {
  return await apiCall(API_ENDPOINTS.UPDATE_PROFILE, 'PATCH', payload, true);
};

// ================= CHAT HELPERS =================

export const listUsers = async (search?: string) => {
  const q = (search || '').trim();
  const url = q
    ? `${API_ENDPOINTS.USERS}?q=${encodeURIComponent(q)}`
    : API_ENDPOINTS.USERS;
  return await apiCall(url, 'GET', undefined, true);
};

export const listConversations = async () => {
  return await apiCall(API_ENDPOINTS.CONVERSATIONS, 'GET', undefined, true);
};

export const getConversation = async (conversationId: string) => {
  return await apiCall(conversationUrl(conversationId), 'GET', undefined, true);
};

export const createConversation = async (participantId: string) => {
  return await apiCall(API_ENDPOINTS.CONVERSATIONS, 'POST', { participantId }, true);
};

export const listMessages = async (conversationId: string, limit: number = 50) => {
  const url = `${conversationMessagesUrl(conversationId)}?limit=${encodeURIComponent(
    String(limit)
  )}`;
  return await apiCall(url, 'GET', undefined, true);
};

export const sendMessage = async (conversationId: string, text: string) => {
  return await apiCall(conversationMessagesUrl(conversationId), 'POST', { text }, true);
};

export const fetchOnline = async () => {
  return await apiCall(API_ENDPOINTS.PRESENCE_ONLINE, 'GET', undefined, true);
};

export const listSuggestions = async () => {
  return await apiCall(API_ENDPOINTS.SUGGESTIONS, 'GET', undefined, true);
};

export const sendRequest = async (toUserId: string) => {
  return await apiCall(API_ENDPOINTS.REQUESTS, 'POST', { toUserId }, true);
};

export const listIncomingRequests = async () => {
  return await apiCall(API_ENDPOINTS.REQUESTS_INCOMING, 'GET', undefined, true);
};

export const listSentRequests = async (): Promise<Record<string, 'pending' | 'accepted' | 'rejected'>> => {
  const data = await apiCall(API_ENDPOINTS.REQUESTS_SENT, 'GET', undefined, true);
  return data.map ?? {};
};

export const acceptRequest = async (requestId: string) => {
  return await apiCall(`${API_ENDPOINTS.REQUESTS}/${requestId}/accept`, 'POST', undefined, true);
};

export const rejectRequest = async (requestId: string) => {
  return await apiCall(`${API_ENDPOINTS.REQUESTS}/${requestId}/reject`, 'POST', undefined, true);
};

export const listNotifications = async (opts?: { unreadOnly?: boolean; limit?: number }) => {
  const unread = opts?.unreadOnly ? '1' : '0';
  const limit = opts?.limit ?? 50;
  const url = `${API_ENDPOINTS.NOTIFICATIONS}?unread=${encodeURIComponent(unread)}&limit=${encodeURIComponent(
    String(limit)
  )}`;
  return await apiCall(url, 'GET', undefined, true);
};

export const getUnreadNotificationCount = async () => {
  return await apiCall(API_ENDPOINTS.NOTIFICATIONS_UNREAD_COUNT, 'GET', undefined, true);
};

export const markNotificationRead = async (notificationId: string) => {
  return await apiCall(
    `${API_ENDPOINTS.NOTIFICATIONS}/${notificationId}/read`,
    'POST',
    undefined,
    true
  );
};

export const markAllNotificationsRead = async () => {
  return await apiCall(`${API_ENDPOINTS.NOTIFICATIONS}/read-all`, 'POST', undefined, true);
};

export const registerPushToken = async (token: string, platform: string) => {
  return await apiCall(API_ENDPOINTS.PUSH_REGISTER, 'POST', { token, platform }, true);
};

export const getUnreadConversationCounts = async () => {
  return await apiCall(API_ENDPOINTS.CONVERSATIONS_UNREAD, 'GET', undefined, true);
};

export const markConversationRead = async (conversationId: string) => {
  return await apiCall(`${API_BASE_URL}/conversations/${conversationId}/read`, 'POST', undefined, true);
};

export const setDisappearTimer = async (conversationId: string, seconds: number) => {
  return await apiCall(`${API_BASE_URL}/conversations/${conversationId}/disappear`, 'PATCH', { seconds }, true);
};

export const updateMood = async (mood: string) => {
  return await apiCall(API_ENDPOINTS.UPDATE_PROFILE, 'PATCH', { mood }, true);
};

// ─── Reactions ────────────────────────────────────────────────────────────────

export const reactToMessage = async (messageId: string, emoji: string) => {
  return await apiCall(`${API_BASE_URL}/messages/${messageId}/react`, 'POST', { emoji }, true);
};

// ─── Stories ─────────────────────────────────────────────────────────────────

export const listStories = async () => {
  return await apiCall(`${API_BASE_URL}/stories`, 'GET', undefined, true);
};

export const postStory = async (payload: { text?: string; image?: string; bgColor?: string; textColor?: string }) => {
  return await apiCall(`${API_BASE_URL}/stories`, 'POST', payload, true);
};

export const viewStory = async (storyId: string) => {
  return await apiCall(`${API_BASE_URL}/stories/${storyId}/view`, 'POST', undefined, true);
};

export const getStoryViewers = async (storyId: string) => {
  return await apiCall(`${API_BASE_URL}/stories/${storyId}/viewers`, 'GET', undefined, true);
};

export const getActiveStoryAuthors = async () => {
  return await apiCall(`${API_BASE_URL}/stories/active-authors`, 'GET', undefined, true);
};
