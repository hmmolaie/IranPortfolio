export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** پرچم حضور جلسه برای middleware (JWT در localStorage می‌ماند) */
export const AUTH_COOKIE = 'sabadyar_auth';

function writeAuthCookie(present: boolean) {
  if (typeof document === 'undefined') return;
  if (present) {
    document.cookie = `${AUTH_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
  } else {
    document.cookie = `${AUTH_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('sabadyar_token');
  // همگام‌سازی کوکی برای کاربرانی که قبل از این تغییر لاگین بوده‌اند
  if (token && !document.cookie.includes(`${AUTH_COOKIE}=1`)) {
    writeAuthCookie(true);
  }
  return token;
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('sabadyar_token', token);
    writeAuthCookie(true);
  } else {
    localStorage.removeItem('sabadyar_token');
    writeAuthCookie(false);
  }
}

export type UserRole = 'ADMIN' | 'USER';

export function setUserRole(role: UserRole | null) {
  if (typeof window === 'undefined') return;
  if (role) localStorage.setItem('sabadyar_role', role);
  else localStorage.removeItem('sabadyar_role');
}

export function getUserRole(): UserRole | null {
  if (typeof window === 'undefined') return null;
  const r = localStorage.getItem('sabadyar_role');
  return r === 'ADMIN' || r === 'USER' ? r : null;
}

export function clearSession() {
  setToken(null);
  setUserRole(null);
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
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (!res.ok) {
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
