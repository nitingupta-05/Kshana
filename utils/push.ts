import { Platform } from 'react-native';

/**
 * Stub for push notification registration.
 * expo-notifications was removed — returns null safely.
 * Replace with real implementation if you add expo-notifications back.
 */
export const registerForPushNotificationsAsync = async (): Promise<string | null> => {
  if (Platform.OS === 'web') return null;
  return null;
};
