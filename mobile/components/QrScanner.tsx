import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';

import type { PairInfo } from '../lib/core';
import { parsePairUri } from '../lib/qr-parse';
import { colors, radius } from '../lib/theme';

export interface QrScannerProps {
  /** Whether the camera should be capturing. Inactive stops the preview entirely. */
  active?: boolean;
  /**
   * Called once per accepted pair code with the locally parsed `PairInfo` and
   * the raw scanned string, so the screen can hand the original payload to
   * `core.pairFromQr` (the native parser, spec §6).
   */
  onPaired: (pair: PairInfo, raw: string) => void;
  /** Called with user copy when a scanned code is not a valid invitation. */
  onInvalidCode?: (message: string) => void;
  style?: StyleProp<ViewStyle>;
}

/** Minimum delay between two reports of the same rejected code, in ms. */
const INVALID_REPORT_INTERVAL = 2000;

/**
 * Camera preview for the V1 QR scan (artboard
 * `design/mobile-app-onboarding/01-qr-scan.html`).
 *
 * The component only scans: it validates the payload locally with
 * `parsePairUri` (so a foreign QR never reaches the native layer), reports the
 * raw string plus its parsed form, and draws nothing else — the screen owns the
 * bracket frame, the paused state and the dock. Camera permission is the
 * screen's concern too (`useCameraPermissions`), so this stays a dumb view.
 */
export function QrScanner({ active = true, onPaired, onInvalidCode, style }: QrScannerProps) {
  // The camera fires `onBarcodeScanned` continuously; latches keep one accepted
  // code from being delivered twice and one rejected code from spamming the
  // notice. Both reset when the preview is deactivated (freeze/unpair).
  const accepted = useRef(false);
  const lastRejected = useRef<{ data: string; at: number } | null>(null);

  useEffect(() => {
    if (!active) {
      accepted.current = false;
      lastRejected.current = null;
    }
  }, [active]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (!active || accepted.current) {
        return;
      }

      const parsed = parsePairUri(result.data);
      if (!parsed.ok) {
        const now = Date.now();
        const previous = lastRejected.current;
        if (previous && previous.data === result.data && now - previous.at < INVALID_REPORT_INTERVAL) {
          return;
        }
        lastRejected.current = { data: result.data, at: now };
        onInvalidCode?.(parsed.error.message);
        return;
      }

      accepted.current = true;
      lastRejected.current = null;
      onPaired(parsed.value, result.data);
    },
    [active, onInvalidCode, onPaired],
  );

  return (
    <CameraView
      style={[styles.camera, style]}
      facing="back"
      active={active}
      // QR only: any other barcode type is noise for the pairing flow.
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={active ? handleScan : undefined}
    />
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
    borderRadius: radius.bento,
    overflow: 'hidden',
    backgroundColor: colors.bgSunken,
  },
});
