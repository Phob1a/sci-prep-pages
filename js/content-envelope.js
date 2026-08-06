export const ENVELOPE_SCHEMA_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

const toBase64Url = bytes => {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
};

const fromBase64Url = value => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

const decodeCanonicalBase64Url = value => {
  if (!BASE64URL.test(value)) return null;
  try {
    const decoded = fromBase64Url(value);
    return toBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
};

export function validateEnvelope(envelope) {
  const errors = [];
  if (envelope?.schemaVersion !== ENVELOPE_SCHEMA_VERSION) errors.push('unsupported envelope schema');
  if (!envelope?.contentVersion) errors.push('contentVersion is required');
  if (envelope?.cipher !== 'AES-GCM-256') errors.push('cipher must be AES-GCM-256');
  if (envelope?.kdf !== 'PBKDF2-SHA-256') errors.push('kdf must be PBKDF2-SHA-256');
  if (!Number.isInteger(envelope?.iterations) || envelope.iterations < 1) errors.push('iterations are invalid');
  for (const field of ['salt', 'iv', 'ciphertext']) {
    if (typeof envelope?.[field] !== 'string' || !envelope[field]) {
      errors.push(`${field} is required`);
      continue;
    }
    const decoded = decodeCanonicalBase64Url(envelope[field]);
    if (!decoded) {
      errors.push(`${field} must use canonical base64url`);
      continue;
    }
    if (field === 'salt' && decoded.length !== 16) errors.push('salt must decode to 16 bytes');
    if (field === 'iv' && decoded.length !== 12) errors.push('iv must decode to 12 bytes');
    if (field === 'ciphertext' && decoded.length < 16) errors.push('ciphertext is too short');
  }
  return errors;
}

export async function deriveContentKey(password, salt, iterations, cryptoImpl = globalThis.crypto) {
  const material = await cryptoImpl.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return cryptoImpl.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload(payload, password, options = {}) {
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const salt = options.salt ?? cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = options.iv ?? cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveContentKey(password, salt, iterations, cryptoImpl);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    contentVersion: payload.contentVersion,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
  };
}

export async function decryptPayload(envelope, passwordOrKey, options = {}) {
  if (validateEnvelope(envelope).length) throw new Error('Invalid encrypted content');
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  try {
    const salt = fromBase64Url(envelope.salt);
    const iv = fromBase64Url(envelope.iv);
    const key = typeof passwordOrKey === 'string'
      ? await deriveContentKey(passwordOrKey, salt, envelope.iterations, cryptoImpl)
      : passwordOrKey;
    const plaintext = await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fromBase64Url(envelope.ciphertext),
    );
    const payload = JSON.parse(decoder.decode(plaintext));
    if (payload?.contentVersion !== envelope.contentVersion) throw new Error('content version mismatch');
    return { payload, key };
  } catch {
    throw new Error('Unable to decrypt content');
  }
}
