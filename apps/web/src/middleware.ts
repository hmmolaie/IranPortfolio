import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** مسیرهای عمومی بدون لاگین */
const PUBLIC_PATHS = new Set(['/', '/login', '/register', '/login2']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/pwa-icon') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const hasAuthCookie = request.cookies.get('sabadyar_auth')?.value === '1';
  const publicPage = isPublicPath(pathname);

  if (!publicPage && !hasAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    if (pathname !== '/') {
      url.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(url);
  }

  if (publicPage && hasAuthCookie && (pathname === '/' || pathname === '/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
