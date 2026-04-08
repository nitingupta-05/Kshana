import { getToken, registerPushToken } from '@/config/api';
import { RealtimeProvider } from '@/contexts/realtime';
import { useThemeColor } from "@/hooks/use-theme-color";
import { subscribeAuthRequired } from '@/utils/auth-events';
import { registerForPushNotificationsAsync } from '@/utils/push';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert, Platform, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = useThemeColor();
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  const [loaded] = useFonts({
    KshanaFont: require('../assets/fonts/PatrickHand-Regular.ttf'),
  });

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

  useEffect(() => {
    const unsubscribe = subscribeAuthRequired(() => {
      Alert.alert('Session Expired', 'Please login again.', [
        { text: 'Login', onPress: () => router.replace('/(pages)/login') },
      ], { cancelable: false });
    });
    return () => { unsubscribe(); };
  }, [router]);

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
            <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.background} translucent={false} />
          </View>
        </ThemeProvider>
      </RealtimeProvider>
    </SafeAreaProvider>
  );
}

export default RootLayout;
