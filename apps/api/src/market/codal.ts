/** خواندن فهرست اطلاعیه‌های کدال و متن صفحهٔ هر اطلاعیه. بدون دیتابیس و بدون مدل. */

export const CODAL_SITE = 'https://www.codal.ir';
/** صفحهٔ ReportList.aspx فهرست را با جاوااسکریپت از همین نشانی می‌گیرد */
const CODAL_SEARCH = 'https://search.codal.ir/api/search/v2/q';

export const CODAL_MAX_NOTICES = 10;
const BODY_MAX_CHARS = 6000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export type CodalLetter = {
  tracingNo: number;
  titleFa: string;
  letterCode: string | null;
  publishedAtFa: string;
  /** نشانی کامل صفحهٔ اطلاعیه یا پیوست روی codal.ir */
  url: string;
  hasHtml: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** ی و ک عربی، نیم‌فاصله و فاصله را یکی می‌کند تا نماد کدال با نماد دیتابیس مقایسه شود */
export function normalizeCodalSymbol(raw: string): string {
  return raw
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎\s]/g, '')
    .trim();
}

/** نشانی نسبی کدال را کامل می‌کند؛ هر چیزی بیرون از codal.ir رد می‌شود */
function codalUrl(path: string): string | null {
  try {
    const url = new URL(path, `${CODAL_SITE}/`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/(^|\.)codal\.ir$/i.test(url.hostname)) return null;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

export function codalReportListUrl(symbol: string): string {
  return `${CODAL_SITE}/ReportList.aspx?search&Symbol=${encodeURIComponent(symbol)}`;
}

/** آخرین اطلاعیه‌های یک نماد، از جدید به قدیم */
export async function fetchCodalLetters(symbol: string): Promise<CodalLetter[]> {
  const url = new URL(CODAL_SEARCH);
  const params: Record<string, string> = {
    Audited: 'true',
    AuditorRef: '-1',
    Category: '-1',
    Childs: 'true',
    CompanyState: '-1',
    CompanyType: '-1',
    Consolidatable: 'true',
    IsNotAudited: 'false',
    Length: '-1',
    LetterType: '-1',
    Mains: 'true',
    NotAudited: 'true',
    NotConsolidatable: 'true',
    PageNumber: '1',
    Publisher: 'false',
    Symbol: symbol,
    TracingNo: '-1',
    search: 'true',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: `${CODAL_SITE}/` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`کدال پاسخ ${res.status} داد`);
  const json = asRecord(await res.json());
  const letters = Array.isArray(json?.Letters) ? json.Letters : null;
  if (!letters) throw new Error('ساختار پاسخ کدال ناشناخته است');

  const wanted = normalizeCodalSymbol(symbol);
  const out: CodalLetter[] = [];
  for (const item of letters) {
    const row = asRecord(item);
    if (!row) continue;
    if (normalizeCodalSymbol(String(row.Symbol ?? '')) !== wanted) continue;
    const tracingNo = Number(row.TracingNo);
    const titleFa = String(row.Title ?? '').replace(/\s+/g, ' ').trim();
    const link = codalUrl(String(row.Url ?? ''));
    if (!Number.isInteger(tracingNo) || !titleFa || !link) continue;
    out.push({
      tracingNo,
      titleFa: titleFa.slice(0, 500),
      letterCode: String(row.LetterCode ?? '').trim().slice(0, 40) || null,
      publishedAtFa: String(row.PublishDateTime ?? row.SentDateTime ?? '').trim().slice(0, 40),
      url: link,
      hasHtml: row.HasHtml === true,
    });
    if (out.length >= CODAL_MAX_NOTICES) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  zwnj: '‌',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const BOILERPLATE = new Set([
  'مشخصات',
  'اطلاعات نمایش داده شده با اطلاعات امضا شده مطابقت دارد',
  'لطفاً چند لحظه صبر کنید...',
  'تاریخ نامعتبر',
  'EN',
]);

/** متن دیدنی صفحهٔ اطلاعیه؛ صورت‌های مالی که جدولشان با جاوااسکریپت ساخته می‌شود متن کمی دارند */
export function extractCodalText(html: string, titleFa: string): string | null {
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp(?!;)/gi, ' '),
  );
  const title = titleFa.replace(/\s+/g, ' ').trim();
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line && !BOILERPLATE.has(line) && line !== title);
  const joined = lines.join('\n').trim();
  if (joined.length < 40) return null;
  return joined.length > BODY_MAX_CHARS ? `${joined.slice(0, BODY_MAX_CHARS)}…` : joined;
}

export async function fetchCodalLetterText(letter: CodalLetter): Promise<string | null> {
  if (!letter.hasHtml) return null;
  const res = await fetch(letter.url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', Referer: `${CODAL_SITE}/` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractCodalText(await res.text(), letter.titleFa);
}
