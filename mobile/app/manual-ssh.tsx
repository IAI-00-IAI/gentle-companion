import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FingerprintCard } from '../components/FingerprintCard';
import { FormField } from '../components/FormField';
import { GhostButton } from '../components/GhostButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import {
  CoreUnavailableError,
  core,
  type SshCredential,
} from '../lib/core';
import { colors, radius, spacing, typography } from '../lib/theme';
import {
  validateManualSsh,
  type ManualSshErrors,
  type SshAuthMode,
} from '../lib/validation';

/**
 * V2 — Manual SSH entry (artboard
 * `design/mobile-app-onboarding/02-manual-ssh.html`).
 *
 * The connect call goes through `core.sshConnect` (spec §6 contract). The dev
 * fallback rejects with `CoreUnavailableError`, and that rejection is surfaced
 * as an inline notice — this screen never claims a connection it did not make.
 */

/**
 * Plausible ed25519 host fingerprint for the artboard state (TOFU comparison,
 * spec §1/§8). The real value comes from the QR payload (`PairInfo.fp`) or from
 * the core handshake once the binding lands.
 */
const HOST_FINGERPRINT =
  '7C39A1D4E05B8F26AA14C7DE9031B6F2D8E4A7C10F5B39D6E2A8C47B90DF16E5';

const AUTH_OPTIONS: readonly SegmentedOption<SshAuthMode>[] = [
  { value: 'password', label: 'Contraseña' },
  { value: 'key', label: 'Clave SSH' },
];

type ConnectionStatus = 'idle' | 'connecting';

interface Notice {
  tone: 'danger' | 'ok';
  message: string;
}

export default function ManualSshScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [user, setUser] = useState('');
  const [auth, setAuth] = useState<SshAuthMode>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);

  const errors = useMemo<ManualSshErrors>(
    () => validateManualSsh({ host, port, user, auth, password, keyPath }),
    [host, port, user, auth, password, keyPath],
  );
  const valid = Object.keys(errors).length === 0;
  const shown: ManualSshErrors = attempted ? errors : {};
  const connecting = status === 'connecting';
  const locked = connecting;

  const handleConnect = useCallback(async () => {
    setAttempted(true);
    setNotice(null);

    const fresh = validateManualSsh({ host, port, user, auth, password, keyPath });
    if (Object.keys(fresh).length > 0) {
      // Invalid form: reveal the per-field errors and never start a request.
      return;
    }

    const credential: SshCredential =
      auth === 'password'
        ? { type: 'password', value: password }
        : { type: 'key', path: keyPath.trim() };

    setStatus('connecting');
    try {
      const session = await core.sshConnect(host.trim(), Number(port), user.trim(), credential);
      // TODO(ui): hand the handle to V3 (pairing progress) once that route
      // exists; closing it here keeps the honest end state of this slice.
      await session.close();
      setNotice({
        tone: 'ok',
        message:
          'SSH verificado y cerrado. El paso 2 (confirmar huella y emparejar) todavía no está implementado en esta build.',
      });
    } catch (error) {
      if (error instanceof CoreUnavailableError) {
        setNotice({
          tone: 'danger',
          message:
            'No se abrió ninguna conexión: el core nativo SSH no está compilado en esta build (CoreUnavailableError). Nada salió a la red.',
        });
      } else {
        setNotice({
          tone: 'danger',
          message: `No pudimos conectar con ${host.trim()}. Revisá que el SSH esté activo y que estén en la misma red.`,
        });
      }
    } finally {
      setStatus('idle');
    }
  }, [auth, host, keyPath, password, port, user]);

  return (
    <View style={styles.screen}>
      <View style={[styles.bar, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.brand} accessible accessibilityLabel="gentle movil">
          <View style={styles.piTile} importantForAccessibility="no-hide-descendants">
            <Text style={styles.pi} accessibilityElementsHidden>
              π
            </Text>
          </View>
          <Text style={styles.wordmark} importantForAccessibility="no">
            gentle <Text style={styles.wordmarkAccent}>movil</Text>
          </Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>emparejar</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.eyebrow}>conexión · paso 1 de 2</Text>
          <Text style={styles.h1} accessibilityRole="header">
            Conectá por SSH
          </Text>
          <Text style={styles.lede}>
            Mismos pasos que el QR, sin cámara. Funciona en tu red local o por IP fija.
          </Text>

          <View style={styles.form}>
            <View style={styles.group}>
              <Text style={styles.legend}>Tu computadora</Text>
              <FormField
                label="Host o IP"
                value={host}
                onChangeText={setHost}
                placeholder="192.168.1.42"
                error={shown.host}
                accessibilityHint="IP o nombre de tu computadora en la red"
                editable={!locked}
                returnKeyType="next"
              />
              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <FormField
                    label="Puerto"
                    hint="por defecto 22"
                    value={port}
                    onChangeText={setPort}
                    placeholder="22"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={5}
                    error={shown.port}
                    editable={!locked}
                  />
                </View>
                <View style={styles.rowItem}>
                  <FormField
                    label="Usuario"
                    value={user}
                    onChangeText={setUser}
                    placeholder="reaan"
                    autoComplete="username"
                    error={shown.user}
                    editable={!locked}
                  />
                </View>
              </View>
            </View>

            <View style={styles.group}>
              <Text style={styles.legend}>Autenticación</Text>
              <SegmentedControl
                options={AUTH_OPTIONS}
                value={auth}
                onChange={setAuth}
                accessibilityLabel="Autenticación"
                disabled={locked}
              />
              <View style={styles.authHint}>
                {auth === 'key' ? (
                  <Text style={styles.authHintText}>
                    Usaremos{' '}
                    <Text style={styles.authHintStrong}>gentle-movil-ed25519</Text>, tu par guardado
                    en el Keychain. Después del primer emparejamiento no volvés a escribirla.
                  </Text>
                ) : (
                  <Text style={styles.authHintText}>
                    La contraseña se usa solo en esta conexión: no la guardamos en el dispositivo.
                  </Text>
                )}
              </View>

              {auth === 'password' ? (
                <FormField
                  label="Contraseña"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Tu contraseña de SSH"
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  error={shown.credential}
                  editable={!locked}
                  returnKeyType="done"
                  onSubmitEditing={handleConnect}
                />
              ) : (
                <FormField
                  label="Clave SSH"
                  hint="ruta del archivo"
                  value={keyPath}
                  onChangeText={setKeyPath}
                  placeholder="~/.ssh/id_ed25519"
                  error={shown.credential}
                  editable={!locked}
                  returnKeyType="done"
                  onSubmitEditing={handleConnect}
                />
              )}
            </View>

            <FingerprintCard
              fingerprint={HOST_FINGERPRINT}
              label="Huella del host · ed25519"
              confirmation="Confirmá que coincide con tu computadora."
              fine="Primer uso: la guardamos al conectar. Si cambia más adelante, te volvemos a preguntar."
            />
          </View>
        </ScrollView>

        <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.lg }]}>
          {notice ? <NoticeCard tone={notice.tone} message={notice.message} /> : null}
          <PrimaryButton
            label={connecting ? 'Conectando por SSH…' : 'Conectar'}
            onPress={handleConnect}
            loading={connecting}
            disabled={!valid}
            reportDisabledPress
            accessibilityHint="Abre la conexión SSH con tu computadora"
          />
          <GhostButton
            label="Escanear el QR en su lugar"
            onPress={() => router.replace('/scan-qr')}
            accessibilityHint="Vuelve a la pantalla de escaneo de QR"
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Inline state notice: danger tint for failures, ok tint for verified events. */
function NoticeCard({ tone, message }: Notice) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.notice, tone === 'danger' ? styles.noticeDanger : styles.noticeOk]}
    >
      <View
        style={[styles.noticeDot, tone === 'danger' ? styles.noticeDotDanger : styles.noticeDotOk]}
      />
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm + 2,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  piTile: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md - 2,
    backgroundColor: colors.surface,
  },
  pi: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.accentText,
  },
  wordmark: {
    ...typography.wordmark,
    color: colors.text,
  },
  wordmarkAccent: {
    color: colors.accentText,
  },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
    paddingHorizontal: spacing.md - 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipText: {
    ...typography.chip,
    color: colors.muted,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 2,
    paddingBottom: spacing.xxl,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.faint,
  },
  h1: {
    ...typography.h1,
    marginTop: 6,
    color: colors.text,
  },
  lede: {
    ...typography.lede,
    marginTop: 6,
    maxWidth: 320,
    color: colors.muted,
  },
  form: {
    gap: 14,
    marginTop: spacing.lg,
  },
  group: {
    gap: spacing.md - 3,
  },
  legend: {
    ...typography.legend,
    color: colors.faint,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  authHint: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentText,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  authHintText: {
    ...typography.body,
    color: colors.muted,
  },
  authHintStrong: {
    fontWeight: '700',
    color: colors.text,
  },
  dock: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  noticeDanger: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  noticeOk: {
    borderColor: colors.ok,
    backgroundColor: colors.okSoft,
  },
  noticeDot: {
    width: 7,
    height: 7,
    marginTop: 6,
    borderRadius: radius.pill,
  },
  noticeDotDanger: {
    backgroundColor: colors.danger,
  },
  noticeDotOk: {
    backgroundColor: colors.ok,
  },
  noticeText: {
    flex: 1,
    ...typography.body,
    color: colors.text,
  },
});
