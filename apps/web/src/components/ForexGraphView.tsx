'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type ForexNode = { code: string; nameFa: string; kind: 'FIAT' | 'CRYPTO' | 'METAL' | string };
export type ForexEdge = {
  from: string;
  to: string;
  rate: number;
  pairSymbol: string;
  inverted: boolean;
};
export type ForexHop = { from: string; to: string };

type Pos = { x: number; y: number; vx: number; vy: number };

const KIND_FILL: Record<string, string> = {
  FIAT: '#7dd3fc',
  CRYPTO: '#d8b4fe',
  METAL: '#fbbf24',
};

const W = 960;
const H = 560;

function hopKey(a: string, b: string) {
  return `${a}>${b}`;
}

function formatRate(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 5 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function ForexGraphView({
  nodes,
  edges,
  longHops = [],
  shortHops = [],
}: {
  nodes: ForexNode[];
  edges: ForexEdge[];
  longHops?: ForexHop[];
  shortHops?: ForexHop[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, Pos>>({});
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const visualEdges = useMemo(() => edges.filter((e) => !e.inverted), [edges]);
  const longSet = useMemo(() => new Set(longHops.map((h) => hopKey(h.from, h.to))), [longHops]);
  const shortSet = useMemo(() => new Set(shortHops.map((h) => hopKey(h.from, h.to))), [shortHops]);
  const activeNodes = useMemo(() => {
    const s = new Set<string>();
    for (const h of [...longHops, ...shortHops]) {
      s.add(h.from);
      s.add(h.to);
    }
    return s;
  }, [longHops, shortHops]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      setView((v) => ({ ...v, k: Math.min(2.4, Math.max(0.45, v.k * delta)) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const nodeKey = nodes.map((n) => n.code).join(',');
    if (!nodeKey) {
      setPos({});
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.36;
    const next: Record<string, Pos> = {};
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      next[n.code] = {
        x: n.code === 'USD' ? cx : cx + Math.cos(a) * r,
        y: n.code === 'USD' ? cy : cy + Math.sin(a) * r,
        vx: 0,
        vy: 0,
      };
    });
    setPos(next);
  }, [nodes]);

  const layoutReady = nodes.length >= 2 && Object.keys(pos).length >= 2;

  useEffect(() => {
    if (!layoutReady) return;
    let frame = 0;
    let alive = true;
    const codes = nodes.map((n) => n.code);

    const tick = () => {
      if (!alive) return;
      frame += 1;
      if (frame > 420) return;
      const cur: Record<string, Pos> = {};
      for (const [key, val] of Object.entries(posRef.current)) {
        cur[key] = { ...val };
      }
      const kSpring = 0.012;
      const rest = 168;
      const repulse = 2200;

      for (const a of codes) {
        if (!cur[a] || a === dragNode) continue;
        for (const b of codes) {
          if (a >= b || !cur[b]) continue;
          const dx = cur[b].x - cur[a].x;
          const dy = cur[b].y - cur[a].y;
          const dist = Math.max(Math.hypot(dx, dy), 12);
          const force = repulse / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          cur[a].vx -= fx;
          cur[a].vy -= fy;
          if (b !== dragNode) {
            cur[b].vx += fx;
            cur[b].vy += fy;
          }
        }
      }

      for (const e of visualEdges) {
        const a = cur[e.from];
        const b = cur[e.to];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.hypot(dx, dy), 8);
        const pull = (dist - rest) * kSpring;
        const fx = (dx / dist) * pull;
        const fy = (dy / dist) * pull;
        if (e.from !== dragNode) {
          a.vx += fx;
          a.vy += fy;
        }
        if (e.to !== dragNode) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      for (const code of codes) {
        const p = cur[code];
        if (!p || code === dragNode) continue;
        p.vx += (W / 2 - p.x) * 0.002;
        p.vy += (H / 2 - p.y) * 0.002;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        p.x = Math.min(W - 36, Math.max(36, p.x));
        p.y = Math.min(H - 36, Math.max(36, p.y));
      }

      posRef.current = cur;
      setPos(cur);
      requestAnimationFrame(tick);
    };

    const id = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [layoutReady, nodes, visualEdges, dragNode]);

  function clientToSvg(ev: { clientX: number; clientY: number }) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = ((ev.clientX - rect.left) / rect.width) * W;
    const sy = ((ev.clientY - rect.top) / rect.height) * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#07111d] shadow-[inset_0_0_80px_rgba(0,0,0,0.35)]"
      style={{ height: 560 }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-node]')) return;
        wrapRef.current?.setPointerCapture(e.pointerId);
        panRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      }}
      onPointerMove={(e) => {
        if (dragNode) {
          const p = clientToSvg(e);
          setPos((prev) => {
            const cur = prev[dragNode];
            if (!cur) return prev;
            const next = { ...prev, [dragNode]: { ...cur, x: p.x, y: p.y, vx: 0, vy: 0 } };
            posRef.current = next;
            return next;
          });
          return;
        }
        if (!panRef.current) return;
        const dx = e.clientX - panRef.current.px;
        const dy = e.clientY - panRef.current.py;
        setView((v) => ({ ...v, x: panRef.current!.vx + dx, y: panRef.current!.vy + dy }));
      }}
      onPointerUp={() => {
        panRef.current = null;
        setDragNode(null);
      }}
      onPointerLeave={() => {
        panRef.current = null;
        setDragNode(null);
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(168,137,62,0.12),transparent_55%)]" />
      <svg viewBox={`0 0 ${W} ${H}`} className="relative h-full w-full touch-none" role="img">
        <defs>
          <marker id="fx-long" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#34d399" />
          </marker>
          <marker id="fx-short" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#fb7185" />
          </marker>
          <filter id="fx-glow">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {visualEdges.map((e) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            const dim = activeNodes.size > 0;
            const onLong = longSet.has(hopKey(e.from, e.to)) || longSet.has(hopKey(e.to, e.from));
            const onShort = shortSet.has(hopKey(e.from, e.to)) || shortSet.has(hopKey(e.to, e.from));
            const hot = hover === e.from || hover === e.to;
            return (
              <g key={e.pairSymbol}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={onLong ? '#34d399' : onShort ? '#fb7185' : hot ? '#c4a35a' : '#64748b'}
                  strokeWidth={onLong || onShort ? 2.6 : hot ? 1.8 : 1}
                  strokeOpacity={dim && !onLong && !onShort && !hot ? 0.12 : 0.55}
                />
              </g>
            );
          })}

          {[...longHops, ...shortHops].map((h) => {
            const a = pos[h.from];
            const b = pos[h.to];
            if (!a || !b) return null;
            const isLong = longSet.has(hopKey(h.from, h.to));
            const mx = a.x + (b.x - a.x) * 0.62;
            const my = a.y + (b.y - a.y) * 0.62;
            return (
              <line
                key={`dir-${h.from}-${h.to}`}
                x1={a.x}
                y1={a.y}
                x2={mx}
                y2={my}
                stroke={isLong ? '#34d399' : '#fb7185'}
                strokeWidth={2.2}
                markerEnd={isLong ? 'url(#fx-long)' : 'url(#fx-short)'}
                strokeOpacity={0.95}
              />
            );
          })}

          {visualEdges.map((e) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            const hot = hover === e.from || hover === e.to;
            const marked =
              longSet.has(hopKey(e.from, e.to)) ||
              longSet.has(hopKey(e.to, e.from)) ||
              shortSet.has(hopKey(e.from, e.to)) ||
              shortSet.has(hopKey(e.to, e.from));
            if (!hot && !marked) return null;
            return (
              <text
                key={`lbl-${e.pairSymbol}`}
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 8}
                textAnchor="middle"
                className="pointer-events-none"
                fill="#f8fafc"
                fontSize={11}
              >
                {e.pairSymbol} {formatRate(e.rate)}
              </text>
            );
          })}

          {nodes.map((n) => {
            const p = pos[n.code];
            if (!p) return null;
            const fill = KIND_FILL[n.kind] ?? '#94a3b8';
            const dim = activeNodes.size > 0 && !activeNodes.has(n.code);
            const focused = hover === n.code || activeNodes.has(n.code);
            return (
              <g
                key={n.code}
                data-node={n.code}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-grab"
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  wrapRef.current?.setPointerCapture(ev.pointerId);
                  setDragNode(n.code);
                  setHover(n.code);
                }}
                onPointerEnter={() => setHover(n.code)}
                onPointerLeave={() => setHover((h) => (h === n.code ? null : h))}
                opacity={dim ? 0.28 : 1}
                filter={focused ? 'url(#fx-glow)' : undefined}
              >
                <circle r={n.code === 'USD' ? 24 : 20} fill={fill} fillOpacity={0.92} />
                <circle
                  r={n.code === 'USD' ? 24 : 20}
                  fill="none"
                  stroke={focused ? '#fff' : 'rgba(7,17,29,0.55)'}
                  strokeWidth={focused ? 2 : 1}
                />
                <text
                  textAnchor="middle"
                  y={4}
                  fill="#0b1f3a"
                  fontSize={11}
                  fontWeight={700}
                  className="pointer-events-none"
                >
                  {n.code}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {hover && (
        <div className="pointer-events-none absolute bottom-3 start-3 rounded-lg bg-black/55 px-3 py-2 text-xs text-white backdrop-blur">
          <div className="font-semibold">{hover}</div>
          <div className="text-white/70">{nodes.find((n) => n.code === hover)?.nameFa}</div>
        </div>
      )}
      <div className="pointer-events-none absolute end-3 top-3 flex flex-col gap-1 text-[11px] text-white/75">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-sky-300" /> فیات
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-purple-300" /> رمزارز
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> فلز
        </span>
        <span className="mt-1 text-white/45">کشیدن رأس · اسکرول برای بزرگ‌نمایی</span>
      </div>
    </div>
  );
}
