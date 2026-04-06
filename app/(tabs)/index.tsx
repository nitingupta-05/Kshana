import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { FabMenu } from '@/components/FabMenu';
import TopNav from '@/components/TopNav';
import { getProfile } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicConversation, PublicUser } from '@/types/chat';

const formatTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return isToday ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
};

export default function ChatsScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const { online, unreadByConversation, conversations, refreshConversations } = useRealtime();

  const [me, setMe] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(conversations.length === 0);

  useEffect(() => {
    getProfile().then((d) => setMe({ id: d.id, name: d.name, email: d.email, description: d.description, profileImage: d.profileImage })).catch(() => {});
  }, []);

  useEffect(() => {
    if (conversations.length === 0) {
      setIsLoading(true);
      refreshConversations().finally(() => setIsLoading(false));
    }
  }, []); // eslint-disable-line

  const openConversation = useCallback((id: string) => {
    router.push({ pathname: '/(tabs)/chat/[conversationId]', params: { conversationId: id } });
  }, [router]);

  const renderItem = useCallback(({ item }: { item: PublicConversation }) => {
    const other = item.participants.find((p) => p.id !== me?.id) ?? item.participants[0];
    const unread = unreadByConversation[item.id] || 0;
    const hasUnread = unread > 0;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        style={[styles.row, { backgroundColor: colors.surface, borderColor: hasUnread ? colors.primary : colors.border }, hasUnread && styles.rowUnread]}
        onPress={() => openConversation(item.id)}
      >
        <View style={styles.presenceDotWrap}>
          <View style={[styles.presenceDot, { backgroundColor: other && online.has(other.id) ? colors.primary : colors.border }]} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{other?.name || 'Chat'}</Text>
          <Text style={[styles.subtitle, { color: hasUnread ? colors.primary : colors.subtext, fontWeight: hasUnread ? '700' : '400' }]} numberOfLines={1}>
            {item.lastMessage?.text || 'Tap to start chatting'}
          </Text>
        </View>
        <View style={styles.rightCol}>
          <Text style={[styles.time, { color: colors.subtext }]}>{formatTime(item.lastMessage?.createdAt || item.updatedAt)}</Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.background }]}>{unread > 99 ? '99+' : String(unread)}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [colors, me?.id, online, unreadByConversation, openConversation]);

  const emptyText = useMemo(() => isLoading ? '' : 'No chats yet. Start one from People.', [isLoading]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TopNav />
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={unreadByConversation}
          contentContainerStyle={conversations.length ? styles.list : styles.listEmpty}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.subtext }]}>{emptyText}</Text>}
        />
      )}
      <FabMenu />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 96, gap: 12 },
  listEmpty: { flex: 1, padding: 16, justifyContent: 'center' },
  emptyText: { textAlign: 'center', fontFamily: 'KshanaFont', fontSize: 14 },
  row: { paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowUnread: { borderWidth: 1.5 },
  presenceDotWrap: { width: 14, alignItems: 'center' },
  presenceDot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: 'KshanaFont', fontSize: 16 },
  subtitle: { fontFamily: 'KshanaFont', fontSize: 13 },
  time: { fontFamily: 'KshanaFont', fontSize: 12 },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'KshanaFont', fontSize: 11 },
});
