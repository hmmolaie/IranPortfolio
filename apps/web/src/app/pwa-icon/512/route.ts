import { pwaIconResponse } from '@/lib/pwa-icon';

export function GET() {
  return pwaIconResponse(512);
}
