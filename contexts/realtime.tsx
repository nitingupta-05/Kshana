import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import {
    fetchOnline, getToken, getUnreadConversationCounts,
    getUnreadNotificationCount, listConversations,
} from '@/config/api';
import { createChatSocket } from '@/config/socket';
import type { PublicConversation } from '@/types/chat';
import { cacheGet, cacheSet } from '@/utils/cache';

const CACHE_CONVOS = 'conversations';
const READ_CONVOS_KEY = 'kshana_read_convos'; // persisted set of conversation IDs user has read

type RealtimeContextValue = {
  socket: Socket | null;
  online: Set<string>;
  unreadCount: number;
  unreadByConversation: Record<string, number>;
  conversations: PublicConversation[];
  refreshConversations: () => Promise<void>;
  joinConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null, online: new Set(), unreadCount: 0,
  unreadByConversation: {}, conversations: [],
  refreshConversations: async () => {},
  joinConversation: () => {}, setActiveConversation: () => {},
});

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});
  const [conversations, setConversations] = useState<PublicConversation[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const activeConvRef = useRef<string | null>(null);
  const readConvsRef = useRef<Set<string>>(new Set()); // persisted across refreshes

  // Load persisted read conversations on mount
  useEffect(() => {
    AsyncStorage.getItem(READ_CONVOS_KEY).then((raw) => {
      if (raw) {
        try { readConvsRef.current = new Set(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  // Load conversations from cache for instant render
  useEffect(() => {
    cacheGet<PublicConversation[]>(CACHE_CONVOS, 5 * 60_000).then((c) => {
      if (c?.length) setConversations(c);
    });
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await listConversations();
      const convos = (data.conversations ?? []).filter((c: PublicConversation) => c.lastMessage !== null);
      setConversations(convos);
      cacheSet(CACHE_CONVOS, convos);
    } catch {}
  }, []);

  // Clear badge when entering a conversation + persist as read
  const setActiveConversation = useCallback((id: string | null) => {
    activeConvRef.current = id;
    if (id) {
      // mark as read persistently
      readConvsRef.current.add(id);
      AsyncStorage.setItem(READ_CONVOS_KEY, JSON.stringify([...readConvsRef.current])).catch(() => {});
      setUnreadByConversation((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (cancelled) return;
      const token = await getToken();
      if (!token) { setTimeout(setup, 1500); return; }

      try {
        const [onlineRes, unreadRes, unreadConvoRes, convRes, s] = await Promise.all([
          fetchOnline(),
          getUnreadNotificationCount(),
          getUnreadConversationCounts(),
          listConversations(),
          createChatSocket(),
        ]);
        if (cancelled) { s.disconnect(); return; }

        socketRef.current = s;
        const convos = (convRes.conversations ?? []).filter((c: PublicConversation) => c.lastMessage !== null);

        setOnline(new Set(onlineRes.online ?? []));
        setUnreadCount(typeof unreadRes.count === 'number' ? unreadRes.count : 0);
        // Filter out conversations the user has already read (persisted across refreshes)
        const rawCounts: Record<string, number> = unreadConvoRes.counts || {};
        const filteredCounts: Record<string, number> = {};
        for (const [id, count] of Object.entries(rawCounts)) {
          if (!readConvsRef.current.has(id)) filteredCounts[id] = count;
        }
        setUnreadByConversation(filteredCounts);
        setConversations(convos);
        setSocket(s);
        cacheSet(CACHE_CONVOS, convos);

        s.on('user:online', (p: any) => {
          if (!p?.userId) return;
          setOnline((prev) => { const n = new Set(prev); n.add(p.userId); return n; });
        });
        s.on('user:offline', (p: any) => {
          if (!p?.userId) return;
          setOnline((prev) => { const n = new Set(prev); n.delete(p.userId); return n; });
        });
        s.on('disconnect', () => setOnline(new Set()));
        s.on('connect_error', () => setOnline(new Set()));

        // Update conversation last message + bubble to top
        s.on('message:new', (payload: any) => {
          const msg = payload?.message;
          if (!msg?.conversationId) return;
          const convoId = String(msg.conversationId);
          setConversations((prev) => {
            const idx = prev.findIndex((c) => String(c.id) === convoId);
            if (idx === -1) {
              listConversations().then((data) => {
                const fresh = (data.conversations ?? []).filter((c: PublicConversation) => c.lastMessage !== null);
                setConversations(fresh);
                cacheSet(CACHE_CONVOS, fresh);
              }).catch(() => {});
              return prev;
            }
            const next = [{ ...prev[idx], lastMessage: msg, updatedAt: msg.createdAt }, ...prev.filter((_, i) => i !== idx)];
            cacheSet(CACHE_CONVOS, next);
            return next;
          });
        });

        // Increment unread badge + update preview text (only for recipient)
        s.on('notify:new', (payload: any) => {
          const type = payload?.notification?.type;
          const data = payload?.notification?.data;

          if (type === 'message' && data?.conversationId) {
            const convoId = String(data.conversationId);
            // new message arrived — remove from read set so badge can show again
            if (readConvsRef.current.has(convoId)) {
              readConvsRef.current.delete(convoId);
              AsyncStorage.setItem(READ_CONVOS_KEY, JSON.stringify([...readConvsRef.current])).catch(() => {});
            }
            // skip badge if user is currently in this conversation
            if (activeConvRef.current !== convoId) {
              setUnreadByConversation((prev) => ({ ...prev, [convoId]: (prev[convoId] || 0) + 1 }));
            }
            // always update last message preview
            setConversations((prev) => {
              const idx = prev.findIndex((c) => String(c.id) === convoId);
              if (idx === -1) return prev;
              const existing = prev[idx];
              const next = [{
                ...existing,
                lastMessage: {
                  ...(existing.lastMessage ?? {}),
                  text: data.text ?? existing.lastMessage?.text ?? '',
                  sender: data.from ?? existing.lastMessage?.sender,
                  createdAt: new Date().toISOString(),
                } as any,
                updatedAt: new Date().toISOString(),
              }, ...prev.filter((_, i) => i !== idx)];
              cacheSet(CACHE_CONVOS, next);
              return next;
            });
          } else if (type && type !== 'message') {
            const n = typeof payload?.unreadCount === 'number' ? payload.unreadCount : -1;
            setUnreadCount((c) => n >= 0 ? n : c + 1);
          }
        });

      } catch {
        setOnline(new Set());
        setTimeout(setup, 2000);
      }
    };

    setup();
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinConversation = useCallback((id: string) => {
    if (!id || !socketRef.current) return;
    socketRef.current.emit('conversation:join', { conversationId: id });
  }, []);

  const value = useMemo(() => ({
    socket, online, unreadCount, unreadByConversation, conversations,
    refreshConversations, joinConversation, setActiveConversation,
  }), [socket, online, unreadCount, unreadByConversation, conversations,
    refreshConversations, joinConversation, setActiveConversation]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export const useRealtime = () => useContext(RealtimeContext);
