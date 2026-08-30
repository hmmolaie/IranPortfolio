'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    if (getToken()) {
      router.replace('/dashboard');
      return;
    }
    router.replace('/');
  }, [router]);

  return null;
}
