import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Modal, Pressable,
  Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';

import { FabMenu } from '@/components/FabMenu';
import TopNav from '@/components/TopNav';
import { getProfile, listStories, viewStory } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicConversation, PublicUser, Story } from '@/types/chat';

const formatTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`;
  return `${h}h ago`;
};

export default function ChatsScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const {
    online, unreadByConversation, unreadPreviewByConversation, conversations, refreshConversations,
    storyAuthors, viewedStoryAuthors, markStoryAuthorViewed, moods,
  } = useRealtime();

  const [me, setMe] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(conversations.length === 0);

  // Story viewer state
  const [storyViewer, setStoryViewer] = useState<Story | null>(null);

  useEffect(() => {
    getProfile()
      .then((d) => setMe({ id: d.id, name: d.name, email: d.email, description: d.description, profileImage: d.profileImage }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (conversations.length === 0) {
      setIsLoading(true);
      refreshConversations().finally(() => setIsLoading(false));
    }
  }, []); // eslint-disable-line

  const openConversation = useCallback(
    (id: string) => router.push({ pathname: '/(tabs)/chat/[conversationId]', params: { conversationId: id } }),
    [router]
  );

  // Tap avatar → fetch that user's latest story and open viewer
  const openUserStory = useCallback(async (userId: string) => {
    try {
      const data = await listStories();
      const userStories: Story[] = (data.stories ?? []).filter((s: Story) => s.author.id === userId);
      if (!userStories.length) return;
      const latest = userStories[0];
      setStoryViewer(latest);
      // Mark as viewed
      markStoryAuthorViewed(userId);
      await viewStory(latest.id).catch(() => {});
    } catch {}
  }, [markStoryAuthorViewed]);

  const closeStory = useCallback(() => setStoryViewer(null), []);

  const renderItem = useCallback(
    ({ item }: { item: PublicConversation }) => {
      const other = item.participants.find((p) => p.id !== me?.id) ?? item.participants[0];
      const unread = unreadByConversation[item.id] || 0;
      const hasUnread = unread > 0;
      const unreadPreview = unreadPreviewByConversation[item.id];
      const previewText = hasUnread && unreadPreview
        ? unreadPreview
        : (item.lastMessage?.text || 'Tap to start chatting');
      const hasStory = other ? storyAuthors.has(other.id) : false;
      const storyViewed = other ? viewedStoryAuthors.has(other.id) : false;

      // Ring color: vivid primary = unviewed, dull subtext = viewed, transparent = no story
      const ringColor = hasStory
        ? (storyViewed ? colors.subtext : colors.primary)
        : 'transparent';

      return (
        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.row,
            { backgroundColor: colors.surface, borderColor: hasUnread ? colors.primary : colors.border },
            hasUnread && styles.rowUnread,
          ]}
          onPress={() => openConversation(item.id)}
        >
          <View style={styles.presenceDotWrap}>
            <View style={[styles.presenceDot, { backgroundColor: other && online.has(other.id) ? colors.primary : colors.border }]} />
          </View>

          {/* Tappable avatar with story ring */}
          <TouchableOpacity
            activeOpacity={hasStory ? 0.75 : 1}
            onPress={hasStory && other ? () => openUserStory(other.id) : undefined}
            style={[styles.avatarRing, { borderColor: ringColor }]}
          >
            {other?.profileImage ? (
              <Image source={{ uri: other.profileImage }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.avatarText, { color: colors.subtext }]}>
                  {other?.name?.slice(0, 1)?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            {/* Mood indicator floating bubble */}
            {other && (moods[other.id] ?? other?.mood) && (
              <View style={styles.moodBubble}>
                <Text style={styles.moodEmoji}>{((moods[other.id] ?? other?.mood) || '').split(' ')[0]}</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.rowText}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{other?.name || 'Chat'}</Text>
            <Text
              style={[styles.subtitle, { color: hasUnread ? colors.primary : colors.subtext, fontWeight: hasUnread ? '700' : '400' }]}
              numberOfLines={1}
            >
              {previewText}
            </Text>
          </View>

          <View style={styles.rightCol}>
            <Text style={[styles.time, { color: colors.subtext }]}>
              {formatTime(item.lastMessage?.createdAt || item.updatedAt)}
            </Text>
            {hasUnread && (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={[styles.badgeText, { color: colors.background }]}>
                  {unread > 99 ? '99+' : String(unread)}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [colors, me?.id, online, unreadByConversation, unreadPreviewByConversation, openConversation, storyAuthors, viewedStoryAuthors, openUserStory, moods]
  );

  const emptyText = useMemo(() => (isLoading ? '' : 'No chats yet. Start one from People.'), [isLoading]);

  const extraData = useMemo(
    () => ({ unreadByConversation, unreadPreviewByConversation, storyAuthors, viewedStoryAuthors, onlineSize: online.size, moods }),
    [unreadByConversation, unreadPreviewByConversation, storyAuthors, viewedStoryAuthors, online, moods]
  );

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
          extraData={extraData}
          contentContainerStyle={conversations.length ? styles.list : styles.listEmpty}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.subtext }]}>{emptyText}</Text>}
        />
      )}
      <FabMenu />

      {/* Inline story viewer */}
      <Modal visible={!!storyViewer} animationType="fade" transparent onRequestClose={closeStory}>
        {storyViewer && (
          <Pressable style={styles.storyOverlay} onPress={closeStory}>
            <View style={[styles.storyCard, { backgroundColor: storyViewer.bgColor }]}>
              {storyViewer.image
                ? <Image source={{ uri: storyViewer.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : null
              }
              {/* Header */}
              <View style={styles.storyHeader}>
                <View style={styles.storyAuthorRow}>
                  {storyViewer.author.profileImage
                    ? <Image source={{ uri: storyViewer.author.profileImage }} style={styles.storyAvatar} />
                    : <View style={[styles.storyAvatar, { backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: '#fff', fontSize: 14 }}>{storyViewer.author.name?.slice(0, 1)?.toUpperCase()}</Text>
                      </View>
                  }
                  <View>
                    <Text style={styles.storyAuthorName}>{storyViewer.author.name}</Text>
                    <Text style={styles.storyTime}>{timeAgo(storyViewer.createdAt)}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={closeStory} style={styles.storyClose}>
                  <Ionicons name="close" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
              {/* Text */}
              {storyViewer.text ? (
                <View style={styles.storyTextWrap}>
                  <Text style={[styles.storyText, { color: storyViewer.textColor || '#fff' }]}>{storyViewer.text}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )}
      </Modal>
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
  avatarRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2.5, padding: 2 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'KshanaFont', fontSize: 16 },
  moodBubble: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0px 2px 6px rgba(0, 0, 0, 0.15)' }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, elevation: 3 }),
  },
  moodEmoji: { fontSize: 16 },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: 'KshanaFont', fontSize: 16 },
  subtitle: { fontFamily: 'KshanaFont', fontSize: 13 },
  time: { fontFamily: 'KshanaFont', fontSize: 12 },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'KshanaFont', fontSize: 11 },
  // Story viewer
  storyOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  storyCard: { width: '100%', maxWidth: 400, height: 520, borderRadius: 20, overflow: 'hidden', justifyContent: 'space-between' },
  storyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 20 },
  storyAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  storyAvatar: { width: 36, height: 36, borderRadius: 18 },
  storyAuthorName: { color: '#fff', fontFamily: 'KshanaFont', fontSize: 14, fontWeight: '700' },
  storyTime: { color: 'rgba(255,255,255,0.7)', fontFamily: 'KshanaFont', fontSize: 11 },
  storyClose: { padding: 4 },
  storyTextWrap: { padding: 20, paddingBottom: 32, backgroundColor: 'rgba(0,0,0,0.28)' },
  storyText: { fontFamily: 'KshanaFont', fontSize: 20, textAlign: 'center' },
});
