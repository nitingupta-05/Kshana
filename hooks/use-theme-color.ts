import { useColorScheme } from 'react-native';

export const Colors = {
  dark: {
    background: "#1C1917",
    surface: "#292524",
    primary: "#F59E0B",
    ghost: "#F87171",
    text: "#FFF7ED",
    subtext: "#A8A29E",
    border: "#44403C"
  },
  light: {
    background: "#FFF7ED",
    surface: "#FFFFFF",
    primary: "#D97706",
    ghost: "#DC2626",
    text: "#1C1917",
    subtext: "#78716C",
    border: "#E7E5E4"
  }
};


export function useThemeColor() {
  const theme = useColorScheme() ?? 'light';
  return Colors[theme];
}