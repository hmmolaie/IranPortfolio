import { ImageResponse } from 'next/og';

export function pwaIconResponse(size: number) {
  const ring = Math.round(size * 0.72);
  const inner = Math.round(size * 0.34);
  const radius = Math.round(size * 0.22);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#08131f',
        }}
      >
        <div
          style={{
            width: ring,
            height: ring,
            borderRadius: radius,
            background: '#c48a3c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: inner,
              height: inner,
              borderRadius: '50%',
              background: '#f3eee6',
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
