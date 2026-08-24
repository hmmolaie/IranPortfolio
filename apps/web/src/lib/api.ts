export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sabadyar_token');
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem('sabadyar_token', token);
  else localStorage.removeItem('sabadyar_token');
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
      message = j.message ?? (Array.isArray(j.message) ? j.message.join('، ') : message);
    } catch {
      message = await res.text();
    }
    throw new Error(typeof message === 'string' ? message : 'خطای سرور');
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
