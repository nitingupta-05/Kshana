import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export default function AutoFlipText({ text1, text2, style } :any) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const interval = setInterval(() => {
      progress.value = withTiming(progress.value === 0 ? 1 : 0, {
        duration: 500,
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [progress]);

  const style1 = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, -18]) }],
  }));

  const style2 = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [18, 0]) }],
  }));

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.text, style, style1]} numberOfLines={1}>
        {text1}
      </Animated.Text>

      <Animated.Text
        style={[styles.text, style, styles.absolute, style2]}
        numberOfLines={1}
      >
        {text2}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 16,
    overflow: 'hidden',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'KshanaFont',
  },
  absolute: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
