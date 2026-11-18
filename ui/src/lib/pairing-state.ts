/**
 * A revoked device cannot be "more revoked": forget() already dropped the token, so the
 * only useful action left is pairing again. Blocking the pairing form there leaves the user
 * on a dead screen with no way forward except reinstalling the app — which an installed PWA
 * makes especially painful, since it is the one place a reinstall is most annoying.
 *
 * The rule: the pairing form is shown whenever this device holds no credential, whatever
 * the connection state says. A stored token means the device is paired and belongs in the
 * app; no token means it belongs here.
 */
export type PairingFormState = {
  /** Whether a device token is currently stored. */
  hasToken: boolean;
  /** The live connection state. */
  connection: string;
  /** True when an invite arrived in the URL, which always shows the invite form. */
  invite: boolean;
};

export function showsPairingForm(state: PairingFormState): boolean {
  if (state.invite) return true;
  // No credential: pairing is the only way forward, so offer it regardless of how the
  // previous session ended (revoked, disconnected, offline).
  return !state.hasToken;
}

/** Whether the revoked explainer is worth showing above the form. */
export function showsRevokedNotice(state: PairingFormState): boolean {
  return !state.invite && !state.hasToken && state.connection === 'revoked';
}
