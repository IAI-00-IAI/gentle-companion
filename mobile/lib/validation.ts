/**
 * Validation for the manual SSH entry screen (V2 in
 * `docs/mobile-views-plan.md`).
 *
 * Pure and framework-free on purpose: the rules and copy below are pinned by
 * `mobile/test/manual-ssh-validation.test.mjs`, so they can be verified without
 * a React Native runtime. Copy is Spanish rioplatense (voseo), matching the
 * artboard `design/mobile-app-onboarding/02-manual-ssh.html`.
 */

/** How the screen authenticates on the host. */
export type SshAuthMode = 'password' | 'key';

/** Raw text state of the form; the screen owns the TextInput bindings. */
export interface ManualSshInput {
  host: string;
  port: string;
  user: string;
  auth: SshAuthMode;
  password: string;
  keyPath: string;
}

/** Field keys that can carry an error. */
export type ManualSshField = 'host' | 'port' | 'user' | 'credential';

export type ManualSshErrors = Partial<Record<ManualSshField, string>>;

/** The only copy the screen shows for a rejected field. */
export const manualSshErrorCopy = {
  hostRequired: 'Escribí la IP o el host de tu computadora.',
  hostInvalid: 'Formato de host no válido. Revisá la IP o el nombre.',
  portInvalid: 'Puerto 1–65535',
  userRequired: 'Escribí el usuario SSH.',
  userInvalid: 'El usuario no puede tener espacios ni @.',
  passwordRequired: 'Escribí la contraseña.',
  keyPathRequired: 'Elegí la ruta de tu clave SSH.',
} as const;

const HOST_NAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const DOTTED_QUAD_PATTERN = /^\d{1,4}\.\d{1,4}(?:\.\d{1,4}){1,2}$/;
const IPV6_PATTERN = /^[0-9a-f:]+$/i;

function isValidIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (part === '' || part.length > 4) {
      return false;
    }
    const octet = Number(part);
    return /^\d+$/.test(part) && octet >= 0 && octet <= 255;
  });
}

function isValidIpv6(host: string): boolean {
  if (!IPV6_PATTERN.test(host)) {
    return false;
  }
  const halves = host.split('::');
  if (halves.length > 2) {
    return false;
  }
  const groups = halves.flatMap((half) => (half === '' ? [] : half.split(':')));
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return false;
  }
  // With `::` some groups are elided; without it all eight must be written.
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8;
}

/** True for IPv4, IPv6 or an RFC-1123 style hostname (`localhost` included). */
export function isValidHost(host: string): boolean {
  const value = host.trim();
  if (value === '' || value.length > 253) {
    return false;
  }
  if (value.includes(':') && !value.includes('://')) {
    return isValidIpv6(value);
  }
  if (value.includes('/') || /\s/.test(value)) {
    return false;
  }
  if (DOTTED_QUAD_PATTERN.test(value)) {
    // Anything that looks like an address must be a complete, valid IPv4.
    return isValidIpv4(value);
  }
  return HOST_NAME_PATTERN.test(value);
}

function isValidPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) {
    return false;
  }
  const value = Number(port);
  return value >= 1 && value <= 65535;
}

/**
 * Full validation of the form. Returns one message per broken field and an
 * empty object when the CTA may be enabled.
 */
export function validateManualSsh(input: ManualSshInput): ManualSshErrors {
  const errors: ManualSshErrors = {};

  if (input.host.trim() === '') {
    errors.host = manualSshErrorCopy.hostRequired;
  } else if (!isValidHost(input.host)) {
    errors.host = manualSshErrorCopy.hostInvalid;
  }

  if (!isValidPort(input.port)) {
    errors.port = manualSshErrorCopy.portInvalid;
  }

  if (input.user.trim() === '') {
    errors.user = manualSshErrorCopy.userRequired;
  } else if (/\s|@/.test(input.user)) {
    errors.user = manualSshErrorCopy.userInvalid;
  }

  if (input.auth === 'password') {
    if (input.password === '') {
      errors.credential = manualSshErrorCopy.passwordRequired;
    }
  } else if (input.keyPath.trim() === '') {
    errors.credential = manualSshErrorCopy.keyPathRequired;
  }

  return errors;
}

/** True when every field is valid, i.e. the primary CTA may run the connect. */
export function isManualSshValid(input: ManualSshInput): boolean {
  return Object.keys(validateManualSsh(input)).length === 0;
}
