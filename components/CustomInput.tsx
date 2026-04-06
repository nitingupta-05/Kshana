import { useThemeColor } from '@/hooks/use-theme-color';
import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

// Define the interface so TypeScript knows what props to expect
interface CustomInputProps extends TextInputProps {
  label: string;
  icon?: string;
}

const CustomInput: React.FC<CustomInputProps> = ({ label, icon, value, onChangeText, ...props }) => {
  const colors = useThemeColor();

  return (
    <View style={styles.inputContainer}>
      <Text style={[styles.label, { color: colors.subtext}]}>{icon} {label}</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface }]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#999"
        {...props}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    width: '100%',
    marginBottom: 15,
  },
  label: {
    fontSize: 13,
    fontFamily: 'KshanaFont',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    fontFamily: 'KshanaFont',
  },
});

export default CustomInput;