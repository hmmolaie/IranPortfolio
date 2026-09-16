function resolveApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw === undefined) {
    return process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001';
  }
  let origin = raw.trim().replace(/\/+$/, '');
  if (!origin || origin === '/') return '';
  origin = origin.replace(/\/api$/i, '');
  return origin;
}

/** پایهٔ API از دید مرورگر. روی سرور: https://sabad-yar.ir تا درخواست‌ها به /api بروند */
export const API_URL = resolveApiOrigin();

/** پرچم حضور جلسه برای middleware (JWT در localStorage می‌ماند) */
export const AUTH_COOKIE = 'sabadyar_auth';
const TOKEN_KEY = 'sabadyar_token';
const ROLE_KEY = 'sabadyar_role';
const LAST_ACTIVITY_KEY = 'sabadyar_last_activity';

/** اگر کاربر ۱۵ دقیقه کاری نکند، جلسه تمام می‌شود */
export const SESSION_IDLE_MS = 15 * 60 * 1000;
const COOKIE_MAX_AGE_SEC = 15 * 60;
const ACTIVITY_TOUCH_THROTTLE_MS = 1000;
const TOKEN_REFRESH_EVERY_MS = 60 * 1000;

let lastTouchAt = 0;
let lastRefreshAt = 0;
let refreshInFlight: Promise<void> | null = null;

function writeAuthCookie(present: boolean) {
  if (typeof document === 'undefined') return;
  if (present) {
    document.cookie = `${AUTH_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`;
  } else {
    document.cookie = `${AUTH_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
  }
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function jwtExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    if (typeof json.exp !== 'number') return true;
    return json.exp * 1000 <= Date.now() + 1000;
  } catch {
    return true;
  }
}

function idleExpired(): boolean {
  if (typeof window === 'undefined') return true;
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? '');
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last > SESSION_IDLE_MS;
}

export function sessionTimedOut(): boolean {
  const token = readStoredToken();
  if (!token) return true;
  return idleExpired() || jwtExpired(token);
}

export function touchSession() {
  if (typeof window === 'undefined') return;
  if (!readStoredToken()) return;
  const now = Date.now();
  if (now - lastTouchAt < ACTIVITY_TOUCH_THROTTLE_MS) return;
  lastTouchAt = now;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  writeAuthCookie(true);
}

export async function refreshSessionIfNeeded() {
  if (typeof window === 'undefined') return;
  const token = getToken();
  if (!token) return;
  const now = Date.now();
  if (now - lastRefreshAt < TOKEN_REFRESH_EVERY_MS) return;
  if (refreshInFlight) return refreshInFlight;
  lastRefreshAt = now;
  refreshInFlight = api<{ accessToken: string }>('/auth/refresh', { method: 'POST' })
    .then((res) => {
      if (res?.accessToken) setToken(res.accessToken);
    })
    .catch(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = readStoredToken();
  if (!token) return null;
  if (idleExpired() || jwtExpired(token)) {
    clearSession();
    return null;
  }
  return token;
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    lastTouchAt = Date.now();
    lastRefreshAt = Date.now();
    writeAuthCookie(true);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    lastTouchAt = 0;
    lastRefreshAt = 0;
    writeAuthCookie(false);
  }
}

export type UserRole = 'ADMIN' | 'USER';

export function setUserRole(role: UserRole | null) {
  if (typeof window === 'undefined') return;
  if (role) localStorage.setItem(ROLE_KEY, role);
  else localStorage.removeItem(ROLE_KEY);
}

export function getUserRole(): UserRole | null {
  if (typeof window === 'undefined') return null;
  const r = localStorage.getItem(ROLE_KEY);
  return r === 'ADMIN' || r === 'USER' ? r : null;
}

export function clearSession() {
  setToken(null);
  setUserRole(null);
}

function expireAndRedirect() {
  clearSession();
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path === '/' || path === '/login' || path === '/register') return;
  window.location.assign('/');
}

export async function api<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.auth !== false) {
    const token = getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
      touchSession();
    }
  }
  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401 && options.auth !== false && path !== '/auth/login') {
      expireAndRedirect();
    }
    let message = 'خطای سرور';
    try {
      const j = await res.json();
      if (Array.isArray(j.message)) message = j.message.join('، ');
      else if (typeof j.message === 'string') message = j.message;
      else if (typeof j.error === 'string') message = j.error;
    } catch {
      message = await res.text();
    }
    throw new Error(typeof message === 'string' && message ? message : 'خطای سرور');
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function formatRial(n: number) {
  return new Intl.NumberFormat('fa-IR').format(Math.round(n)) + ' ریال';
}

export function formatNum(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(n);
}
