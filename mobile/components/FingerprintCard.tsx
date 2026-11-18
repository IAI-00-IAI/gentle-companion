import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../lib/theme';

export interface FingerprintCardProps {
  /**
   * Host key fingerprint (hex). Separators and case are normalised, then the
   * value is rendered in groups of four hex digits so it can be compared with
   * the host's own output.
   */
  fingerprint: string;
  /** Card title, e.g. "Huella del host · ed25519". */
  label: string;
  /** Confirmation line the user reads out loud, e.g. "Confirmá que coincide con tu computadora." */
  confirmation: string;
  /** Fine print under the confirmation line (TOFU policy). */
  fine?: string;
}

const GROUP_SIZE = 4;

function toHexGroups(fingerprint: string): string[] {
  const hex = fingerprint.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const groups: string[] = [];
  for (let index = 0; index < hex.length; index += GROUP_SIZE) {
    groups.push(hex.slice(index, index + GROUP_SIZE));
  }
  return groups;
}

/** Lock badge drawn with views, so no icon font or emoji is required. */
function WarningLock() {
  return (
    <View style={styles.lock} accessible={false} importantForAccessibility="no">
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

/**
 * TOFU fingerprint card (V2/V3): host identity is shown before the first
 * connection so the user can compare it with their computer (spec §1, §8).
 */
export function FingerprintCard({
  fingerprint,
  label,
  confirmation,
  fine,
}: FingerprintCardProps) {
  const groups = toHexGroups(fingerprint);

  return (
    <View style={styles.card} accessible accessibilityLabel={`${label}: ${groups.join(' ')}`}>
      <View style={styles.head}>
        <WarningLock />
        <Text style={styles.label}>{label}</Text>
      </View>

      <View style={styles.groups} accessible={false}>
        {groups.map((group, index) => (
          <Text
            key={`${group}-${index}`}
            style={styles.group}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {group}
          </Text>
        ))}
      </View>

      <View style={styles.confirmLine} accessible={false}>
        <Text style={styles.check}>✓</Text>
        <Text style={styles.confirmText}>{confirmation}</Text>
      </View>

      {fine ? <Text style={styles.fine}>{fine}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lock: {
    width: 14,
    height: 15,
    alignItems: 'center',
  },
  lockShackle: {
    width: 9,
    height: 6,
    marginTop: 1,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: colors.warning,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
  },
  lockBody: {
    width: 13,
    height: 9,
    marginTop: -0.5,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  label: {
    ...typography.legend,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.faint,
  },
  groups: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: spacing.xs,
  },
  group: {
    ...typography.fingerprint,
    color: colors.accentText,
  },
  confirmLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  check: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.ok,
  },
  confirmText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
  },
  fine: {
    ...typography.fine,
    color: colors.faint,
  },
});
