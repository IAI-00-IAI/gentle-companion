import { StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import { GhostButton } from './GhostButton';
import { PrimaryButton } from './PrimaryButton';
import { colors, radius, spacing, typography } from '../lib/theme';

export interface CameraDeniedPanelProps {
  /** Alert title; defaults to the artboard copy. */
  title?: string;
  /** Alert body; defaults to the artboard copy. */
  body?: string;
  /**
   * Opens the OS settings app. Defaults to `Linking.openSettings()` from
   * expo-linking — this panel imports no navigation module.
   */
  onOpenSettings?: () => void | Promise<void>;
  /** Secondary action: the user says the permission was granted already. */
  onRetry: () => void;
}

/** Artboard copy (`design/mobile-app-onboarding/01-qr-scan.html`, dock). */
const DEFAULT_TITLE = 'Permiso de cámara denegado';
const DEFAULT_BODY =
  'Gentle Movil necesita la cámara para leer el QR. Habilitala en Ajustes del sistema y volvé: no perdés nada de lo que ya configuraste.';

/** Warning triangle drawn with views, so no icon font or emoji is required. */
function WarningTriangle() {
  return <View style={styles.triangle} accessible={false} importantForAccessibility="no" />;
}

/**
 * Camera-denied dock for V1 (artboard
 * `design/mobile-app-onboarding/01-qr-scan.html`): warning alert with the
 * reason, a primary CTA that opens the system settings, and a ghost retry for
 * the user who already granted the permission in another app context.
 */
export function CameraDeniedPanel({
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  onOpenSettings,
  onRetry,
}: CameraDeniedPanelProps) {
  const openSettings = () => {
    // Never reject into the void: a device without a settings deep link just
    // keeps the panel (and its retry) on screen.
    void Promise.resolve(onOpenSettings ? onOpenSettings() : Linking.openSettings()).catch(
      () => undefined,
    );
  };

  return (
    <View style={styles.dock}>
      <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={styles.head}>
          <WarningTriangle />
          <Text style={styles.headText}>{title}</Text>
        </View>
        <Text style={styles.body}>{body}</Text>
      </View>

      <PrimaryButton
        label="Abrir ajustes de cámara"
        onPress={openSettings}
        accessibilityHint="Abre los ajustes del sistema para habilitar la cámara"
      />
      <GhostButton
        label="Ya la habilité · reintentar escaneo"
        onPress={onRetry}
        accessibilityHint="Vuelve a pedir el permiso de cámara y reanuda el escaneo"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    gap: spacing.sm + 2,
  },
  alert: {
    gap: 6,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6.5,
    borderRightWidth: 6.5,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.warning,
  },
  headText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
});
