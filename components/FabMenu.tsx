import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

type TabKey = 'chats' | 'people' | 'profile' | 'chat';

const tabKeyForPath = (pathname: string): TabKey => {
  if (pathname.includes('/people')) return 'people';
  if (pathname.includes('/profile')) return 'profile';
  if (pathname.includes('/chat')) return 'chat';
  return 'chats';
};

export function FabMenu() {
  const colors = useThemeColor();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Animation values
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 8,
    }).start();
  }, [open, anim]);

  const fabRotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const fabScale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  const currentTab = useMemo(() => tabKeyForPath(pathname || ''), [pathname]);

  const currentIcon = useMemo(() => {
    if (currentTab === 'people') return 'people';
    if (currentTab === 'profile') return 'person-circle';
    if (currentTab === 'chat') return 'chatbubble';
    return 'chatbubble-ellipses';
  }, [currentTab]);

  const menuItems = useMemo(() => [
    { key: 'chats' as const, path: '/(tabs)', icon: 'chatbubble-ellipses' as const },
    { key: 'people' as const, path: '/(tabs)/people', icon: 'people' as const },
    { key: 'profile' as const, path: '/(tabs)/profile', icon: 'person-circle' as const },
  ], []);

  const visibleMenuItems = useMemo(() => {
    if (currentTab === 'chat') return menuItems;
    return menuItems.filter((i) => i.key !== currentTab);
  }, [currentTab, menuItems]);

  const go = (path: string) => {
    setOpen(false);
    router.push(path as any);
  };

  return (
    <View style={[styles.container, styles.pointerEventsNone]}>
      {open && <Pressable style={styles.overlay} onPress={() => setOpen(false)} />}

      <View style={[styles.stack, styles.pointerEventsNone]}>
        {/* Menu items with staggered slide-in */}
        <View style={styles.menu}>
          {visibleMenuItems.map((item, i) => {
            const delay = open ? i * 40 : (visibleMenuItems.length - 1 - i) * 30;
            const itemAnim = anim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            });
            const itemOpacity = anim.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0, 1],
            });
            return (
              <Animated.View
                key={item.key}
                style={{
                  transform: [{ translateY: itemAnim }],
                  opacity: itemOpacity,
                }}
              >
                <TouchableOpacity
                  style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  onPress={() => go(item.path)}
                >
                  <Ionicons name={item.icon as any} size={22} color={colors.text} />
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        {/* FAB with rotation */}
        <Animated.View style={{ transform: [{ rotate: fabRotate }, { scale: fabScale }] }}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={() => setOpen((p) => !p)}
          >
            <Ionicons name={open ? 'close' : currentIcon as any} size={26} color={colors.background} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', right: 18, bottom: 18, zIndex: 10, alignItems: 'flex-end' },
  overlay: { position: 'absolute', top: -1000, bottom: 100, left: -1000, right: 100 },
  stack: { alignItems: 'center' },
  menu: { marginBottom: 10, alignItems: 'flex-end', gap: 8 },
  menuItem: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fab: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  pointerEventsNone: { pointerEvents: 'box-none' as any },
});
