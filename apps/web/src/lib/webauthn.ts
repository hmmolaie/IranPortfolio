import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
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
  if (!browserSupportsWebAuthn() || !isSecureWebAuthnOrigin()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
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

export async function loginWithBiometrics(email?: string): Promise<AuthSession> {
  const options = await api<PublicKeyCredentialRequestOptionsJSON>('/auth/webauthn/login/options', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ email: email?.trim() || undefined }),
  });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
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
  const options = await api<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register/options', {
    method: 'POST',
    body: '{}',
  });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
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
