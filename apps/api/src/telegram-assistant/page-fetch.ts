export type PageFetchResult = { title: string; text: string; url: string };

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/?(h[1-6]|p|div|br|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function fetchText(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SabadyarAssistant/1.0',
        Accept: 'text/plain, text/html, application/xhtml+xml',
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchWebPage(url: string): Promise<PageFetchResult> {
  const jina = await fetchText(`https://r.jina.ai/${url}`, 45_000, { Accept: 'text/plain' });
  if (jina && jina.trim().length > 80 && !/failed to|blocked/i.test(jina.slice(0, 200))) {
    const lines = jina.trim().split('\n');
    const title = (lines[0] ?? '').replace(/^#\s*/, '').slice(0, 180);
    return { title, text: jina.trim().slice(0, 40_000), url };
  }

  const raw = await fetchText(url, 30_000);
  if (!raw) throw new Error('خواندن صفحه ناموفق بود');
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ? stripHtml(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).slice(0, 180)
    : url;
  const text = stripHtml(raw).slice(0, 40_000);
  if (text.length < 40) throw new Error('متن قابل‌استفاده از صفحه به‌دست نیامد');
  return { title, text, url };
}

export function extractHttpUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>\]\)\"']+/gi) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/g, '')))];
}

export function wantsSummary(text: string): boolean {
  return /خلاصه(\s*کن)?|summarize|tldr|جمع[\s‌]*بندی|چکیده/i.test(text);
}

export function explicitLanguage(text: string): string | null {
  const m = text.match(
    /(?:به|in|به زبان)\s+(english|انگلیسی|arabic|عربی|french|فرانسه|german|آلمانی|spanish|اسپانیایی|turkish|ترکی)/i,
  );
  if (!m) return null;
  return m[1];
}
