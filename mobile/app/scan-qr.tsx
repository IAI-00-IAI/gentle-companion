import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraDeniedPanel } from '../components/CameraDeniedPanel';
import { FingerprintCard } from '../components/FingerprintCard';
import { GhostButton } from '../components/GhostButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { QrScanner } from '../components/QrScanner';
import { CoreUnavailableError, core, type PairInfo } from '../lib/core';
import { colors, elevation, radius, spacing, typography } from '../lib/theme';

/**
 * V1 — QR scan (artboard `design/mobile-app-onboarding/01-qr-scan.html`, states
 * in `docs/mobile-views-plan.md` §V1).
 *
 * The scan is validated locally by `parsePairUri` (mirror of
 * `mobile-core/src/qr.rs`), so a foreign code never reaches the native layer and
 * the summary appears without a round trip. `core.pairFromQr` (spec §6) is still
 * called with the raw payload: it rejects with `CoreUnavailableError` in this
 * build, and the screen says so instead of pretending the device was registered.
 */

/** Honest T14 boundary: the SSH core owns native parsing and registration. */
const CORE_NOTE = 'Registro del dispositivo llega con el núcleo SSH (T14)';

const EYEBROW = 'conexión · paso 1 de 2';
const TITLE = 'Escaneá el QR que muestra tu computadora';
const LEDE = 'Se conecta por SSH en tu red local. El código es de un solo uso y caduca en 5 minutos.';
const CAPTION_PAUSED = 'Vista de referencia: así se ve el código que vas a escanear.';
const CAPTION_LIVE = 'Apunta al QR de Gentle Movil. Se lee solo, sin tocar la pantalla.';

/** Decorative QR size in the paused state (artboard: 194px inside 258px). */
const PREVIEW_GRID = 15;
const PREVIEW_SEED = 20_261_117;

/** Deterministic decorative QR: three finder patterns plus seeded modules. */
function buildPreviewRows(): boolean[][] {
  let seed = PREVIEW_SEED;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const finder = (row: number, col: number, originRow: number, originCol: number) => {
    const localRow = row - originRow;
    const localCol = col - originCol;
    if (localRow < 0 || localRow > 4 || localCol < 0 || localCol > 4) {
      return false;
    }
    const outer = localRow === 0 || localRow === 4 || localCol === 0 || localCol === 4;
    return outer || (localRow === 2 && localCol === 2);
  };

  const rows: boolean[][] = [];
  for (let row = 0; row < PREVIEW_GRID; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < PREVIEW_GRID; col += 1) {
      const inFinder =
        finder(row, col, 0, 0) ||
        finder(row, col, 0, PREVIEW_GRID - 5) ||
        finder(row, col, PREVIEW_GRID - 5, 0);
      const nearFinder =
        (row < 6 && col < 6) ||
        (row < 6 && col > PREVIEW_GRID - 7) ||
        (row > PREVIEW_GRID - 7 && col < 6);
      cells.push(inFinder || (!nearFinder && next() > 0.52));
    }
    rows.push(cells);
  }
  return rows;
}

const PREVIEW_ROWS = buildPreviewRows();

/** Paused artboard state: dimmed QR preview inside the bracket frame. */
function PausedPreview() {
  return (
    <View
      style={styles.preview}
      accessible
      accessibilityLabel="Vista previa del código QR de emparejamiento, atenuada porque la cámara está en pausa"
    >
      <View style={styles.previewQr} accessible={false} importantForAccessibility="no-hide-descendants">
        {PREVIEW_ROWS.map((cells, row) => (
          <View key={`row-${row}`} style={styles.previewRow}>
            {cells.map((dark, col) => (
              <View
                key={`cell-${row}-${col}`}
                style={[styles.previewCell, dark && styles.previewCellDark]}
              />
            ))}
          </View>
        ))}
      </View>

      <View style={styles.pausedPill} accessible={false} importantForAccessibility="no">
        <View style={styles.pauseBars}>
          <View style={styles.pauseBar} />
          <View style={styles.pauseBar} />
        </View>
        <Text style={styles.pausedText}>cámara en pausa</Text>
      </View>
    </View>
  );
}

/** Corner brackets drawn around the viewport (artboard `.bracket`). */
function Brackets() {
  return (
    <>
      <View style={[styles.bracket, styles.bracketTl]} accessible={false} importantForAccessibility="no" />
      <View style={[styles.bracket, styles.bracketTr]} accessible={false} importantForAccessibility="no" />
      <View style={[styles.bracket, styles.bracketBl]} accessible={false} importantForAccessibility="no" />
      <View style={[styles.bracket, styles.bracketBr]} accessible={false} importantForAccessibility="no" />
    </>
  );
}

export default function ScanQrScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

  const [pair, setPair] = useState<PairInfo | null>(null);
  const [invalidMessage, setInvalidMessage] = useState('');

  // Live only when the OS said yes and there is nothing to freeze on screen.
  const live = permission?.granted === true && pair === null;

  const requestCamera = useCallback(async () => {
    setInvalidMessage('');
    try {
      await requestPermission();
    } catch {
      // The OS refused to show the prompt (locked policy). The dock keeps the
      // current state and the settings CTA, so nothing is lost.
    }
  }, [requestPermission]);

  const handlePaired = useCallback(async (info: PairInfo, raw: string) => {
    setInvalidMessage('');
    setPair(info);
    try {
      await core.pairFromQr(raw);
    } catch (error) {
      // `CoreUnavailableError` today: the native parser and the device
      // registration belong to T14 (§2, §3). The summary stays on screen with
      // the note below instead of a fake "paired" confirmation.
      if (!(error instanceof CoreUnavailableError)) {
        setInvalidMessage('El QR se leyó, pero el núcleo no pudo procesarlo en esta build.');
      }
    }
  }, []);

  const handleInvalidCode = useCallback((message: string) => {
    setInvalidMessage(message);
  }, []);

  const rescan = useCallback(() => {
    setInvalidMessage('');
    setPair(null);
  }, []);

  const denied = permission !== null && permission.status === 'denied';

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
          <View style={styles.chipDot} accessible={false} />
          <Text style={styles.chipText}>emparejar</Text>
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{EYEBROW}</Text>
        <Text style={styles.h1} accessibilityRole="header">
          {TITLE}
        </Text>
        <Text style={styles.lede}>{LEDE}</Text>

        <View style={styles.scannerWrap}>
          <View style={styles.scanner}>
            <View style={styles.viewport}>
              {live ? (
                <QrScanner
                  active={live}
                  onPaired={handlePaired}
                  onInvalidCode={handleInvalidCode}
                />
              ) : (
                <PausedPreview />
              )}
            </View>
            <Brackets />
          </View>
          <Text style={styles.caption}>{live ? CAPTION_LIVE : CAPTION_PAUSED}</Text>
        </View>

        <Text style={styles.alt}>
          o conectá por SSH:{' '}
          <Link href="/manual-ssh" style={styles.altLink}>
            IP · usuario · clave
          </Link>
        </Text>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.xxl }]}>
        {invalidMessage !== '' && pair === null ? (
          <View style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <View style={styles.noticeDot} accessible={false} />
            <Text style={styles.noticeText}>{invalidMessage}</Text>
          </View>
        ) : null}

        {pair !== null ? (
          <View style={styles.summary}>
            <View style={styles.summaryHead}>
              <View style={styles.summaryDot} accessible={false} />
              <Text style={styles.summaryTitle}>QR leído</Text>
            </View>
            <SummaryRow label="Host" value={`${pair.host}:${pair.port}`} />
            <SummaryRow label="Usuario" value={pair.user} />
            <FingerprintCard
              fingerprint={pair.fp}
              label="Huella del host · ed25519"
              confirmation="Compará con la que muestra tu computadora."
              fine={CORE_NOTE}
            />
            <Text style={styles.summaryFine}>
              Todavía no se abrió ninguna conexión: el registro y el túnel llegan con el núcleo
              SSH.
            </Text>
            <GhostButton label="Escanear otro QR" onPress={rescan} />
          </View>
        ) : denied ? (
          <CameraDeniedPanel onRetry={requestCamera} />
        ) : !live ? (
          // Permission undetermined (or still loading): the OS prompt needs a tap,
          // so the paused viewport is paired with the explanation CTA.
          <PrimaryButton
            label="Permitir cámara"
            onPress={requestCamera}
            accessibilityHint="Pide permiso de cámara para leer el QR de tu computadora"
          />
        ) : null}
      </View>
    </View>
  );
}

/** One label/value row of the paired summary. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
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
    paddingBottom: 14,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  piTile: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  pi: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.accent,
  },
  wordmark: {
    ...typography.wordmark,
    fontSize: 13,
    color: colors.text,
  },
  wordmarkAccent: {
    color: colors.accentText,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 26,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  chipText: {
    ...typography.chip,
    color: colors.accentText,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 10,
    paddingBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.faint,
  },
  h1: {
    ...typography.h1,
    marginTop: 10,
    color: colors.text,
    maxWidth: 340,
  },
  lede: {
    ...typography.lede,
    marginTop: spacing.md,
    maxWidth: 300,
    color: colors.muted,
  },
  scannerWrap: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  scanner: {
    width: 258,
    height: 258,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.bento,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewport: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.bento,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewQr: {
    width: 194,
    height: 194,
    opacity: 0.42,
  },
  previewRow: {
    flex: 1,
    flexDirection: 'row',
  },
  previewCell: {
    flex: 1,
  },
  previewCellDark: {
    backgroundColor: colors.accent,
  },
  pausedPill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  pauseBars: {
    flexDirection: 'row',
    gap: 3,
  },
  pauseBar: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: colors.warning,
  },
  pausedText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.text,
  },
  caption: {
    maxWidth: 260,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 17,
    color: colors.faint,
  },
  bracket: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: radius.sm,
  },
  bracketTl: {
    top: -2,
    left: -2,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.bento,
  },
  bracketTr: {
    top: -2,
    right: -2,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: radius.bento,
  },
  bracketBl: {
    bottom: -2,
    left: -2,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: radius.bento,
  },
  bracketBr: {
    bottom: -2,
    right: -2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: radius.bento,
  },
  alt: {
    marginTop: spacing.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 13,
    lineHeight: 21,
    color: colors.muted,
  },
  altLink: {
    color: colors.accentText,
    fontWeight: '600',
  },
  dock: {
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  noticeDot: {
    width: 7,
    height: 7,
    marginTop: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  noticeText: {
    flex: 1,
    ...typography.body,
    color: colors.text,
  },
  summary: {
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.ok,
  },
  summaryTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.text,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryLabel: {
    ...typography.hint,
    color: colors.faint,
  },
  summaryValue: {
    ...typography.input,
    color: colors.text,
    fontWeight: '600',
  },
  summaryFine: {
    ...typography.fine,
    color: colors.faint,
  },
});
