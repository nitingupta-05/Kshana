import AutoFlipText from '@/components/AutoFlipText';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

export default function TopNav() {
  const colors = useThemeColor();
  const router = useRouter();
  const { unreadCount } = useRealtime();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      <View style={styles.content}>
        <Image source={require('@/assets/images/logo.png')} style={styles.logo} resizeMode="contain" />

        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]}>
            Kshana
          </Text>

          <AutoFlipText 
              text1="releive your moments!"
              text2="Developer is around you!"
              style={{ color: colors.subtext }}
          />
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.iconBtn}
          onPress={() => router.push('/(tabs)/stories')}
        >
          <Ionicons name="aperture-outline" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.bellWrap}
          onPress={() => router.push('/(tabs)/notifications')}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          {unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.ghost }]}>
              <Text style={[styles.badgeText, { color: colors.background }]}>
                {unreadCount > 99 ? '99+' : String(unreadCount)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
    paddingHorizontal: 16,
    marginTop: 50,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 42,
    height: 42,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    marginBottom: 2,
    fontFamily: 'KshanaFont',
  },
  bellWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: 'KshanaFont', fontSize: 10 },
});
