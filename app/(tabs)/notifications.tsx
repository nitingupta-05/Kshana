import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { FabMenu } from '@/components/FabMenu';
import {
    acceptRequest,
    listIncomingRequests,
    listNotifications,
    listSuggestions,
    markAllNotificationsRead,
    markNotificationRead,
    rejectRequest,
    sendRequest,
} from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicUser } from '@/types/chat';

type RequestItem = {
  id: string;
  from: PublicUser;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};

type NotificationItem = {
  id: string;
  type: 'request_received' | 'request_accepted' | 'message';
  data: any;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationsScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const { refreshUnreadCount } = useRealtime();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<RequestItem[]>([]);
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [reqRes, sugRes, notRes] = await Promise.all([
        listIncomingRequests(),
        listSuggestions(),
        listNotifications({ limit: 50 }),
      ]);

      setIncoming(reqRes.requests ?? []);
      setSuggestions(sugRes.users ?? []);
      // exclude message-type notifications — those are handled in the chat list
      setNotifications((notRes.notifications ?? []).filter((n: NotificationItem) => n.type !== 'message'));
      await refreshUnreadCount();
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [refreshUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onAccept = useCallback(
    async (id: string) => {
      try {
        await acceptRequest(id);
        await load();
      } catch (e: any) {
        setError(e.message || 'Failed to accept request');
      }
    },
    [load]
  );

  const onReject = useCallback(
    async (id: string) => {
      try {
        await rejectRequest(id);
        await load();
      } catch (e: any) {
        setError(e.message || 'Failed to reject request');
      }
    },
    [load]
  );

  const onRequest = useCallback(
    async (toUserId: string) => {
      try {
        await sendRequest(toUserId);
        await load();
      } catch (e: any) {
        setError(e.message || 'Failed to send request');
      }
    },
    [load]
  );

  const onMarkRead = useCallback(
    async (id: string) => {
      try {
        await markNotificationRead(id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        await refreshUnreadCount();
      } catch (e: any) {
        setError(e.message || 'Failed to mark read');
      }
    },
    [refreshUnreadCount]
  );

  const onMarkAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      await refreshUnreadCount();
    } catch (e: any) {
      setError(e.message || 'Failed to mark all read');
    }
  }, [refreshUnreadCount]);

  const unreadCountLocal = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        <TouchableOpacity
          style={styles.markAll}
          onPress={onMarkAllRead}
          activeOpacity={0.85}
          disabled={!unreadCountLocal}
        >
          <Text style={[styles.markAllText, { color: unreadCountLocal ? colors.primary : colors.subtext }]}>
            Read all
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {error ? <Text style={[styles.error, { color: colors.ghost }]}>{error}</Text> : null}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Requests</Text>
          {incoming.length === 0 ? (
            <Text style={[styles.muted, { color: colors.subtext }]}>No incoming requests.</Text>
          ) : (
            incoming.map((r) => (
              <View
                key={r.id}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {r.from?.name || 'Unknown'}
                  </Text>
                  <Text style={[styles.cardMeta, { color: colors.subtext }]}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: colors.border }]}
                    onPress={() => onReject(r.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.actionText, { color: colors.ghost }]}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                    onPress={() => onAccept(r.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.actionText, { color: colors.background }]}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 18 }]}>Suggested</Text>
          {suggestions.length === 0 ? (
            <Text style={[styles.muted, { color: colors.subtext }]}>No suggestions right now.</Text>
          ) : (
            suggestions.slice(0, 10).map((u) => (
              <View
                key={u.id}
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {u.name}
                  </Text>
                  <TouchableOpacity
                    style={[styles.pill, { borderColor: colors.border }]}
                    onPress={() => onRequest(u.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.pillText, { color: colors.primary }]}>Request</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.cardMeta, { color: colors.subtext }]} numberOfLines={1}>
                  {u.email}
                </Text>
              </View>
            ))
          )}

          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 18 }]}>All</Text>
          {notifications.length === 0 ? (
            <Text style={[styles.muted, { color: colors.subtext }]}>No notifications.</Text>
          ) : (
            notifications.map((n) => (
              <TouchableOpacity
                key={n.id}
                activeOpacity={0.85}
                onPress={() => {
                  if (!n.readAt) onMarkRead(n.id);
                  if (n.type === 'message' && n.data?.conversationId) {
                    router.push({
                      pathname: '/(tabs)/chat/[conversationId]',
                      params: { conversationId: n.data.conversationId },
                    });
                  }
                }}
                style={[
                  styles.card,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: n.readAt ? 0.75 : 1 },
                ]}
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    {n.type === 'request_received'
                      ? 'New request'
                      : n.type === 'request_accepted'
                      ? 'Request accepted'
                      : 'New message'}
                  </Text>
                  <Text style={[styles.cardMeta, { color: colors.subtext }]}>
                    {new Date(n.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={[styles.cardMeta, { color: colors.subtext }]} numberOfLines={2}>
                  {n.type === 'request_received'
                    ? `From: ${n.data?.from?.name || 'Unknown'}`
                    : n.type === 'request_accepted'
                    ? `By: ${n.data?.by?.name || 'Unknown'}`
                    : `${n.data?.from?.name || 'Unknown'}: ${n.data?.text || 'Message'}`}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <FabMenu />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingTop: 52,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontFamily: 'KshanaFont', fontSize: 18 },
  markAll: { paddingHorizontal: 10, paddingVertical: 8 },
  markAllText: { fontFamily: 'KshanaFont', fontSize: 13 },
  body: { padding: 16, paddingBottom: 120 },
  error: { fontFamily: 'KshanaFont', marginBottom: 10 },
  sectionTitle: { fontFamily: 'KshanaFont', fontSize: 16, marginBottom: 10 },
  muted: { fontFamily: 'KshanaFont', fontSize: 13, marginBottom: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontFamily: 'KshanaFont', fontSize: 14 },
  cardMeta: { fontFamily: 'KshanaFont', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10, justifyContent: 'flex-end' },
  actionBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionText: { fontFamily: 'KshanaFont', fontSize: 13 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
  pillText: { fontFamily: 'KshanaFont', fontSize: 12 },
});
