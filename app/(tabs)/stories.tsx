import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator, FlatList, Image, Modal,
    ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import { getProfile, getStoryViewers, listStories, postStory, viewStory } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicUser, Story } from '@/types/chat';

const BG_COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
const TEXT_COLORS = ['#ffffff', '#fef08a', '#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#111827'];

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`;
  return `${h}h ago`;
};

export default function StoriesScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const { socket } = useRealtime();

  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [myId, setMyId] = useState('');

  // Viewer modal
  const [viewing, setViewing] = useState<Story | null>(null);
  const [viewersList, setViewersList] = useState<PublicUser[]>([]);
  const [viewersCount, setViewersCount] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  const [loadingViewers, setLoadingViewers] = useState(false);

  // Compose modal
  const [composing, setComposing] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [storyBg, setStoryBg] = useState(BG_COLORS[0]);
  const [storyTextColor, setStoryTextColor] = useState(TEXT_COLORS[0]);
  const [storyImage, setStoryImage] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, profile] = await Promise.all([listStories(), getProfile()]);
      setStories(data.stories ?? []);
      if (profile?.id) setMyId(profile.id);
    } catch {}
    setIsLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (p: any) => {
      if (p?.story) setStories((prev) => [p.story, ...prev.filter((s) => s.id !== p.story.id)]);
    };
    socket.on('story:new', onNew);
    return () => { socket.off('story:new', onNew); };
  }, [socket]);

  const openStory = useCallback(async (story: Story) => {
    setViewing(story);
    setShowViewers(false);
    setViewersList([]);
    setViewersCount(story.viewedBy.length);
    if (!story.viewedBy.includes(myId)) {
      await viewStory(story.id).catch(() => {});
      setStories((prev) => prev.map((s) =>
        s.id === story.id ? { ...s, viewedBy: [...s.viewedBy, myId] } : s
      ));
      setViewersCount((c) => c + 1);
    }
  }, [myId]);

  const openViewers = useCallback(async (story: Story) => {
    setLoadingViewers(true);
    setShowViewers(true);
    try {
      const data = await getStoryViewers(story.id);
      setViewersList(data.viewers ?? []);
      setViewersCount(data.count ?? 0);
    } catch {}
    setLoadingViewers(false);
  }, []);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [9, 16],
      quality: 0.4,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setStoryImage(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    }
  };

  const onPost = async () => {
    if (!storyText.trim() && !storyImage) return;
    setPosting(true);
    try {
      const data = await postStory({
        text: storyText.trim(),
        image: storyImage,
        bgColor: storyBg,
        textColor: storyTextColor,
      });
      if (data?.story) {
        setStories((prev) => [data.story, ...prev]);
        if (data.story.author?.id) setMyId(data.story.author.id);
      }
      setComposing(false);
      setStoryText('');
      setStoryImage('');
      setStoryBg(BG_COLORS[0]);
      setStoryTextColor(TEXT_COLORS[0]);
    } catch {}
    setPosting(false);
  };

  const grouped = React.useMemo(() => {
    const map = new Map<string, Story[]>();
    stories.forEach((s) => {
      const key = s.author.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.values());
  }, [stories]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Stories</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setComposing(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : grouped.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.empty, { color: colors.subtext }]}>No stories yet.</Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
            onPress={() => setComposing(true)}
            activeOpacity={0.85}
          >
            <Text style={[styles.emptyBtnText, { color: '#fff' }]}>Add your story</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(g) => g[0].author.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: group }) => {
            const author = group[0].author;
            const latest = group[0];
            const allViewed = group.every((s) => s.viewedBy.includes(myId));
            const isMe = author.id === myId;
            const totalViews = group.reduce((sum, s) => sum + s.viewedBy.length, 0);
            return (
              <TouchableOpacity
                style={[styles.storyRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => openStory(latest)}
                activeOpacity={0.85}
              >
                <View style={[styles.avatarRing, { borderColor: allViewed ? colors.border : colors.primary }]}>
                  {author.profileImage
                    ? <Image source={{ uri: author.profileImage }} style={styles.storyAvatar} />
                    : <View style={[styles.storyAvatar, styles.avatarFallback, { backgroundColor: latest.bgColor }]}>
                        <Text style={styles.avatarInitial}>{author.name?.slice(0, 1)?.toUpperCase()}</Text>
                      </View>
                  }
                </View>
                <View style={styles.storyInfo}>
                  <Text style={[styles.storyAuthor, { color: colors.text }]} numberOfLines={1}>
                    {isMe ? 'Your story' : author.name}
                  </Text>
                  <Text style={[styles.storyMeta, { color: colors.subtext }]} numberOfLines={1}>
                    {group.length > 1 ? `${group.length} stories · ` : ''}{timeAgo(latest.createdAt)}
                  </Text>
                </View>
                {isMe ? (
                  <TouchableOpacity
                    style={[styles.viewsBtn, { borderColor: colors.border }]}
                    onPress={() => { setViewing(latest); openViewers(latest); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="eye-outline" size={14} color={colors.subtext} />
                    <Text style={[styles.viewsCount, { color: colors.subtext }]}>{totalViews}</Text>
                  </TouchableOpacity>
                ) : (
                  !allViewed && <View style={[styles.unviewedDot, { backgroundColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Story viewer modal */}
      <Modal visible={!!viewing} animationType="slide" onRequestClose={() => { setViewing(null); setShowViewers(false); }}>
        {viewing && (
          <View style={[styles.viewer, { backgroundColor: viewing.bgColor }]}>
            {viewing.image
              ? <Image source={{ uri: viewing.image }} style={styles.viewerImage} resizeMode="cover" />
              : null
            }
            <View style={styles.viewerOverlay}>
              {/* Top bar */}
              <View style={styles.viewerHeader}>
                <View style={styles.viewerAuthorRow}>
                  {viewing.author.profileImage
                    ? <Image source={{ uri: viewing.author.profileImage }} style={styles.viewerAvatar} />
                    : <View style={[styles.viewerAvatar, { backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: '#fff', fontSize: 16 }}>{viewing.author.name?.slice(0, 1)?.toUpperCase()}</Text>
                      </View>
                  }
                  <View>
                    <Text style={styles.viewerName}>{viewing.author.id === myId ? 'Your story' : viewing.author.name}</Text>
                    <Text style={styles.viewerTime}>{timeAgo(viewing.createdAt)}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => { setViewing(null); setShowViewers(false); }} style={styles.viewerClose}>
                  <Ionicons name="close" size={26} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Story text */}
              {viewing.text ? (
                <View style={styles.viewerTextWrap}>
                  <Text style={[styles.viewerText, { color: viewing.textColor || '#fff' }]}>{viewing.text}</Text>
                </View>
              ) : null}

              {/* Bottom bar — view count (owner only) */}
              {viewing.author.id === myId && (
                <TouchableOpacity
                  style={styles.viewerFooter}
                  onPress={() => openViewers(viewing)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="eye-outline" size={18} color="rgba(255,255,255,0.85)" />
                  <Text style={styles.viewerFooterText}>{viewersCount} view{viewersCount !== 1 ? 's' : ''}</Text>
                  <Ionicons name="chevron-up" size={16} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              )}
            </View>

            {/* Viewers sheet */}
            {showViewers && (
              <View style={[styles.viewersSheet, { backgroundColor: colors.background }]}>
                <View style={[styles.viewersSheetHandle, { backgroundColor: colors.border }]} />
                <Text style={[styles.viewersTitle, { color: colors.text }]}>
                  {viewersCount} view{viewersCount !== 1 ? 's' : ''}
                </Text>
                {loadingViewers ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
                ) : viewersList.length === 0 ? (
                  <Text style={[styles.noViewers, { color: colors.subtext }]}>No views yet</Text>
                ) : (
                  <FlatList
                    data={viewersList}
                    keyExtractor={(u) => u.id}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    renderItem={({ item: u }) => (
                      <View style={styles.viewerRow}>
                        {u.profileImage
                          ? <Image source={{ uri: u.profileImage }} style={styles.viewerRowAvatar} />
                          : <View style={[styles.viewerRowAvatar, styles.viewerRowFallback, { backgroundColor: colors.surface }]}>
                              <Text style={[styles.viewerRowInitial, { color: colors.subtext }]}>{u.name?.slice(0, 1)?.toUpperCase()}</Text>
                            </View>
                        }
                        <Text style={[styles.viewerRowName, { color: colors.text }]} numberOfLines={1}>{u.name}</Text>
                      </View>
                    )}
                  />
                )}
                <TouchableOpacity style={styles.viewersClose} onPress={() => setShowViewers(false)}>
                  <Ionicons name="chevron-down" size={22} color={colors.subtext} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Modal>

      {/* Compose story modal */}
      <Modal visible={composing} animationType="slide" onRequestClose={() => setComposing(false)}>
        <View style={[styles.compose, { backgroundColor: colors.background }]}>
          <View style={[styles.composeHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setComposing(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.composeTitle, { color: colors.text }]}>New Story</Text>
            <TouchableOpacity
              onPress={onPost}
              disabled={posting || (!storyText.trim() && !storyImage)}
              style={[styles.postBtn, { backgroundColor: colors.primary, opacity: posting ? 0.6 : 1 }]}
            >
              {posting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.postBtnText}>Post</Text>
              }
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.composeBody}>
            <View style={[styles.preview, { backgroundColor: storyBg }]}>
              {storyImage
                ? <Image source={{ uri: storyImage }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                : null
              }
              {storyText ? (
                <View style={styles.previewTextPanel}>
                  <Text style={[styles.previewText, { color: storyTextColor }]}>{storyText}</Text>
                </View>
              ) : null}
            </View>
            <TextInput
              value={storyText}
              onChangeText={setStoryText}
              placeholder="What's on your mind?"
              placeholderTextColor="#999"
              multiline
              maxLength={200}
              style={[styles.storyInput, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
            />
            <TouchableOpacity
              style={[styles.imagePicker, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={pickImage}
              activeOpacity={0.85}
            >
              <Ionicons name="image-outline" size={20} color={colors.primary} />
              <Text style={[styles.imagePickerText, { color: colors.primary }]}>
                {storyImage ? 'Change image' : 'Add image'}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.bgLabel, { color: colors.subtext }]}>Background</Text>
            <View style={styles.bgRow}>
              {BG_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.bgSwatch, { backgroundColor: c, borderWidth: storyBg === c ? 3 : 0, borderColor: '#fff' }]}
                  onPress={() => setStoryBg(c)}
                />
              ))}
            </View>
            <Text style={[styles.bgLabel, { color: colors.subtext }]}>Text color</Text>
            <View style={styles.bgRow}>
              {TEXT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.textSwatch,
                    {
                      backgroundColor: c,
                      borderWidth: storyTextColor === c ? 3 : 1,
                      borderColor: storyTextColor === c ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setStoryTextColor(c)}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: 'KshanaFont', fontSize: 20 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  empty: { fontFamily: 'KshanaFont', fontSize: 15 },
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  emptyBtnText: { fontFamily: 'KshanaFont', fontSize: 14 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  storyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  avatarRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 2.5, padding: 2 },
  storyAvatar: { width: 46, height: 46, borderRadius: 23 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontFamily: 'KshanaFont', fontSize: 18 },
  storyInfo: { flex: 1 },
  storyAuthor: { fontFamily: 'KshanaFont', fontSize: 15 },
  storyMeta: { fontFamily: 'KshanaFont', fontSize: 12, marginTop: 2 },
  unviewedDot: { width: 10, height: 10, borderRadius: 5 },
  viewsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  viewsCount: { fontFamily: 'KshanaFont', fontSize: 12 },
  // Viewer
  viewer: { flex: 1 },
  viewerImage: { ...StyleSheet.absoluteFillObject },
  viewerOverlay: { flex: 1, justifyContent: 'flex-start' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingTop: 56 },
  viewerAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewerAvatar: { width: 40, height: 40, borderRadius: 20 },
  viewerName: { color: '#fff', fontFamily: 'KshanaFont', fontSize: 15, fontWeight: '700' },
  viewerTime: { color: 'rgba(255,255,255,0.7)', fontFamily: 'KshanaFont', fontSize: 12 },
  viewerClose: { padding: 4 },
  viewerTextWrap: { marginTop: 'auto', paddingHorizontal: 24, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.28)' },
  viewerText: { fontFamily: 'KshanaFont', fontSize: 22, textAlign: 'center' },
  viewerFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.18)' },
  viewerFooterText: { color: 'rgba(255,255,255,0.85)', fontFamily: 'KshanaFont', fontSize: 15, flex: 1 },
  // Viewers sheet
  viewersSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%' },
  viewersSheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  viewersTitle: { fontFamily: 'KshanaFont', fontSize: 16, marginBottom: 14 },
  noViewers: { fontFamily: 'KshanaFont', fontSize: 14, textAlign: 'center', marginTop: 20 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  viewerRowAvatar: { width: 40, height: 40, borderRadius: 20 },
  viewerRowFallback: { alignItems: 'center', justifyContent: 'center' },
  viewerRowInitial: { fontFamily: 'KshanaFont', fontSize: 16 },
  viewerRowName: { fontFamily: 'KshanaFont', fontSize: 14, flex: 1 },
  viewersClose: { alignSelf: 'center', padding: 8, marginTop: 4 },
  // Compose
  compose: { flex: 1 },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 52, borderBottomWidth: 1 },
  composeTitle: { fontFamily: 'KshanaFont', fontSize: 18 },
  postBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  postBtnText: { color: '#fff', fontFamily: 'KshanaFont', fontSize: 14 },
  composeBody: { padding: 16, gap: 16 },
  preview: { height: 220, borderRadius: 16, justifyContent: 'flex-end', overflow: 'hidden' },
  previewTextPanel: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'rgba(0,0,0,0.28)' },
  previewText: { fontFamily: 'KshanaFont', fontSize: 20, textAlign: 'center' },
  storyInput: { borderWidth: 1, borderRadius: 12, padding: 12, fontFamily: 'KshanaFont', fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  imagePicker: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1, borderRadius: 12, borderStyle: 'dashed' },
  imagePickerText: { fontFamily: 'KshanaFont', fontSize: 14 },
  bgLabel: { fontFamily: 'KshanaFont', fontSize: 13 },
  bgRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  bgSwatch: { width: 36, height: 36, borderRadius: 18 },
  textSwatch: { width: 36, height: 36, borderRadius: 18 },
});
