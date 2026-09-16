export type XPostSnippet = {
  accountFa: string;
  textFa: string;
  url?: string;
  published?: string;
};

const SEARCH_QUERIES = [
  'اقتصاد ایران',
  'بورس تهران',
  'بانک مرکزی',
  'حراج سکه',
  'عرضه اولیه',
  'تورم ایران',
];

const ACCOUNTS = [
  'eghtesadonline',
  'donya_e_eqtesad',
  'Tasnimnews_Fa',
  'farsnews_ir',
  'eghtesadnews',
  'boursenews_ir',
  'TejaratNews',
  'isna_fa',
  'IRNA_Economic',
];

const RSSHUB_BASES = ['https://rsshub.app', 'https://rsshub.rssforever.com'];
const NITTER_BASES = ['https://nitter.poast.org', 'https://nitter.privacydev.net'];

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m?.[1] ? decodeEntities(m[1]) : '';
}

function parseRss(xml: string): XPostSnippet[] {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((m) => m[0]);
  const out: XPostSnippet[] = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    const desc = tagText(block, 'description') || tagText(block, 'content') || tagText(block, 'summary');
    const textFa = (desc || title).slice(0, 420);
    if (textFa.length < 12) continue;
    const url = tagText(block, 'link') || block.match(/<link[^>]+href="([^"]+)"/i)?.[1] || '';
    const creator =
      tagText(block, 'dc:creator') ||
      tagText(block, 'author') ||
      tagText(block, 'name') ||
      (url.match(/(?:x\.com|twitter\.com|nitter\.[^/]+)\/([A-Za-z0-9_]+)/i)?.[1] ?? '');
    out.push({
      accountFa: creator ? `@${creator.replace(/^@/, '')}` : 'X',
      textFa,
      url: url || undefined,
      published: tagText(block, 'pubDate') || tagText(block, 'updated') || tagText(block, 'published') || undefined,
    });
  }
  return out;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8',
        'User-Agent': 'SabadyarNewsBot/1.0',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function uniquePosts(posts: XPostSnippet[], limit: number): XPostSnippet[] {
  const seen = new Set<string>();
  const out: XPostSnippet[] = [];
  for (const p of posts) {
    const key = p.textFa.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchIranEconomyXFeed(limit = 36): Promise<{
  posts: XPostSnippet[];
  sourceNoteFa: string;
}> {
  const urls: string[] = [];
  for (const q of SEARCH_QUERIES) {
    const enc = encodeURIComponent(q);
    for (const base of RSSHUB_BASES) {
      urls.push(`${base}/twitter/keyword/${enc}`);
      urls.push(`${base}/twitter/search/${enc}`);
    }
    for (const base of NITTER_BASES) {
      urls.push(`${base}/search/rss?f=tweets&q=${enc}`);
    }
  }
  for (const acc of ACCOUNTS) {
    for (const base of RSSHUB_BASES) {
      urls.push(`${base}/twitter/user/${acc}`);
    }
    for (const base of NITTER_BASES) {
      urls.push(`${base}/${acc}/rss`);
    }
  }

  const collected: XPostSnippet[] = [];
  const used: string[] = [];
  const batchSize = 6;
  for (let i = 0; i < urls.length && collected.length < limit * 3; i += batchSize) {
    const chunk = urls.slice(i, i + batchSize);
    const results = await Promise.allSettled(chunk.map((u) => fetchText(u, 12_000)));
    results.forEach((r, idx) => {
      if (r.status !== 'fulfilled' || !r.value) return;
      const parsed = parseRss(r.value);
      if (!parsed.length) return;
      used.push(chunk[idx].replace(/^https:\/\//, '').split('/')[0]);
      collected.push(...parsed);
    });
    if (collected.length >= limit) break;
  }

  const posts = uniquePosts(collected, limit);
  const hosts = [...new Set(used)].slice(0, 6);
  return {
    posts,
    sourceNoteFa: posts.length
      ? `فید زندهٔ X (${posts.length} پست) از ${hosts.join('، ') || 'جستجوی چندزبانه'}`
      : 'فید عمومی X در این لحظه خالی بود؛ بدون قیمت دیتابیس',
  };
}
