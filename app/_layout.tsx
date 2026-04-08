import { getToken, registerPushToken, removeToken, warmupBackend } from '@/config/api';
import { RealtimeProvider } from '@/contexts/realtime';
import { useThemeColor } from "@/hooks/use-theme-color";
import { subscribeAuthRequired } from '@/utils/auth-events';
import { registerForPushNotificationsAsync } from '@/utils/push';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = useThemeColor();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const [sessionExpiredVisible, setSessionExpiredVisible] = useState(false);
  const sessionHandlingRef = useRef(false);

  const [loaded] = useFonts({
    KshanaFont: require('../assets/fonts/PatrickHand-Regular.ttf'),
  });

  useEffect(() => {
    warmupBackend();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const init = async () => {
      try {
        const token = await getToken();
        if (token) {
          router.replace('/(tabs)');
        } else {
          router.replace('/(pages)/login');
        }
      } catch {
        router.replace('/(pages)/login');
      } finally {
        SplashScreen.hideAsync();
      }
    };
    init();
  }, [loaded, router]);

  const goToLoginAfterSessionExpiry = useCallback(async () => {
    if (sessionHandlingRef.current) return;
    sessionHandlingRef.current = true;
    setSessionExpiredVisible(false);
    await removeToken().catch(() => {});
    router.replace('/(pages)/login');
    setTimeout(() => { sessionHandlingRef.current = false; }, 700);
  }, [router]);

  useEffect(() => {
    const unsubscribe = subscribeAuthRequired(() => {
      if (sessionHandlingRef.current) return;
      setSessionExpiredVisible(true);
    });
    return () => { unsubscribe(); };
  }, []);

  // Register push token with backend
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const pushToken = await registerForPushNotificationsAsync();
        if (!pushToken) return;
        await registerPushToken(pushToken, 'expo');
      } catch {
        // Ignore push registration failures silently
      }
    })();
  }, []);



  if (!loaded) return null;

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <RealtimeProvider>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(pages)" />
              <Stack.Screen name="(tabs)" />
            </Stack>
            <Modal
              visible={sessionExpiredVisible}
              transparent
              animationType="fade"
              onRequestClose={goToLoginAfterSessionExpiry}
            >
              <Pressable
                onPress={goToLoginAfterSessionExpiry}
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
              >
                <Pressable
                  onPress={(e) => e.stopPropagation()}
                  style={{ width: '100%', maxWidth: 360, borderRadius: 18, padding: 20, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, gap: 10 }}
                >
                  <Text style={{ color: colors.text, fontFamily: 'KshanaFont', fontSize: 18 }}>Session Expired</Text>
                  <Text style={{ color: colors.subtext, fontFamily: 'KshanaFont', fontSize: 14 }}>
                    Your login session ended. Tap anywhere to login again.
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={goToLoginAfterSessionExpiry}
                    style={{ marginTop: 6, alignSelf: 'flex-end', backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 }}
                  >
                    <Text style={{ color: colors.background, fontFamily: 'KshanaFont', fontSize: 13 }}>Login Again</Text>
                  </TouchableOpacity>
                </Pressable>
              </Pressable>
            </Modal>
            <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.background} translucent={false} />
          </View>
        </ThemeProvider>
      </RealtimeProvider>
    </SafeAreaProvider>
  );
}

export default RootLayout;
