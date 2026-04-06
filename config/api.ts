import { emitAuthRequired } from '@/utils/auth-events';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_BASE_URL = 'http://10.184.118.122:5001/api';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL;
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

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
) => {
  try {
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

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('Non-JSON response:', text);
      throw new Error('Server error - backend not responding correctly');
    }

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        await removeToken();
        emitAuthRequired();
        throw new Error('Session expired. Please login again.');
      }
      throw new Error(data.msg || 'Request failed');
    }

    return data;
  } catch (error: any) {
    console.error('API Error:', error.message);

    if (error.message?.includes('JSON')) {
      throw new Error('Server error - please restart backend');
    }

    throw new Error(error.message || 'Network error');
  }
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
