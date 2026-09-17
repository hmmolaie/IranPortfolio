const ID_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^&\s]*&)*v=|embed\/|shorts\/|live\/)|youtube\.com\/v\/)([A-Za-z0-9_-]{11})/;

export function extractYoutubeId(text: string): string | null {
  const m = text.match(ID_RE);
  return m?.[1] ?? null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function captionsFromTimedText(xml: string): string {
  const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map((m) =>
    decodeXml(m[1].replace(/<[^>]+>/g, ' ')).trim(),
  );
  return texts.filter(Boolean).join(' ');
}

async function fetchTimedText(videoId: string, lang: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml.includes('<text')) return null;
    const t = captionsFromTimedText(xml);
    return t.length > 40 ? t : null;
  } catch {
    return null;
  }
}

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

function parseCaptionTracks(html: string): CaptionTrack[] {
  const m = html.match(/"captionTracks":(\[.*?\])/);
  if (!m?.[1]) return [];
  try {
    return JSON.parse(m[1]) as CaptionTrack[];
  } catch {
    return [];
  }
}

async function fetchWatchCaptions(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SabadyarAssistant/1.0)',
        'Accept-Language': 'fa,en;q=0.8',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const tracks = parseCaptionTracks(html);
    const preferred =
      tracks.find((t) => t.languageCode?.startsWith('fa')) ||
      tracks.find((t) => t.languageCode?.startsWith('en')) ||
      tracks[0];
    if (!preferred?.baseUrl) return null;
    const cap = await fetch(preferred.baseUrl, { signal: AbortSignal.timeout(20_000) });
    if (!cap.ok) return null;
    const xml = await cap.text();
    const t = captionsFromTimedText(xml);
    return t.length > 40 ? t : null;
  } catch {
    return null;
  }
}

type PipedAudio = { url?: string; bitrate?: number; mimeType?: string };

async function fetchPipedAudioUrl(videoId: string): Promise<string | null> {
  const bases = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de'];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { audioStreams?: PipedAudio[]; title?: string };
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

export async function downloadYoutubeAudio(videoId: string, maxBytes = 12_000_000): Promise<Buffer | null> {
  const url = await fetchPipedAudioUrl(videoId);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > maxBytes) return null;
    return buf;
  } catch {
    return null;
  }
}

export async function youtubeTranscript(videoId: string): Promise<string | null> {
  for (const lang of ['fa', 'en', 'en-US', 'ar']) {
    const t = await fetchTimedText(videoId, lang);
    if (t) return t.slice(0, 50_000);
  }
  const fromWatch = await fetchWatchCaptions(videoId);
  return fromWatch ? fromWatch.slice(0, 50_000) : null;
}
