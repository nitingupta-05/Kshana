import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const SocialLogins = () => {
  const icons = [
    { uri: 'https://freelogopng.com/images/all_img/1657955079google-icon-png.png' },
    { uri: 'https://static.vecteezy.com/system/resources/previews/018/930/698/non_2x/facebook-logo-facebook-icon-transparent-free-png.png' },
    { uri: 'https://cdn-icons-png.flaticon.com/512/0/747.png' },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.divider}>——— or ———</Text>
      <View style={styles.iconRow}>
        {icons.map((icon, index) => (
          <TouchableOpacity key={index}>
            <Image source={{ uri: icon.uri }} style={styles.image} resizeMode="contain" />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 20,
  },
  divider: {
    color: '#999',
    marginBottom: 15,
  },
  iconRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  image: {
    width: 30,
    height: 30,
    marginHorizontal: 10,
  },
});

export default SocialLogins;