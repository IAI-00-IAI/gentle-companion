import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '../lib/theme';

export interface GhostButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Borderless secondary action: muted text, accent text while pressed. */
export function GhostButton({
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  style,
}: GhostButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        pressed && !disabled && styles.pressed,
        disabled && styles.inactive,
        style,
      ]}
    >
      {({ pressed }) => (
        <Text style={[styles.label, pressed && !disabled && styles.pressedLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    borderColor: colors.accent,
  },
  inactive: {
    borderColor: colors.bgSunken,
  },
  label: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.muted,
  },
  pressedLabel: {
    color: colors.accentText,
  },
});
