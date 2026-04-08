import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import CustomInput from '@/components/CustomInput';
import { FabMenu } from '@/components/FabMenu';
import { API_ENDPOINTS, apiCall, removeToken } from '@/config/api';
import { useRealtime } from '@/contexts/realtime';
import { useThemeColor } from '@/hooks/use-theme-color';
import { cacheGet, cacheSet } from '@/utils/cache';

type ProfileForm = {
  name: string;
  email: string;
  description: string;
  photo: string;
  mood: string;
};

export default function ProfileScreen() {
  const colors = useThemeColor();
  const router = useRouter();
  const { socket } = useRealtime();

  const [form, setForm] = useState<ProfileForm>({ name: '', email: '', description: '', photo: '', mood: '' });
  const [snapshot, setSnapshot] = useState<ProfileForm>({ name: '', email: '', description: '', photo: '', mood: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showMoodPicker, setShowMoodPicker] = useState(false);

  const MOOD_PRESETS = ['', '🟢 Available', '🎯 Focused', '🎮 Gaming', '🎵 Listening', '📚 Studying', '🔕 Do not disturb', '😴 Sleeping', '🚗 Driving', '🏋️ Working out'];

  useEffect(() => {
    let isMounted = true;
    // Load from cache instantly
    cacheGet<ProfileForm>('profile', 10 * 60_000).then((cached) => {
      if (cached && isMounted) {
        setForm(cached); setSnapshot(cached); setIsLoading(false);
      }
    });
    // Fetch fresh in background
    apiCall(API_ENDPOINTS.PROFILE, 'GET', undefined, true).then((data) => {
      if (!isMounted) return;
      const nextForm: ProfileForm = {
        name: data.name, email: data.email,
        description: data.description ?? '', photo: data.profileImage ?? '',
        mood: data.mood ?? '',
      };
      setForm(nextForm); setSnapshot(nextForm);
      setIsLoading(false);
      cacheSet('profile', nextForm);
    }).catch((err: any) => {
      if (isMounted && isLoading) Alert.alert('Error', err.message);
      if (isMounted) setIsLoading(false);
    });
    return () => { isMounted = false; };
  }, []);

  const pickImage = async () => {
    if (!isEditing) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photo library to change profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      // Use base64 directly from picker if available (avoids FileSystem entirely)
      if (asset.base64) {
        setForm({ ...form, photo: `data:image/jpeg;base64,${asset.base64}` });
      } else {
        setForm({ ...form, photo: asset.uri });
      }
    }
  };

  const handleUpdate = async () => {
    if (!form.name || !form.email) {
      return Alert.alert('Error', 'Name and Email are required.');
    }
    try {
      setIsUpdating(true);
      let imageToSave = form.photo;
      // If it's still a local file URI (base64 not available from picker), convert it
      if (form.photo && form.photo.startsWith('file://')) {
        try {
          const base64 = await FileSystem.readAsStringAsync(form.photo, {
            encoding: 'base64' as any,
          });
          if (base64) imageToSave = `data:image/jpeg;base64,${base64}`;
        } catch {
          // send URI as-is if FileSystem fails
        }
      }
      const payload = {
        name: form.name,
        description: form.description,
        profileImage: imageToSave,
      };
      await apiCall(API_ENDPOINTS.UPDATE_PROFILE, 'PATCH', payload, true);
      const saved = { ...form, photo: imageToSave };
      setForm(saved);
      setSnapshot(saved);
      setIsEditing(false);
      cacheSet('profile', saved);
      Alert.alert('Success', 'Profile updated successfully!');
    } catch (err: any) {
      Alert.alert('Update Failed', err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleLogout = async () => {
    await removeToken();
    router.replace('/(pages)/login');
  };

  const updateMood = async (mood: string) => {
    try {
      // Update profile in backend
      await apiCall(API_ENDPOINTS.UPDATE_PROFILE, 'PATCH', { mood }, true);
      const updated = { ...form, mood };
      setForm(updated);
      setSnapshot(updated);
      cacheSet('profile', updated);
      // Broadcast mood to other users via socket
      if (socket?.connected) {
        socket.emit('user:mood', { mood });
      }
    } catch (err: any) {
      console.error('Failed to update mood:', err.message);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.main, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.main, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.text }]}>Profile</Text>
        </View>

        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity onPress={pickImage} style={styles.avatarWrap} activeOpacity={isEditing ? 0.7 : 1}>
            {form.photo ? (
              <Image
                source={{ uri: form.photo }}
                style={styles.avatar}
                onError={() => setForm((f) => ({ ...f, photo: '' }))}
              />
            ) : (
              <View style={styles.placeholder}>
                <Ionicons name="person" size={28} color={colors.subtext} />
              </View>
            )}
            {isEditing && (
              <View style={styles.cameraOverlay}>
                <Ionicons name="camera" size={16} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {!isEditing ? (
            <View style={styles.cardText}>
              <Text style={[styles.name, { color: colors.text }]}>{form.name}</Text>
              <Text style={[styles.meta, { color: colors.subtext }]}>{form.email}</Text>
              <Text style={[styles.meta, { color: colors.subtext }]}>
                {form.description || 'No description yet.'}
              </Text>
              {form.mood ? (
                <TouchableOpacity onPress={() => setShowMoodPicker(true)} style={[styles.moodBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.moodText, { color: colors.primary }]}>{form.mood}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => setShowMoodPicker(true)} style={[styles.moodBadge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.moodText, { color: colors.subtext }]}>+ Set mood</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.cardInputs}>
              <CustomInput
                label="Full Name"
                icon="Name"
                placeholder="Your name"
                value={form.name}
                onChangeText={(text) => setForm({ ...form, name: text })}
              />
              <CustomInput
                label="Email Address"
                icon="Email"
                placeholder="email@gmail.com"
                value={form.email}
                onChangeText={(text) => setForm({ ...form, email: text })}
                keyboardType="email-address"
                editable={false}
              />
              <View style={styles.descBlock}>
                <Text style={[styles.descLabel, { color: colors.subtext }]}>Description</Text>
                <TextInput
                  value={form.description}
                  onChangeText={(text) => setForm({ ...form, description: text })}
                  placeholder="Tell us about yourself"
                  placeholderTextColor="#999"
                  multiline
                  style={[
                    styles.descInput,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      color: colors.text,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.editBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
            onPress={() => {
              if (isEditing) {
                setForm(snapshot);
                setIsEditing(false);
              } else {
                setIsEditing(true);
              }
            }}
          >
            <Ionicons name={isEditing ? 'close' : 'create-outline'} size={16} color={colors.background} />
              <Text style={[styles.editText, { color: colors.background }]}>
                {isEditing ? 'Cancel' : 'Edit Profile'}
              </Text>
            </TouchableOpacity>
        </View>

        <View style={styles.actionRow}>
          {isEditing && (
            <TouchableOpacity
              onPress={handleUpdate}
              style={[styles.actionIcon, { backgroundColor: colors.primary }]}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Ionicons name="checkmark" size={18} color={colors.background} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleLogout}
            style={[styles.actionIcon, { borderColor: colors.border }]}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.ghost} />
          </TouchableOpacity>
        </View>

      </ScrollView>
      <View style={styles.footerFixed}>
        <Text style={[styles.footerText, { color: colors.subtext }]}>
          Version {Constants.expoConfig?.version || '1.0.0'} | made with Developer's ❤️
        </Text>
      </View>
      <FabMenu />
      {/* Mood picker */}
      {showMoodPicker && (
        <View style={[styles.moodOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.moodSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.moodSheetTitle, { color: colors.text }]}>Set Mood</Text>
            {MOOD_PRESETS.map((m) => (
              <TouchableOpacity key={m || 'none'} style={[styles.moodOption, { borderBottomColor: colors.border }]} activeOpacity={0.8}
                onPress={async () => {
                  setForm((f) => ({ ...f, mood: m }));
                  setShowMoodPicker(false);
                  await updateMood(m).catch(() => {});
                }}>
                <Text style={[styles.moodOptionText, { color: form.mood === m ? colors.primary : colors.text }]}>{m || 'Clear mood'}</Text>
                {form.mood === m && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.moodCancel} onPress={() => setShowMoodPicker(false)}>
              <Text style={[styles.moodCancelText, { color: colors.subtext }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  main: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  scrollBody: { padding: 16, paddingBottom: 120 },
  headerRow: { marginTop: 24, marginBottom: 12 },
  title: { fontFamily: 'KshanaFont', fontSize: 22 },
  profileCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  avatarWrap: { alignSelf: 'center', marginTop: 6, marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  placeholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6e6e6',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { alignItems: 'center', gap: 6, paddingBottom: 22 },
  name: { fontFamily: 'KshanaFont', fontSize: 18 },
  meta: { fontFamily: 'KshanaFont', fontSize: 12, textAlign: 'center' },
  cardInputs: { marginTop: 8 },
  editBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  editText: { fontFamily: 'KshanaFont', fontSize: 12 },
  descBlock: { marginTop: 6 },
  descLabel: { fontFamily: 'KshanaFont', fontSize: 12, marginBottom: 6 },
  descInput: {
    minHeight: 120,
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontFamily: 'KshanaFont',
  },
  actionRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  footerFixed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
  },
  footerText: { fontFamily: 'KshanaFont', fontSize: 12 },
  moodBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 6 },
  moodText: { fontFamily: 'KshanaFont', fontSize: 13 },
  moodOverlay: { position: 'absolute', inset: 0, justifyContent: 'flex-end' },
  moodSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingBottom: 32 },
  moodSheetTitle: { fontFamily: 'KshanaFont', fontSize: 16, padding: 20, paddingBottom: 8 },
  moodOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  moodOptionText: { fontFamily: 'KshanaFont', fontSize: 15 },
  moodCancel: { alignItems: 'center', padding: 16 },
  moodCancelText: { fontFamily: 'KshanaFont', fontSize: 14 },
});
