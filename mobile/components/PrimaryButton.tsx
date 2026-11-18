import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, elevation, radius, spacing, typography } from '../lib/theme';

export interface PrimaryButtonProps {
  /** Visible label; also the accessibility label. */
  label: string;
  onPress: () => void;
  /** Muted and announced as disabled; blocks the press unless `reportDisabledPress`. */
  disabled?: boolean;
  /**
   * When `disabled` is set, still call `onPress` so the screen can explain why
   * (used by the manual SSH form to reveal field errors instead of silently
   * swallowing the tap). No request is sent while disabled.
   */
  reportDisabledPress?: boolean;
  /** Shows a spinner and the label; also blocks the press. */
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pill CTA: accent fill, accent ink, glow, accent-hover while pressed. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  reportDisabledPress = false,
  loading = false,
  accessibilityHint,
  style,
}: PrimaryButtonProps) {
  const blocked = loading || (disabled && !reportDisabledPress);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        pressed && !disabled && !loading && styles.pressed,
        (disabled || loading) && styles.inactive,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.accentInk} size="small" /> : null}
      <Text style={[styles.label, (disabled || loading) && styles.inactiveLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.lg + spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accent,
    ...elevation.glow,
  },
  pressed: {
    backgroundColor: colors.accentHover,
    borderColor: colors.accentHover,
  },
  inactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  label: {
    ...typography.cta,
    color: colors.accentInk,
  },
  inactiveLabel: {
    color: colors.faint,
  },
});
