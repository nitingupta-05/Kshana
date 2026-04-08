import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, FlatList, Image, KeyboardAvoidingView,
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getConversation, getProfile, listMessages, markConversationRead, reactToMessage, sendMessage, setDisappearTimer } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { ChatTheme, PublicConversation, PublicMessage, PublicUser, Reaction } from '@/types/chat';
import { getChatTheme, PRESET_THEMES, setChatTheme } from '@/utils/chat-themes';

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];
const DISAPPEAR_OPTIONS = [
  { label: 'Off', seconds: 0 },
  { label: '30 sec', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
];

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

type Sep = { _type: 'sep'; id: string; label: string };
type Msg = PublicMessage & { _type: 'msg' };
type Item = Sep | Msg;

const buildItems = (msgs: PublicMessage[]): Item[] => {
  const out: Item[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const day = m.createdAt ? new Date(m.createdAt).toDateString() : '';
    if (day && day !== lastDay) { lastDay = day; out.push({ _type: 'sep', id: `s_${day}`, label: dayLabel(m.createdAt) }); }
    out.push({ ...m, _type: 'msg' });
  }
  return out.reverse();
};

function Ticks({ status, color, subtext }: { status: 'sent' | 'delivered' | 'read'; color: string; subtext: string }) {
  const c = status === 'read' ? color : subtext;
  return (
    <View style={tS.wrap}>
      <Ionicons name="checkmark" size={14} color={c} />
      {(status === 'delivered' || status === 'read') && <Ionicons name="checkmark" size={14} style={tS.second} color={c} />}
    </View>
  );
}
const tS = StyleSheet.create({ wrap: { flexDirection: 'row', alignItems: 'center' }, second: { marginLeft: -11 } });

function TypingDots({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((dot, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 150),
      Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.delay(600 - i * 150),
    ])));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []); // eslint-disable-line
  return (
    <View style={dS.wrap}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[dS.dot, { backgroundColor: color, opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]} />
      ))}
    </View>
  );
}
const dS = StyleSheet.create({ wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 2 }, dot: { width: 7, height: 7, borderRadius: 4 } });

export default function ChatScreen() {
  const colors = useThemeColor();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const { socket, joinConversation, online, moods, setActiveConversation } = useRealtime();

  const conversationId = useMemo(() => {
    const id = params.conversationId;
    return Array.isArray(id) ? id[0] : id;
  }, [params.conversationId]);

  const [me, setMe] = useState<PublicUser | null>(null);
  const [conversation, setConversation] = useState<PublicConversation | null>(null);
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<PublicMessage | null>(null);
  const [reactionTarget, setReactionTarget] = useState<PublicMessage | null>(null);

  // Feature 3: Chat theme
  const [theme, setTheme] = useState<ChatTheme | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);

  // Feature 2: Disappearing messages
  const [disappearAfter, setDisappearAfter] = useState(0);
  const [showDisappear, setShowDisappear] = useState(false);

  // Settings panel
  const [showSettings, setShowSettings] = useState(false);

  const idsRef = useRef<Set<string>>(new Set());
  const textRef = useRef('');
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const meRef = useRef<PublicUser | null>(null);

  const items = useMemo(() => buildItems(messages), [messages]);

  const addMessage = useCallback((m: PublicMessage) => {
    if (!m?.id || idsRef.current.has(m.id)) return;
    idsRef.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  useEffect(() => {
    if (!conversationId) { setIsLoading(false); return; }
    setIsLoading(true);
    Promise.all([getProfile(), getConversation(conversationId), listMessages(conversationId, 80), getChatTheme(conversationId)])
      .then(([meData, convData, msgsData, savedTheme]) => {
        const meUser = { id: meData.id, name: meData.name, email: meData.email, description: meData.description, profileImage: meData.profileImage };
        setMe(meUser); meRef.current = meUser;
        const conv = convData.conversation ?? null;
        setConversation(conv);
        setDisappearAfter(conv?.disappearAfter ?? 0);
        const msgs: PublicMessage[] = msgsData.messages ?? [];
        idsRef.current = new Set(msgs.map((m) => m.id));
        setMessages(msgs);
        setTheme(savedTheme);
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    setActiveConversation(conversationId);
    markConversationRead(conversationId).catch(() => {});
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation]);

  useEffect(() => {
    if (!conversationId || !socket) return;
    joinConversation(conversationId);

    const onNew = (p: any) => {
      const m = p?.message as PublicMessage | undefined;
      if (!m?.id || String(m.conversationId) !== String(conversationId)) return;
      addMessage(m);
      markConversationRead(conversationId).catch(() => {});
    };
    const onTyping = (p: any) => {
      if (String(p?.conversationId) !== String(conversationId) || p?.userId === meRef.current?.id) return;
      setIsOtherTyping(Boolean(p?.typing));
    };
    const onStatus = (p: any) => {
      if (String(p?.conversationId) !== String(conversationId) || !p?.userId) return;
      if (p?.status !== 'delivered' && p?.status !== 'read') return;
      const myId = meRef.current?.id;
      setMessages((prev) => prev.map((msg) => {
        if (!myId || msg.sender?.id !== myId) return msg;
        const nd = msg.deliveredTo?.includes(p.userId) ? msg.deliveredTo : [...(msg.deliveredTo || []), p.userId];
        const nr = p.status === 'read' ? (msg.readBy?.includes(p.userId) ? msg.readBy : [...(msg.readBy || []), p.userId]) : msg.readBy;
        if (nd === msg.deliveredTo && nr === msg.readBy) return msg;
        return { ...msg, deliveredTo: nd, readBy: nr };
      }));
    };
    const onReaction = (p: any) => {
      if (String(p?.conversationId) !== String(conversationId)) return;
      setMessages((prev) => prev.map((msg) => msg.id === p.messageId ? { ...msg, reactions: p.reactions } : msg));
    };
    // Feature 2: disappear timer updated by other participant
    const onDisappear = (p: any) => {
      if (String(p?.conversationId) !== String(conversationId)) return;
      setDisappearAfter(p.disappearAfter ?? 0);
    };

    socket.on('message:new', onNew);
    socket.on('typing', onTyping);
    socket.on('message:status', onStatus);
    socket.on('message:reaction', onReaction);
    socket.on('conversation:disappear', onDisappear);
    return () => {
      socket.off('message:new', onNew);
      socket.off('typing', onTyping);
      socket.off('message:status', onStatus);
      socket.off('message:reaction', onReaction);
      socket.off('conversation:disappear', onDisappear);
    };
  }, [addMessage, conversationId, joinConversation, socket]);

  const other = useMemo(() =>
    conversation?.participants?.find((p) => p.id !== (me?.id ?? meRef.current?.id)) ?? conversation?.participants?.[0],
    [conversation?.participants, me?.id]);

  const isOtherOnline = other ? online.has(other.id) : false;
  // Feature 4: show mood from realtime context, fallback to user's stored mood
  const otherMood = other ? (moods[other.id] ?? other.mood ?? '') : '';

  const getStatus = useCallback((msg: PublicMessage): 'sent' | 'delivered' | 'read' | null => {
    const myId = meRef.current?.id ?? me?.id;
    if (msg.sender?.id !== myId || !other?.id) return null;
    if (msg.readBy?.includes(other.id)) return 'read';
    if (msg.deliveredTo?.includes(other.id)) return 'delivered';
    return 'sent';
  }, [me?.id, other?.id]);

  const emitTyping = useCallback((typing: boolean) => {
    socket?.emit(typing ? 'typing:start' : 'typing:stop', { conversationId });
  }, [conversationId, socket]);

  const handleTextChange = useCallback((v: string) => {
    textRef.current = v;
    setInputValue(v);
    const has = v.trim().length > 0;
    if (has && !isTypingRef.current) { isTypingRef.current = true; emitTyping(true); }
    if (!has && isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => { if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); } }, 900);
  }, [emitTyping]);

  const onSend = useCallback(async () => {
    const trimmed = textRef.current.trim();
    if (!conversationId || !trimmed || isSending) return;
    setIsSending(true);
    textRef.current = ''; setInputValue('');
    const replyId = replyTo?.id ?? null; setReplyTo(null);
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
    try {
      if (socket?.connected) {
        await new Promise<void>((res, rej) => {
          socket.emit('message:send', { conversationId, text: trimmed, replyTo: replyId }, (ack: any) => {
            if (!ack?.ok) { rej(new Error(ack?.error || 'Failed')); return; }
            if (ack?.message) addMessage(ack.message as PublicMessage);
            res();
          });
        });
      } else {
        const data = await sendMessage(conversationId, trimmed);
        if (data?.message) addMessage(data.message as PublicMessage);
      }
    } catch (e: any) { setError(e.message || 'Failed to send'); }
    finally { setIsSending(false); }
  }, [addMessage, conversationId, emitTyping, isSending, replyTo, socket]);

  const onReact = useCallback(async (emoji: string) => {
    if (!reactionTarget) return;
    const targetId = reactionTarget.id;
    setReactionTarget(null);
    try {
      const res = await reactToMessage(targetId, emoji);
      setMessages((prev) => prev.map((m) => m.id === targetId ? { ...m, reactions: res.reactions } : m));
    } catch {}
  }, [reactionTarget]);

  const onPickTheme = useCallback(async (t: ChatTheme) => {
    if (!conversationId) return;
    setTheme(t);
    setShowThemePicker(false);
    await setChatTheme(conversationId, t);
  }, [conversationId]);

  const onSetDisappear = useCallback(async (seconds: number) => {
    if (!conversationId) return;
    setShowDisappear(false);
    setDisappearAfter(seconds);
    await setDisappearTimer(conversationId, seconds).catch(() => {});
  }, [conversationId]);

  useEffect(() => () => {
    if (typingRef.current) clearTimeout(typingRef.current);
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
  }, [emitTyping]);

  const groupReactions = (reactions: Reaction[]) => {
    const map: Record<string, number> = {};
    reactions.forEach((r) => { map[r.emoji] = (map[r.emoji] || 0) + 1; });
    return Object.entries(map);
  };

  // Effective bubble colors — use theme if set, else fall back to app colors
  const myBubbleBg = theme?.myBubble ?? colors.primary;
  const theirBubbleBg = theme?.theirBubble ?? colors.surface;
  const myBubbleText = theme?.myText ?? colors.background;
  const theirBubbleText = theme?.theirText ?? colors.text;

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item._type === 'sep') {
      return <View style={styles.sepWrap}><Text style={[styles.sepText, { color: colors.subtext }]}>{item.label}</Text></View>;
    }
    const isMine = item.sender?.id === (me?.id ?? meRef.current?.id);
    const status = getStatus(item);
    const grouped = groupReactions(item.reactions || []);
    const myReaction = (item.reactions || []).find((r) => r.userId === (me?.id ?? meRef.current?.id));
    const isExpiring = item.expiresAt && new Date(item.expiresAt).getTime() - Date.now() < 60_000;

    return (
      <Pressable onLongPress={() => setReactionTarget(item)} delayLongPress={350}>
        <View style={[styles.bubbleWrap, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}>
          <View style={[styles.bubbleCol, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
            {item.replyTo && (
              <View style={[styles.replyQuote, { borderLeftColor: myBubbleBg, backgroundColor: colors.surface }]}>
                <Text style={[styles.replyName, { color: myBubbleBg }]} numberOfLines={1}>{item.replyTo.senderName}</Text>
                <Text style={[styles.replyText, { color: colors.subtext }]} numberOfLines={1}>{item.replyTo.text}</Text>
              </View>
            )}
            <View style={[styles.bubble, { backgroundColor: isMine ? myBubbleBg : theirBubbleBg, borderColor: colors.border, opacity: isExpiring ? 0.6 : 1 }]}>
              {isExpiring && <Ionicons name="timer-outline" size={11} color={isMine ? myBubbleText : theirBubbleText} style={{ marginBottom: 2 }} />}
              <Text style={[styles.bubbleText, { color: isMine ? myBubbleText : theirBubbleText }]}>{item.text}</Text>
            </View>
            {grouped.length > 0 && (
              <View style={styles.reactionsRow}>
                {grouped.map(([emoji, count]) => (
                  <TouchableOpacity key={emoji} style={[styles.reactionPill, { backgroundColor: myReaction?.emoji === emoji ? myBubbleBg + '33' : colors.surface, borderColor: myReaction?.emoji === emoji ? myBubbleBg : colors.border }]} onPress={() => onReact(emoji)} activeOpacity={0.8}>
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    {count > 1 && <Text style={[styles.reactionCount, { color: colors.subtext }]}>{count}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.meta}>
              {isMine && status && <Ticks status={status} color={myBubbleBg} subtext={colors.subtext} />}
              <Text style={[styles.timeText, { color: colors.subtext }]}>{item.createdAt ? formatTime(item.createdAt) : ''}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    );
  }, [colors, me?.id, getStatus, onReact, myBubbleBg, theirBubbleBg, myBubbleText, theirBubbleText]);

  if (isLoading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  const disappearLabel = DISAPPEAR_OPTIONS.find((o) => o.seconds === disappearAfter)?.label ?? 'Off';

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior="padding" keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 10 : 0}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        {other?.profileImage
          ? <View style={styles.avatarWrap}><Image source={{ uri: other.profileImage }} style={styles.avatar} /><View style={[styles.presenceDot, { backgroundColor: isOtherOnline ? colors.primary : colors.border }]} /></View>
          : <View style={styles.avatarWrap}><View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.avatarText, { color: colors.subtext }]}>{other?.name?.slice(0, 1)?.toUpperCase() || '?'}</Text></View><View style={[styles.presenceDot, { backgroundColor: isOtherOnline ? colors.primary : colors.border }]} /></View>
        }
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{other?.name || 'Chat'}</Text>
          <Text style={[styles.headerSub, { color: isOtherTyping ? colors.primary : isOtherOnline ? colors.primary : colors.subtext }]} numberOfLines={1}>
            {error || (isOtherTyping ? 'typing...' : otherMood || (isOtherOnline ? 'Online' : 'Offline'))}
          </Text>
        </View>
        {/* Settings button */}
        <TouchableOpacity style={styles.settingsBtn} onPress={() => setShowSettings(true)} activeOpacity={0.8}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.subtext} />
        </TouchableOpacity>
      </View>

      {/* Disappear banner */}
      {disappearAfter > 0 && (
        <View style={[styles.disappearBanner, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Ionicons name="timer-outline" size={14} color={colors.subtext} />
          <Text style={[styles.disappearBannerText, { color: colors.subtext }]}>Messages disappear after {disappearLabel}</Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        inverted
        ListHeaderComponent={isOtherTyping ? (
          <View style={[styles.bubbleWrap, { justifyContent: 'flex-start' }]}>
            <View style={[styles.bubbleCol, { alignItems: 'flex-start' }]}>
              <View style={[styles.bubble, { backgroundColor: theirBubbleBg, borderColor: colors.border }]}>
                <TypingDots color={colors.subtext} />
              </View>
            </View>
          </View>
        ) : null}
        renderItem={renderItem}
      />

      {replyTo && (
        <View style={[styles.replyBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <View style={[styles.replyBarAccent, { backgroundColor: myBubbleBg }]} />
          <View style={styles.replyBarText}>
            <Text style={[styles.replyBarName, { color: myBubbleBg }]} numberOfLines={1}>{replyTo.sender?.name}</Text>
            <Text style={[styles.replyBarMsg, { color: colors.subtext }]} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyBarClose}>
            <Ionicons name="close" size={18} color={colors.subtext} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.composerWrap, { borderTopColor: colors.border, paddingBottom: insets.bottom || 8 }]}>
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput value={inputValue} onChangeText={handleTextChange} placeholder="Message..." placeholderTextColor="#999" style={[styles.input, { color: colors.text }]} multiline numberOfLines={1} scrollEnabled />
          <TouchableOpacity activeOpacity={0.85} style={[styles.sendBtn, { backgroundColor: myBubbleBg, opacity: isSending ? 0.6 : 1 }]} onPress={onSend} disabled={isSending}>
            <Ionicons name="send" size={18} color={myBubbleText} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Reaction + Reply picker */}
      <Modal visible={!!reactionTarget} transparent animationType="fade" onRequestClose={() => setReactionTarget(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setReactionTarget(null)}>
          <View style={[styles.reactionPicker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.pickerHint, { color: colors.subtext }]}>React</Text>
            <View style={styles.reactionPickerRow}>
              {REACTION_EMOJIS.map((emoji) => (
                <TouchableOpacity key={emoji} style={styles.reactionPickerBtn} onPress={() => onReact(emoji)} activeOpacity={0.7}>
                  <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.replyOption, { borderTopColor: colors.border }]} onPress={() => { setReplyTo(reactionTarget); setReactionTarget(null); }} activeOpacity={0.8}>
              <Ionicons name="return-up-back-outline" size={18} color={myBubbleBg} />
              <Text style={[styles.replyOptionText, { color: myBubbleBg }]}>Reply</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Settings panel */}
      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettings(false)}>
          <View style={[styles.settingsSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Chat Settings</Text>

            {/* Theme picker */}
            <TouchableOpacity style={[styles.settingsRow, { borderBottomColor: colors.border }]} onPress={() => { setShowSettings(false); setShowThemePicker(true); }} activeOpacity={0.8}>
              <Ionicons name="color-palette-outline" size={20} color={colors.primary} />
              <View style={styles.settingsRowText}>
                <Text style={[styles.settingsRowLabel, { color: colors.text }]}>Chat Theme</Text>
                <Text style={[styles.settingsRowSub, { color: colors.subtext }]}>Customize bubble colors</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
            </TouchableOpacity>

            {/* Disappearing messages */}
            <TouchableOpacity style={[styles.settingsRow, { borderBottomColor: colors.border }]} onPress={() => { setShowSettings(false); setShowDisappear(true); }} activeOpacity={0.8}>
              <Ionicons name="timer-outline" size={20} color={colors.primary} />
              <View style={styles.settingsRowText}>
                <Text style={[styles.settingsRowLabel, { color: colors.text }]}>Disappearing Messages</Text>
                <Text style={[styles.settingsRowSub, { color: colors.subtext }]}>Currently: {disappearLabel}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Theme picker modal */}
      <Modal visible={showThemePicker} transparent animationType="slide" onRequestClose={() => setShowThemePicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowThemePicker(false)}>
          <View style={[styles.settingsSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Chat Theme</Text>
            <ScrollView contentContainerStyle={styles.themeGrid}>
              {Object.entries(PRESET_THEMES).map(([key, t]) => (
                <TouchableOpacity key={key} style={styles.themeItem} onPress={() => onPickTheme(t)} activeOpacity={0.8}>
                  <View style={styles.themePreview}>
                    <View style={[styles.themeBubbleMine, { backgroundColor: t.myBubble }]} />
                    <View style={[styles.themeBubbleTheir, { backgroundColor: t.theirBubble }]} />
                  </View>
                  <Text style={[styles.themeLabel, { color: colors.text }]}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                  {theme?.myBubble === t.myBubble && <Ionicons name="checkmark-circle" size={16} color={colors.primary} style={{ position: 'absolute', top: 4, right: 4 }} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Disappear timer modal */}
      <Modal visible={showDisappear} transparent animationType="slide" onRequestClose={() => setShowDisappear(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDisappear(false)}>
          <View style={[styles.settingsSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Disappearing Messages</Text>
            {DISAPPEAR_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.seconds} style={[styles.disappearOption, { borderBottomColor: colors.border }]} onPress={() => onSetDisappear(opt.seconds)} activeOpacity={0.8}>
                <Text style={[styles.disappearOptionText, { color: disappearAfter === opt.seconds ? colors.primary : colors.text }]}>{opt.label}</Text>
                {disappearAfter === opt.seconds && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarWrap: { position: 'relative', width: 38, height: 38 },
  avatarFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'KshanaFont', fontSize: 14 },
  presenceDot: { position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: 'transparent' },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { fontFamily: 'KshanaFont', fontSize: 17 },
  headerSub: { fontFamily: 'KshanaFont', fontSize: 12 },
  settingsBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  disappearBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1 },
  disappearBannerText: { fontFamily: 'KshanaFont', fontSize: 12 },
  messages: { padding: 14, gap: 6, paddingBottom: 8 },
  sepWrap: { alignItems: 'center', marginVertical: 10 },
  sepText: { fontFamily: 'KshanaFont', fontSize: 11 },
  bubbleWrap: { flexDirection: 'row', width: '100%' },
  bubbleCol: { maxWidth: '82%', gap: 2, flexShrink: 1 },
  bubble: { maxWidth: '100%', minWidth: 48, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  bubbleText: { fontFamily: 'KshanaFont', fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  timeText: { fontFamily: 'KshanaFont', fontSize: 10 },
  replyQuote: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 4, marginBottom: 4, borderRadius: 6, paddingRight: 8 },
  replyName: { fontFamily: 'KshanaFont', fontSize: 11, fontWeight: '700' },
  replyText: { fontFamily: 'KshanaFont', fontSize: 11 },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, paddingHorizontal: 2 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontFamily: 'KshanaFont', fontSize: 11 },
  replyBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, gap: 8 },
  replyBarAccent: { width: 3, height: 36, borderRadius: 2 },
  replyBarText: { flex: 1 },
  replyBarName: { fontFamily: 'KshanaFont', fontSize: 12, fontWeight: '700' },
  replyBarMsg: { fontFamily: 'KshanaFont', fontSize: 12 },
  replyBarClose: { padding: 4 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  composer: { borderWidth: 1, borderRadius: 24, paddingLeft: 14, paddingRight: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8, elevation: 2 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: 15, fontFamily: 'KshanaFont', paddingVertical: 8, textAlignVertical: 'center' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  reactionPicker: { borderRadius: 20, borderWidth: 1, padding: 16, width: 300, alignItems: 'center' },
  pickerHint: { fontFamily: 'KshanaFont', fontSize: 12, marginBottom: 10 },
  reactionPickerRow: { flexDirection: 'row', gap: 8 },
  reactionPickerBtn: { padding: 8 },
  reactionPickerEmoji: { fontSize: 28 },
  replyOption: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, width: '100%', justifyContent: 'center' },
  replyOptionText: { fontFamily: 'KshanaFont', fontSize: 14 },
  settingsSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingBottom: 32 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  sheetTitle: { fontFamily: 'KshanaFont', fontSize: 16, paddingHorizontal: 20, paddingVertical: 12 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  settingsRowText: { flex: 1 },
  settingsRowLabel: { fontFamily: 'KshanaFont', fontSize: 15 },
  settingsRowSub: { fontFamily: 'KshanaFont', fontSize: 12, marginTop: 2 },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
  themeItem: { width: 90, alignItems: 'center', gap: 6 },
  themePreview: { width: 80, height: 60, borderRadius: 12, overflow: 'hidden', flexDirection: 'column', gap: 4, padding: 8, backgroundColor: '#111' },
  themeBubbleMine: { height: 18, borderRadius: 9, alignSelf: 'flex-end', width: '70%' },
  themeBubbleTheir: { height: 18, borderRadius: 9, alignSelf: 'flex-start', width: '70%' },
  themeLabel: { fontFamily: 'KshanaFont', fontSize: 12 },
  disappearOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  disappearOptionText: { fontFamily: 'KshanaFont', fontSize: 15 },
});
