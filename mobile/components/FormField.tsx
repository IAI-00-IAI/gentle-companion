import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { colors, radius, spacing, typography } from '../lib/theme';

export interface FormFieldProps {
  /** Field label, also used as the accessibility label. */
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Small right-aligned hint next to the label, e.g. "por defecto 22". */
  hint?: string;
  placeholder?: string;
  /** Validation message; renders in danger below the input. */
  error?: string;
  accessibilityHint?: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  inputMode?: TextInputProps['inputMode'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  autoCorrect?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  maxLength?: number;
  /** Locks editing while a connection is in flight. */
  editable?: boolean;
}

/** Label + input + error, matching the field pattern of the onboarding artboard. */
export function FormField({
  label,
  value,
  onChangeText,
  hint,
  placeholder,
  error,
  accessibilityHint,
  secureTextEntry,
  keyboardType,
  inputMode,
  autoCapitalize = 'none',
  autoComplete = 'off',
  textContentType,
  autoCorrect = false,
  returnKeyType,
  onSubmitEditing,
  maxLength,
  editable = true,
}: FormFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? accessibilityHint}
        accessibilityState={{ disabled: !editable }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        autoCorrect={autoCorrect}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        maxLength={maxLength}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          focused && styles.focused,
          error ? styles.invalid : null,
          !editable && styles.inactive,
        ]}
      />
      {error ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.errorRow}
        >
          <View style={styles.errorBadge}>
            <Text style={styles.errorBadgeText}>!</Text>
          </View>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  hint: {
    ...typography.hint,
    color: colors.faint,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    ...typography.input,
  },
  focused: {
    borderColor: colors.borderStrong,
  },
  invalid: {
    borderColor: colors.danger,
  },
  inactive: {
    color: colors.muted,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  errorBadge: {
    width: 12,
    height: 12,
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  errorBadgeText: {
    fontSize: 8,
    lineHeight: 9,
    fontWeight: '700',
    color: colors.danger,
  },
  errorText: {
    flex: 1,
    ...typography.error,
    color: colors.danger,
  },
});
