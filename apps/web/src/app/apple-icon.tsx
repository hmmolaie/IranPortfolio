import { pwaIconResponse } from '@/lib/pwa-icon';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return pwaIconResponse(180);
}
