import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Animated, FlatList, Image, KeyboardAvoidingView,
    Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getConversation, getProfile, listMessages, markConversationRead, sendMessage } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicConversation, PublicMessage, PublicUser } from '@/types/chat';

// ─── helpers ─────────────────────────────────────────────────────────────────

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
};

type Sep = { _type: 'sep'; id: string; label: string };
type Msg = PublicMessage & { _type: 'msg' };
type Item = Sep | Msg;

// Build items in reverse order for inverted FlatList
const buildItems = (msgs: PublicMessage[]): Item[] => {
  const out: Item[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const day = m.createdAt ? new Date(m.createdAt).toDateString() : '';
    if (day && day !== lastDay) {
      lastDay = day;
      out.push({ _type: 'sep', id: `s_${day}`, label: dayLabel(m.createdAt) });
    }
    out.push({ ...m, _type: 'msg' });
  }
  return out.reverse(); // inverted FlatList needs newest first
};

// ─── Typing dots component ────────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 150),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []); // eslint-disable-line

  return (
    <View style={typingStyles.wrap}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[typingStyles.dot, { backgroundColor: color, opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
        />
      ))}
    </View>
  );
}

const typingStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

// ─── component ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const colors = useThemeColor();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const { socket, joinConversation, online, setActiveConversation } = useRealtime();

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
  const textRef = useRef('');
  const inputRef = useRef<TextInput>(null);

  const idsRef = useRef<Set<string>>(new Set());
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // inverted FlatList — newest first, no scroll management needed
  const items = useMemo(() => buildItems(messages), [messages]);

  const addMessage = useCallback((m: PublicMessage) => {
    if (!m?.id || idsRef.current.has(m.id)) return;
    idsRef.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  // Load data
  useEffect(() => {
    if (!conversationId) { setIsLoading(false); return; }
    setIsLoading(true);
    Promise.all([getProfile(), getConversation(conversationId), listMessages(conversationId, 80)])
      .then(([meData, convData, msgsData]) => {
        setMe({ id: meData.id, name: meData.name, email: meData.email, description: meData.description, profileImage: meData.profileImage });
        setConversation(convData.conversation ?? null);
        const msgs: PublicMessage[] = msgsData.messages ?? [];
        idsRef.current = new Set(msgs.map((m) => m.id));
        setMessages(msgs);
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [conversationId]);

  // Mark active + read
  useEffect(() => {
    if (!conversationId) return;
    setActiveConversation(conversationId);
    markConversationRead(conversationId).catch(() => {});
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation]);

  // Socket
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
      if (String(p?.conversationId) !== String(conversationId) || p?.userId === me?.id) return;
      setIsOtherTyping(Boolean(p?.typing));
    };
    const onStatus = (p: any) => {
      if (String(p?.conversationId) !== String(conversationId) || !p?.userId) return;
      if (p?.status !== 'delivered' && p?.status !== 'read') return;
      setMessages((prev) => prev.map((msg) => {
        if (msg.sender?.id !== me?.id) return msg;
        const nd = msg.deliveredTo?.includes(p.userId) ? msg.deliveredTo : [...(msg.deliveredTo || []), p.userId];
        const nr = p.status === 'read' ? (msg.readBy?.includes(p.userId) ? msg.readBy : [...(msg.readBy || []), p.userId]) : msg.readBy;
        if (nd === msg.deliveredTo && nr === msg.readBy) return msg;
        return { ...msg, deliveredTo: nd, readBy: nr };
      }));
    };

    socket.on('message:new', onNew);
    socket.on('typing', onTyping);
    socket.on('message:status', onStatus);
    return () => {
      socket.off('message:new', onNew);
      socket.off('typing', onTyping);
      socket.off('message:status', onStatus);
    };
  }, [addMessage, conversationId, joinConversation, me?.id, socket]);

  const other = useMemo(() =>
    conversation?.participants?.find((p) => p.id !== me?.id) ?? conversation?.participants?.[0],
    [conversation?.participants, me?.id]);

  const isOtherOnline = other ? online.has(other.id) : false;

  const emitTyping = useCallback((typing: boolean) => {
    socket?.emit(typing ? 'typing:start' : 'typing:stop', { conversationId });
  }, [conversationId, socket]);

  const handleTextChange = useCallback((v: string) => {
    textRef.current = v;
    const has = v.trim().length > 0;
    if (has && !isTypingRef.current) { isTypingRef.current = true; emitTyping(true); }
    if (!has && isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
    if (typingRef.current) clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => {
      if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
    }, 900);
  }, [emitTyping]);

  const getStatus = useCallback((msg: PublicMessage) => {
    if (msg.sender?.id !== me?.id || !other?.id) return null;
    if (msg.readBy?.includes(other.id)) return 'read';
    if (isOtherOnline) return 'delivered';
    return 'sent';
  }, [me?.id, other?.id, isOtherOnline]);

  const onSend = useCallback(async () => {
    // Capture text before any clearing — IME may still be composing
    const trimmed = textRef.current.trim();
    if (!conversationId || !trimmed || isSending) return;
    setIsSending(true);
    textRef.current = '';
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
    // Defer clear to next frame so IME finishes composing before we wipe the input
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ text: '' });
    });
    try {
      if (socket?.connected) {
        await new Promise<void>((res, rej) => {
          socket.emit('message:send', { conversationId, text: trimmed }, (ack: any) => {
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
  }, [addMessage, conversationId, emitTyping, isSending, socket]);

  useEffect(() => () => {
    if (typingRef.current) clearTimeout(typingRef.current);
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(false); }
  }, [emitTyping]);

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item._type === 'sep') {
      return <View style={styles.sepWrap}><Text style={[styles.sepText, { color: colors.subtext }]}>{item.label}</Text></View>;
    }
    const isMine = item.sender?.id === me?.id;
    const status = getStatus(item);
    return (
      <View style={[styles.bubbleWrap, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}>
        <View style={[styles.bubbleCol, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
          <View style={[styles.bubble, { backgroundColor: isMine ? colors.primary : colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.bubbleText, { color: isMine ? colors.background : colors.text }]}>{item.text}</Text>
          </View>
          <View style={styles.meta}>
            {isMine && status && (
              <View style={styles.ticks}>
                <Ionicons name="checkmark" size={14} color={status === 'read' ? colors.primary : colors.subtext} />
                {(status === 'delivered' || status === 'read') && (
                  <Ionicons name="checkmark" size={14} style={styles.tick2} color={status === 'read' ? colors.primary : colors.subtext} />
                )}
              </View>
            )}
            <Text style={[styles.timeText, { color: colors.subtext }]}>{item.createdAt ? formatTime(item.createdAt) : ''}</Text>
          </View>
        </View>
      </View>
    );
  }, [colors, me?.id, getStatus]);

  if (isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 10 : 0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        {other?.profileImage
          ? <Image source={{ uri: other.profileImage }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.avatarText, { color: colors.subtext }]}>{other?.name?.slice(0, 1)?.toUpperCase() || '?'}</Text>
            </View>
        }
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{other?.name || 'Chat'}</Text>
          <Text style={[styles.headerSub, { color: isOtherTyping ? colors.primary : isOtherOnline ? colors.primary : colors.subtext }]} numberOfLines={1}>
            {error || (isOtherTyping ? 'typing...' : isOtherOnline ? 'Online' : 'Offline')}
          </Text>
        </View>
      </View>

      {/* Messages — inverted so newest is always at bottom, no scroll management needed */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        inverted
        // Typing indicator shown as first item (bottom) when other is typing
        ListHeaderComponent={isOtherTyping ? (
          <View style={[styles.bubbleWrap, { justifyContent: 'flex-start' }]}>
            <View style={[styles.bubbleCol, { alignItems: 'flex-start' }]}>
              <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TypingDots color={colors.subtext} />
              </View>
            </View>
          </View>
        ) : null}
        renderItem={renderItem}
      />

      {/* Composer */}
      <View style={[styles.composerWrap, { borderTopColor: colors.border, paddingBottom: insets.bottom || 8 }]}>
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            defaultValue=""
            onChangeText={handleTextChange}
            placeholder="Message..." placeholderTextColor="#999"
            style={[styles.input, { color: colors.text }]}
            multiline numberOfLines={1} scrollEnabled
          />
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: isSending ? 0.6 : 1 }]}
            onPress={onSend} disabled={isSending}
          >
            <Ionicons name="send" size={18} color={colors.background} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'KshanaFont', fontSize: 14 },
  headerText: { flex: 1, gap: 2 },
  headerTitle: { fontFamily: 'KshanaFont', fontSize: 17 },
  headerSub: { fontFamily: 'KshanaFont', fontSize: 12 },
  messages: { padding: 14, gap: 6, paddingBottom: 8 },
  sepWrap: { alignItems: 'center', marginVertical: 10 },
  sepText: { fontFamily: 'KshanaFont', fontSize: 11 },
  bubbleWrap: { flexDirection: 'row', width: '100%' },
  bubbleCol: { maxWidth: '82%', gap: 2, flexShrink: 1 },
  bubble: { maxWidth: '100%', minWidth: 48, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  bubbleText: { fontFamily: 'KshanaFont', fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  ticks: { flexDirection: 'row', alignItems: 'center' },
  tick2: { marginLeft: -11 },
  timeText: { fontFamily: 'KshanaFont', fontSize: 10 },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },
  composer: { borderWidth: 1, borderRadius: 24, paddingLeft: 14, paddingRight: 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8, elevation: 2 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: 15, fontFamily: 'KshanaFont', paddingVertical: 8, textAlignVertical: 'center' },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
});
