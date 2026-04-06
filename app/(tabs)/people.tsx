import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, FlatList, Image, StyleSheet,
    Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import { FabMenu } from '@/components/FabMenu';
import { createConversation, listSentRequests, listUsers, sendRequest } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { PublicUser } from '@/types/chat';

export default function PeopleScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const { online, unreadCount } = useRealtime();

  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [requestMap, setRequestMap] = useState<Record<string, string>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q?: string) => {
    setError('');
    try {
      const [usersData, sentMap] = await Promise.all([listUsers(q), listSentRequests()]);
      setUsers(usersData.users ?? []);
      setRequestMap(sentMap);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    }
  }, []);

  useEffect(() => { load().finally(() => setIsLoading(false)); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setIsLoading(true);
      load(search).finally(() => setIsLoading(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load, search]);

  const startChat = useCallback(async (userId: string) => {
    try {
      const data = await createConversation(userId);
      const id = data.conversation?.id;
      if (!id) throw new Error('Failed to create conversation');
      router.push({ pathname: '/(tabs)/chat/[conversationId]', params: { conversationId: id } });
    } catch (e: any) { setError(e.message || 'Failed to start chat'); }
  }, [router]);

  const requestAccess = useCallback(async (userId: string) => {
    if (sendingId) return;
    try {
      setSendingId(userId);
      await sendRequest(userId);
      setRequestMap((prev) => ({ ...prev, [userId]: 'pending' }));
    } catch (e: any) { setError(e.message || 'Failed to send request'); }
    finally { setSendingId(null); }
  }, [sendingId]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.text }]}>People</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.bellWrap} onPress={() => router.push('/(tabs)/notifications')}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.ghost }]}>
                <Text style={[styles.badgeText, { color: colors.background }]}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Search by name/email" placeholderTextColor="#999"
          style={[styles.search, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
        />
        {error ? <Text style={[styles.error, { color: colors.ghost }]}>{error}</Text> : null}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => startChat(item.id)}
            >
              <View style={styles.presenceDotWrap}>
                <View style={[styles.presenceDot, { backgroundColor: online.has(item.id) ? colors.primary : colors.border }]} />
              </View>
              <View style={styles.rowText}>
                <View style={styles.infoRow}>
                  {item.profileImage
                    ? <Image source={{ uri: item.profileImage }} style={styles.avatar} />
                    : <View style={[styles.avatar, styles.avatarFallback, { borderColor: colors.border }]}>
                        <Text style={[styles.avatarText, { color: colors.subtext }]}>{item.name?.slice(0, 1)?.toUpperCase() || '?'}</Text>
                      </View>
                  }
                  <View style={styles.infoText}>
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.subtitle, { color: colors.subtext }]} numberOfLines={1}>
                      {item.description || 'No description yet.'}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.reqBtn, {
                  borderColor: requestMap[item.id] === 'accepted' ? colors.primary : colors.border,
                  backgroundColor: requestMap[item.id] ? colors.surface : colors.background,
                  opacity: sendingId === item.id ? 0.6 : 1,
                }]}
                onPress={() => requestAccess(item.id)}
                disabled={!!requestMap[item.id]}
              >
                <Ionicons
                  name={requestMap[item.id] === 'accepted' ? 'people' : requestMap[item.id] === 'pending' ? 'time-outline' : 'paper-plane'}
                  size={16}
                  color={requestMap[item.id] === 'accepted' ? colors.primary : requestMap[item.id] === 'pending' ? colors.subtext : colors.primary}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={[styles.empty, { color: colors.subtext }]}>No users found.</Text>}
        />
      )}
      <FabMenu />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, paddingTop: 56, gap: 10 },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: 'KshanaFont', fontSize: 22 },
  bellWrap: { marginLeft: 'auto', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'KshanaFont', fontSize: 10 },
  search: { height: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontFamily: 'KshanaFont' },
  error: { fontFamily: 'KshanaFont', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 24, gap: 12 },
  row: { paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  presenceDotWrap: { width: 14, alignItems: 'center' },
  presenceDot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { flex: 1, gap: 2 },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f0f0f0' },
  avatarText: { fontFamily: 'KshanaFont', fontSize: 14 },
  name: { fontFamily: 'KshanaFont', fontSize: 15 },
  subtitle: { fontFamily: 'KshanaFont', fontSize: 12 },
  reqBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', fontFamily: 'KshanaFont', paddingTop: 30 },
});
