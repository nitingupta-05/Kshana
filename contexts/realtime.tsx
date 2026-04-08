import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

import {
    fetchOnline,
    getActiveStoryAuthors,
    getToken, getUnreadConversationCounts,
    getUnreadNotificationCount, listConversations,
} from '@/config/api';
import { createChatSocket, destroyChatSocket } from '@/config/socket';
import type { PublicConversation } from '@/types/chat';
import { cacheGet, cacheSet } from '@/utils/cache';

const CACHE_CONVOS = 'conversations';
const READ_KEY = 'kshana_read_v2';
const MOODS_KEY = 'kshana_moods_v1';

type RealtimeContextValue = {
  socket: Socket | null;
  online: Set<string>;
  moods: Record<string, string>;
  unreadCount: number;
  unreadByConversation: Record<string, number>;
  unreadPreviewByConversation: Record<string, string>;
  conversations: PublicConversation[];
  storyAuthors: Set<string>;
  viewedStoryAuthors: Set<string>;
  markStoryAuthorViewed: (userId: string) => void;
  refreshConversations: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  joinConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null, online: new Set(), moods: {}, unreadCount: 0,
  unreadByConversation: {}, unreadPreviewByConversation: {},
  conversations: [], storyAuthors: new Set(),
  viewedStoryAuthors: new Set(),
  markStoryAuthorViewed: () => {},
  refreshConversations: async () => {},
  refreshUnreadCount: async () => {},
  joinConversation: () => {}, setActiveConversation: () => {},
});

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});
  const [unreadPreviewByConversation, setUnreadPreviewByConversation] = useState<Record<string, string>>({});
  const [conversations, setConversations] = useState<PublicConversation[]>([]);
  const [storyAuthors, setStoryAuthors] = useState<Set<string>>(new Set());
  const [viewedStoryAuthors, setViewedStoryAuthors] = useState<Set<string>>(new Set());
  const [moods, setMoods] = useState<Record<string, string>>({});
  const VIEWED_STORIES_KEY = 'kshana_viewed_stories_v1';

  const socketRef = useRef<Socket | null>(null);
  const activeConvRef = useRef<string | null>(null);
  const readSetRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupLockRef = useRef(false);
  const cancelledRef = useRef(false);

  // Load persisted read set + cached conversations + viewed story authors + cached moods
  useEffect(() => {
    AsyncStorage.getItem(READ_KEY).then((raw) => {
      if (raw) { try { readSetRef.current = new Set(JSON.parse(raw)); } catch {} }
      readyRef.current = true;
    });
    AsyncStorage.getItem('kshana_viewed_stories_v1').then((raw) => {
      if (raw) { try { setViewedStoryAuthors(new Set(JSON.parse(raw))); } catch {} }
    });
    AsyncStorage.getItem(MOODS_KEY).then((raw) => {
      if (raw) { try { setMoods(JSON.parse(raw)); } catch {} }
    });
    cacheGet<PublicConversation[]>(CACHE_CONVOS, 5 * 60_000).then((c) => {
      if (c?.length) setConversations(c);
    });
  }, []);

  const persistMoods = useCallback((next: Record<string, string>) => {
    AsyncStorage.setItem(MOODS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const mergeMoodsFromConversations = useCallback((convos: PublicConversation[]) => {
    setMoods((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const convo of convos) {
        for (const p of convo.participants || []) {
          if (!p?.id || typeof p.mood === 'undefined') continue;
          if (next[p.id] !== p.mood) {
            next[p.id] = p.mood ?? '';
            changed = true;
          }
        }
      }
      if (!changed) return prev;
      persistMoods(next);
      return next;
    });
  }, [persistMoods]);

  useEffect(() => {
    if (conversations.length) mergeMoodsFromConversations(conversations);
  }, [conversations, mergeMoodsFromConversations]);

  const persistReadSet = useCallback(() => {
    AsyncStorage.setItem(READ_KEY, JSON.stringify([...readSetRef.current])).catch(() => {});
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await getUnreadNotificationCount();
      setUnreadCount(typeof res.count === 'number' ? res.count : 0);
    } catch {}
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await listConversations();
      const convos = data.conversations ?? [];
      setConversations(convos);
      mergeMoodsFromConversations(convos);
      cacheSet(CACHE_CONVOS, convos);
    } catch {}
  }, [mergeMoodsFromConversations]);

  // Update a single conversation in state — bubbles it to top and updates preview
  const upsertConversation = useCallback((convoId: string, patch: Partial<PublicConversation> & { lastMessage?: any }) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => String(c.id) === convoId);
      if (idx === -1) {
        // Unknown conversation — do a full refresh
        listConversations().then((data) => {
          const fresh = data.conversations ?? [];
          setConversations(fresh);
          cacheSet(CACHE_CONVOS, fresh);
        }).catch(() => {});
        return prev;
      }
      const updated = { ...prev[idx], ...patch };
      const next = [updated, ...prev.filter((_, i) => i !== idx)];
      cacheSet(CACHE_CONVOS, next);
      return next;
    });
  }, []);

  const markStoryAuthorViewed = useCallback((userId: string) => {
    setViewedStoryAuthors((prev) => {
      if (prev.has(userId)) return prev;
      const next = new Set(prev);
      next.add(userId);
      AsyncStorage.setItem('kshana_viewed_stories_v1', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const setActiveConversation = useCallback((id: string | null) => {
    activeConvRef.current = id;
    if (id) {
      readSetRef.current.add(id);
      persistReadSet();
      setUnreadByConversation((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setUnreadPreviewByConversation((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [persistReadSet]);

  const attachSocketListeners = useCallback((s: Socket) => {
    // Presence
    s.on('user:online', (p: any) => {
      if (!p?.userId) return;
      setOnline((prev) => { const n = new Set(prev); n.add(p.userId); return n; });
    });
    s.on('user:offline', (p: any) => {
      if (!p?.userId) return;
      setOnline((prev) => { const n = new Set(prev); n.delete(p.userId); return n; });
    });

    // Socket lifecycle with reconnection
    s.on('disconnect', (reason) => {
      setOnline(new Set());
      setSocket(null);
      // Auto-reconnect on server disconnect
      if (reason === 'io server disconnect' || reason === 'transport close') {
        setTimeout(() => {
          if (!s.connected) s.connect();
        }, 1000);
      }
    });

    s.on('connect', () => {
      if (activeConvRef.current) {
        s.emit('conversation:join', { conversationId: activeConvRef.current });
      }
      fetchOnline().then((r) => {
        setOnline(new Set(r.online ?? []));
      }).catch(() => {});
      setSocket(s);
    });

    // If already connected when listeners are attached, fire immediately
    if (s.connected) {
      if (activeConvRef.current) {
        s.emit('conversation:join', { conversationId: activeConvRef.current });
      }
      fetchOnline().then((r) => setOnline(new Set(r.online ?? []))).catch(() => {});
      setSocket(s);
    }

    s.on('connect_error', (error) => {
      setOnline(new Set());
      // Attempt reconnection on error
      if (!s.connected) {
        setTimeout(() => s.connect(), 2000);
      }
    });

    // Broadcast notification
    s.on('notify:broadcast', () => {
      setUnreadCount((c) => c + 1);
    });

    // Mood update
    s.on('user:mood', (p: any) => {
      if (!p?.userId) return;
      setMoods((prev) => {
        const next = { ...prev, [p.userId]: p.mood ?? '' };
        persistMoods(next);
        return next;
      });
    });

    // New story — add author to storyAuthors, clear from viewed (it's a fresh story)
    s.on('story:new', (payload: any) => {
      const authorId = payload?.story?.author?.id;
      if (authorId) {
        setStoryAuthors((prev) => { const n = new Set(prev); n.add(authorId); return n; });
        setViewedStoryAuthors((prev) => {
          if (!prev.has(authorId)) return prev;
          const n = new Set(prev);
          n.delete(authorId);
          AsyncStorage.setItem('kshana_viewed_stories_v1', JSON.stringify([...n])).catch(() => {});
          return n;
        });
      }
    });

    // New message received — update preview + bubble conversation to top
    s.on('message:new', (payload: any) => {
      const msg = payload?.message;
      if (!msg?.conversationId) return;
      const convoId = String(msg.conversationId);
      upsertConversation(convoId, {
        lastMessage: msg,
        updatedAt: msg.createdAt,
      });
    });

    // notify:new - for messages this means an incoming message for the recipient
    s.on('notify:new', (payload: any) => {
      const type = payload?.notification?.type;
      const data = payload?.notification?.data;

      if (type === 'message' && data?.conversationId) {
        const convoId = String(data.conversationId);

        // Keep people/chat cards fresh even when conversation room events are not joined.
        {
          const sender = data?.from
            ? data.from
            : { id: 'system', name: 'Unknown', email: '', description: '', profileImage: '' };
          upsertConversation(convoId, {
            lastMessage: {
              id: payload?.notification?.id || `n_${Date.now()}`,
              kind: 'text',
              text: String(data?.text || ''),
              createdAt: payload?.notification?.createdAt || new Date().toISOString(),
              sender,
            },
            updatedAt: payload?.notification?.createdAt || new Date().toISOString(),
          });
        }

        // Increment badge only if not currently viewing this conversation
        if (activeConvRef.current !== convoId) {
          readSetRef.current.delete(convoId);
          persistReadSet();
          setUnreadByConversation((prev) => ({ ...prev, [convoId]: (prev[convoId] || 0) + 1 }));
          setUnreadPreviewByConversation((prev) => ({ ...prev, [convoId]: String(data?.text || '') }));
        } else {
          // User is already inside chat, so keep it seen even across refreshes.
          readSetRef.current.add(convoId);
          persistReadSet();
          setUnreadPreviewByConversation((prev) => {
            if (!prev[convoId]) return prev;
            const next = { ...prev };
            delete next[convoId];
            return next;
          });
        }
      } else if (type && type !== 'message') {
        // Bell badge — use server-provided count if available
        const n = typeof payload?.unreadCount === 'number' ? payload.unreadCount : -1;
        setUnreadCount((c) => n >= 0 ? n : c + 1);
      }
    });
  }, [persistReadSet, upsertConversation]);

  useEffect(() => {
    cancelledRef.current = false;

    const setup = async () => {
      if (cancelledRef.current || setupLockRef.current) return;
      if (!readyRef.current) { setTimeout(setup, 30); return; }

      const token = await getToken();
      if (!token) { setTimeout(setup, 1500); return; }

      setupLockRef.current = true;
      try {
        const [unreadRes, unreadConvoRes, convRes, s] = await Promise.all([
          getUnreadNotificationCount(),
          getUnreadConversationCounts(),
          listConversations(),
          createChatSocket(),
        ]);

        if (cancelledRef.current) { s.disconnect(); return; }

        socketRef.current = s;
        attachSocketListeners(s);

        // Wait for socket to connect, then fetch online list so our own ID is included
        const getOnlineAfterConnect = () => new Promise<string[]>((resolve) => {
          if (s.connected) {
            fetchOnline().then((r) => resolve(r.online ?? [])).catch(() => resolve([]));
          } else {
            s.once('connect', () => {
              fetchOnline().then((r) => resolve(r.online ?? [])).catch(() => resolve([]));
            });
            // Fallback if connect never fires within 3s
            setTimeout(() => resolve([]), 3000);
          }
        });

        const onlineIds = await getOnlineAfterConnect();

        const convos = convRes.conversations ?? [];
        const rawCounts: Record<string, number> = unreadConvoRes.counts || {};
        const filteredCounts: Record<string, number> = {};
        for (const [id, count] of Object.entries(rawCounts)) {
          if (!readSetRef.current.has(id)) filteredCounts[id] = count;
        }

        setOnline(new Set(onlineIds));
        setUnreadCount(typeof unreadRes.count === 'number' ? unreadRes.count : 0);
        setUnreadByConversation(filteredCounts);
        setConversations(convos);
        mergeMoodsFromConversations(convos);
        setSocket(s);
        cacheSet(CACHE_CONVOS, convos);

        // Load active story authors
        getActiveStoryAuthors().then((r) => {
          setStoryAuthors(new Set(r.authorIds ?? []));
        }).catch(() => {});

        // Poll every 4s as a safety net for missed socket events
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          if (cancelledRef.current) return;
          try {
            const data = await listConversations();
            const fresh = data.conversations ?? [];
            setConversations(fresh);
            mergeMoodsFromConversations(fresh);
            cacheSet(CACHE_CONVOS, fresh);
          } catch {}
        }, 4000);

        // Heartbeat to keep socket alive every 25s
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (s.connected) {
            s.emit('ping', {}, () => {});
          }
        }, 25000);

      } catch {
        setOnline(new Set());
        setupLockRef.current = false;
        setTimeout(setup, 2000);
        return;
      }
      setupLockRef.current = false;
    };

    setup();

    return () => {
      cancelledRef.current = true;
      setupLockRef.current = false;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      destroyChatSocket();
      socketRef.current = null;
      setSocket(null);
    };
  }, [attachSocketListeners]);

  const joinConversation = useCallback((id: string) => {
    if (!id || !socketRef.current) return;
    socketRef.current.emit('conversation:join', { conversationId: id });
  }, []);

  const value = useMemo(() => ({
    socket, online, moods, unreadCount, unreadByConversation, unreadPreviewByConversation,
    conversations, storyAuthors,
    viewedStoryAuthors, markStoryAuthorViewed,
    refreshConversations, refreshUnreadCount, joinConversation, setActiveConversation,
  }), [socket, online, moods, unreadCount, unreadByConversation, unreadPreviewByConversation,
    conversations, storyAuthors,
    viewedStoryAuthors, markStoryAuthorViewed,
    refreshConversations, refreshUnreadCount, joinConversation, setActiveConversation]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export const useRealtime = () => useContext(RealtimeContext);
