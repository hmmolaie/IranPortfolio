const ID_RE =
  /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtube\.com\/v\/)([A-Za-z0-9_-]{11})/i;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.artemislena.eu',
  'https://invidious.projectsegfau.lt',
];

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.me',
  'https://api.piped.private.coffee',
];

type CaptionTrack = { baseUrl: string; languageCode: string; kind?: string };

type YtClient = { name: string; version: string; ua: string; clientId: string };

const CLIENTS: YtClient[] = [
  {
    name: 'ANDROID',
    version: '19.47.37',
    ua: 'com.google.android.youtube/19.47.37 (Linux; U; Android 14) gzip',
    clientId: '3',
  },
  {
    name: 'IOS',
    version: '19.45.4',
    ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_7 like Mac OS X)',
    clientId: '5',
  },
  {
    name: 'WEB',
    version: '2.20250313.00.00',
    ua: BROWSER_UA,
    clientId: '1',
  },
];

export function extractYoutubeId(text: string): string | null {
  const cleaned = text.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
  const m = cleaned.match(ID_RE);
  return m?.[1] ?? null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractJsonObject(source: string, marker: string): Record<string, unknown> | null {
  const i = source.indexOf(marker);
  if (i < 0) return null;
  const start = source.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let p = start; p < source.length; p++) {
    const c = source[p];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, p + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function captionsFromXml(xml: string): string {
  const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map((m) =>
    decodeXml(m[1].replace(/<[^>]+>/g, ' ')).trim(),
  );
  return texts.filter(Boolean).join(' ');
}

function captionsFromJson3(raw: string): string {
  try {
    const j = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    const parts: string[] = [];
    for (const ev of j.events ?? []) {
      for (const seg of ev.segs ?? []) {
        if (seg.utf8 && seg.utf8 !== '\n') parts.push(seg.utf8);
      }
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function captionsFromVtt(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('WEBVTT') || t.startsWith('NOTE') || t.includes('-->') || /^\d+$/.test(t)) {
      continue;
    }
    out.push(t.replace(/<[^>]+>/g, ' '));
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function parseCaptionPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) return captionsFromJson3(trimmed);
  if (/WEBVTT/i.test(trimmed.slice(0, 80)) || trimmed.includes('-->')) return captionsFromVtt(trimmed);
  return captionsFromXml(trimmed);
}

async function fetchRaw(url: string, timeoutMs: number, extra?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
        ...extra,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function captionTracksFromPlayer(player: Record<string, unknown>): CaptionTrack[] {
  const captions = player.captions as Record<string, unknown> | undefined;
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
  const tracks = renderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  const out: CaptionTrack[] = [];
  for (const t of tracks) {
    if (!t || typeof t !== 'object') continue;
    const rec = t as Record<string, unknown>;
    const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.replace(/\\u0026/g, '&') : '';
    if (!baseUrl) continue;
    out.push({
      baseUrl,
      languageCode: String(rec.languageCode ?? ''),
      kind: typeof rec.kind === 'string' ? rec.kind : undefined,
    });
  }
  return out;
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.languageCode.startsWith('fa')) ||
    tracks.find((t) => t.languageCode.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode.startsWith('en')) ||
    tracks.find((t) => t.kind === 'asr') ||
    tracks[0]
  );
}

function withFmt(baseUrl: string, fmt: string): string {
  const stripped = baseUrl.replace(/[?&]fmt=[^&]*/g, '');
  return `${stripped}${stripped.includes('?') ? '&' : '?'}fmt=${fmt}`;
}

async function fetchCaptionText(baseUrl: string): Promise<string | null> {
  const urls = [withFmt(baseUrl, 'json3'), withFmt(baseUrl, 'srv3'), withFmt(baseUrl, 'vtt'), baseUrl];
  for (const url of urls) {
    const raw = await fetchRaw(url, 25_000);
    if (!raw) continue;
    const text = parseCaptionPayload(raw);
    if (text.length > 40) return text.slice(0, 50_000);
  }
  return null;
}

async function innertubePlayer(videoId: string, client: YtClient): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': client.ua,
        'X-YouTube-Client-Name': client.clientId,
        'X-YouTube-Client-Version': client.version,
      },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function audioUrlFromPlayer(player: Record<string, unknown>): string | null {
  const sd = player.streamingData as Record<string, unknown> | undefined;
  const formats = [
    ...(Array.isArray(sd?.adaptiveFormats) ? (sd.adaptiveFormats as unknown[]) : []),
    ...(Array.isArray(sd?.formats) ? (sd.formats as unknown[]) : []),
  ];
  const audios: { url: string; bitrate: number; mime: string }[] = [];
  for (const f of formats) {
    if (!f || typeof f !== 'object') continue;
    const rec = f as Record<string, unknown>;
    const mime = String(rec.mimeType ?? rec.type ?? '');
    if (!/audio/i.test(mime)) continue;
    const url = typeof rec.url === 'string' ? rec.url : '';
    if (!url) continue;
    audios.push({ url, bitrate: Number(rec.bitrate) || 0, mime });
  }
  if (!audios.length) return null;
  audios.sort((a, b) => a.bitrate - b.bitrate);
  return audios.find((a) => /mp4|m4a|mpeg/i.test(a.mime))?.url ?? audios[0].url;
}

async function transcriptViaInnertube(videoId: string): Promise<string | null> {
  for (const client of CLIENTS) {
    const player = await innertubePlayer(videoId, client);
    if (!player) continue;
    const track = pickTrack(captionTracksFromPlayer(player));
    if (!track) continue;
    const text = await fetchCaptionText(track.baseUrl);
    if (text) return text;
    if (track.kind === 'asr' || track.languageCode.startsWith('en')) {
      const fa = await fetchCaptionText(`${track.baseUrl}${track.baseUrl.includes('?') ? '&' : '?'}tlang=fa`);
      if (fa) return fa;
    }
  }
  return null;
}

async function transcriptViaWatchPage(videoId: string): Promise<string | null> {
  const html = await fetchRaw(`https://www.youtube.com/watch?v=${videoId}`, 25_000, {
    'Accept-Language': 'en-US,en;q=0.9,fa;q=0.8',
  });
  if (!html) return null;
  const player =
    extractJsonObject(html, 'ytInitialPlayerResponse') ?? extractJsonObject(html, 'var ytInitialPlayerResponse');
  if (!player) return null;
  const track = pickTrack(captionTracksFromPlayer(player));
  if (!track) return null;
  return fetchCaptionText(track.baseUrl);
}

async function transcriptViaTimedText(videoId: string): Promise<string | null> {
  const langs = ['fa', 'en', 'en-US', 'en-GB', 'ar'];
  const extras = ['', '&kind=asr'];
  const fmts = ['json3', 'srv3', 'vtt'];
  for (const lang of langs) {
    for (const extra of extras) {
      for (const fmt of fmts) {
        const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}${extra}&fmt=${fmt}`;
        const raw = await fetchRaw(url, 15_000);
        if (!raw) continue;
        const text = parseCaptionPayload(raw);
        if (text.length > 40) return text.slice(0, 50_000);
      }
    }
  }
  return null;
}

async function transcriptViaInvidious(videoId: string): Promise<string | null> {
  for (const base of INVIDIOUS) {
    try {
      const metaRes = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!metaRes.ok) continue;
      const meta = (await metaRes.json()) as {
        captions?: Array<{ url?: string; languageCode?: string; label?: string }>;
      };
      const caps = meta.captions ?? [];
      const preferred =
        caps.find((c) => (c.languageCode ?? '').startsWith('fa')) ||
        caps.find((c) => (c.languageCode ?? '').startsWith('en')) ||
        caps[0];
      const capUrl = preferred?.url
        ? preferred.url.startsWith('http')
          ? preferred.url
          : `${base}${preferred.url}`
        : `${base}/api/v1/captions/${videoId}?lang=${encodeURIComponent(preferred?.languageCode || 'en')}`;
      const raw = await fetchRaw(capUrl, 20_000);
      if (!raw) continue;
      const text = parseCaptionPayload(raw);
      if (text.length > 40) return text.slice(0, 50_000);
    } catch {
      /* next instance */
    }
  }
  return null;
}

export async function youtubeTranscript(videoId: string): Promise<string | null> {
  return (
    (await transcriptViaInnertube(videoId)) ||
    (await transcriptViaWatchPage(videoId)) ||
    (await transcriptViaTimedText(videoId)) ||
    (await transcriptViaInvidious(videoId))
  );
}

async function fetchBufferCapped(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: '*/*' },
      signal: AbortSignal.timeout(120_000),
      redirect: 'follow',
    });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) return null;
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    if (total < 1000) return null;
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function audioViaInnertube(videoId: string): Promise<string | null> {
  for (const client of CLIENTS) {
    const player = await innertubePlayer(videoId, client);
    if (!player) continue;
    const url = audioUrlFromPlayer(player);
    if (url) return url;
  }
  return null;
}

async function audioViaInvidious(videoId: string): Promise<string | null> {
  for (const base of INVIDIOUS) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        adaptiveFormats?: Array<{ url?: string; type?: string; encoding?: string; bitrate?: string | number }>;
      };
      const audios = (json.adaptiveFormats ?? [])
        .filter((f) => f.url && /audio/i.test(f.type ?? ''))
        .sort((a, b) => Number(a.bitrate ?? 0) - Number(b.bitrate ?? 0));
      const pick =
        audios.find((a) => /mp4|m4a|mpeg/i.test(`${a.type ?? ''} ${a.encoding ?? ''}`)) ?? audios[0];
      if (pick?.url) return pick.url;
    } catch {
      /* next */
    }
  }
  return null;
}

async function audioViaPiped(videoId: string): Promise<string | null> {
  for (const base of PIPED) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        audioStreams?: Array<{ url?: string; bitrate?: number; mimeType?: string }>;
      };
      const audios = (json.audioStreams ?? [])
        .filter((a) => a.url)
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
      const pick = audios.find((a) => /mp4|m4a|mpeg/i.test(a.mimeType ?? '')) ?? audios[0];
      if (pick?.url) return pick.url;
    } catch {
      /* next */
    }
  }
  return null;
}

export async function downloadYoutubeAudio(videoId: string, maxBytes = 20_000_000): Promise<Buffer | null> {
  const url =
    (await audioViaInnertube(videoId)) || (await audioViaInvidious(videoId)) || (await audioViaPiped(videoId));
  if (!url) return null;
  return fetchBufferCapped(url, maxBytes);
}

export function youtubeAudioFilename(buf: Buffer, videoId: string): string {
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return `${videoId}.webm`;
  }
  return `${videoId}.m4a`;
}
