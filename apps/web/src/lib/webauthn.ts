import { api } from '@/lib/api';

export const HAS_PASSKEY_KEY = 'sabadyar_has_passkey';
const SKIP_PROMPT_KEY = 'sabadyar_webauthn_skip';

export type AuthSession = {
  accessToken: string;
  user: { id?: string; email?: string; role: 'ADMIN' | 'USER' };
};

export type WebAuthnCredentialRow = {
  id: string;
  friendlyName?: string | null;
  deviceType?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};

type CreationOptionsJSON = {
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Array<{ id: string; type?: string; transports?: string[] }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
  extensions?: AuthenticationExtensionsClientInputs;
};

type RequestOptionsJSON = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: Array<{ id: string; type?: string; transports?: string[] }>;
  userVerification?: UserVerificationRequirement;
  extensions?: AuthenticationExtensionsClientInputs;
};

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
  if (/iPad|Tablet/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

export function isSecureWebAuthnOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (window.location.protocol !== 'https:') return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

export async function canUsePlatformBiometrics(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  if (!isSecureWebAuthnOrigin()) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
      return true;
    }
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasLocalPasskeyFlag(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(HAS_PASSKEY_KEY) === '1';
}

export function markLocalPasskey(on: boolean) {
  if (typeof localStorage === 'undefined') return;
  if (on) localStorage.setItem(HAS_PASSKEY_KEY, '1');
  else localStorage.removeItem(HAS_PASSKEY_KEY);
}

export function shouldSkipPasskeyPrompt(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SKIP_PROMPT_KEY) === '1';
}

export function skipPasskeyPrompt() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SKIP_PROMPT_KEY, '1');
}

export function defaultDeviceName(): string {
  if (typeof navigator === 'undefined') return 'این دستگاه';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'آیفون یا آیپد';
  if (/Android/i.test(ua)) return 'گوشی اندروید';
  return 'این دستگاه';
}

function b64urlToBuf(value: string): ArrayBuffer {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function humanizeWebAuthnError(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
  const message = err instanceof Error ? err.message : '';
  if (name === 'NotAllowedError' || /not allowed|cancel|abort/i.test(message)) {
    return 'ورود زیست‌سنجی لغو شد.';
  }
  if (name === 'InvalidStateError') {
    return 'این دستگاه قبلاً ثبت شده است.';
  }
  if (name === 'NotSupportedError') {
    return 'این مرورگر ورود با اثر انگشت یا چهره را پشتیبانی نمی‌کند.';
  }
  if (message) return message;
  return 'ورود با اثر انگشت یا چهره ناموفق بود.';
}

async function startRegistration(options: CreationOptionsJSON) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: options.rp,
      user: {
        id: b64urlToBuf(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      challenge: b64urlToBuf(options.challenge),
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
      extensions: options.extensions,
      excludeCredentials: options.excludeCredentials?.map((c) => ({
        type: 'public-key' as const,
        id: b64urlToBuf(c.id),
        transports: c.transports as AuthenticatorTransport[] | undefined,
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('پاسخ زیست‌سنجی خالی بود.');
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: 'public-key' as const,
    authenticatorAttachment: (cred as PublicKeyCredential & { authenticatorAttachment?: string | null })
      .authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64url(att.clientDataJSON),
      attestationObject: bufToB64url(att.attestationObject),
      transports: typeof att.getTransports === 'function' ? att.getTransports() : [],
    },
  };
}

async function startAuthentication(options: RequestOptionsJSON) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuf(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      userVerification: options.userVerification,
      extensions: options.extensions,
      allowCredentials: options.allowCredentials?.map((c) => ({
        type: 'public-key' as const,
        id: b64urlToBuf(c.id),
        transports: c.transports as AuthenticatorTransport[] | undefined,
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('پاسخ زیست‌سنجی خالی بود.');
  const assn = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: 'public-key' as const,
    authenticatorAttachment: (cred as PublicKeyCredential & { authenticatorAttachment?: string | null })
      .authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64url(assn.clientDataJSON),
      authenticatorData: bufToB64url(assn.authenticatorData),
      signature: bufToB64url(assn.signature),
      userHandle: assn.userHandle ? bufToB64url(assn.userHandle) : null,
    },
  };
}

export async function loginWithBiometrics(email?: string): Promise<AuthSession> {
  const options = await api<RequestOptionsJSON>('/auth/webauthn/login/options', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ email: email?.trim() || undefined }),
  });
  let response;
  try {
    response = await startAuthentication(options);
  } catch (err) {
    throw new Error(humanizeWebAuthnError(err));
  }
  const session = await api<AuthSession>('/auth/webauthn/login/verify', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ response }),
  });
  markLocalPasskey(true);
  return session;
}

export async function registerDevicePasskey(nickname?: string) {
  const options = await api<CreationOptionsJSON>('/auth/webauthn/register/options', {
    method: 'POST',
    body: '{}',
  });
  let response;
  try {
    response = await startRegistration(options);
  } catch (err) {
    throw new Error(humanizeWebAuthnError(err));
  }
  const out = await api<{ ok: boolean }>('/auth/webauthn/register/verify', {
    method: 'POST',
    body: JSON.stringify({
      response,
      nickname: (nickname ?? defaultDeviceName()).trim(),
    }),
  });
  markLocalPasskey(true);
  return out;
}
