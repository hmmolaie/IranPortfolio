export enum AssetType {
  STOCK = 'STOCK',
  GOLD_ETF = 'GOLD_ETF',
  OPTION = 'OPTION',
  DEPOSIT = 'DEPOSIT',
  FUND = 'FUND',
  CASH = 'CASH',
  PHYSICAL_GOLD = 'PHYSICAL_GOLD',
  PHYSICAL_USD = 'PHYSICAL_USD',
  INDEX = 'INDEX',
}

export enum PortfolioStrategy {
  GROWTH = 'GROWTH',
  VALUE = 'VALUE',
  INCOME = 'INCOME',
  HEDGED = 'HEDGED',
  CONSERVATIVE = 'CONSERVATIVE',
  CUSTOM = 'CUSTOM',
}

export const STRATEGY_LABELS_FA: Record<PortfolioStrategy, string> = {
  [PortfolioStrategy.GROWTH]: 'رشدی',
  [PortfolioStrategy.VALUE]: 'ارزشی',
  [PortfolioStrategy.INCOME]: 'درآمدی / سود تقسیمی',
  [PortfolioStrategy.HEDGED]: 'پوششی',
  [PortfolioStrategy.CONSERVATIVE]: 'محافظه‌کار',
  [PortfolioStrategy.CUSTOM]: 'سفارشی',
};

export const ASSET_TYPE_LABELS_FA: Record<AssetType, string> = {
  [AssetType.STOCK]: 'سهام',
  [AssetType.GOLD_ETF]: 'صندوق طلا',
  [AssetType.OPTION]: 'اختیار معامله',
  [AssetType.DEPOSIT]: 'سپرده بانکی',
  [AssetType.FUND]: 'صندوق سرمایه‌گذاری',
  [AssetType.CASH]: 'نقد',
  [AssetType.PHYSICAL_GOLD]: 'طلای فیزیکی',
  [AssetType.PHYSICAL_USD]: 'دلار فیزیکی',
  [AssetType.INDEX]: 'شاخص',
};

export enum SnapshotKind {
  SUGGESTION = 'SUGGESTION',
  REBALANCE = 'REBALANCE',
  MONTHLY_EVAL = 'MONTHLY_EVAL',
  USER_ADJUSTED = 'USER_ADJUSTED',
}

export enum PortfolioEventType {
  BUY = 'BUY',
  SELL = 'SELL',
  DEPOSIT_CASH = 'DEPOSIT_CASH',
  WITHDRAW_CASH = 'WITHDRAW_CASH',
  WEIGHT_EDIT = 'WEIGHT_EDIT',
  ACCEPT_REBALANCE = 'ACCEPT_REBALANCE',
  REJECT_REBALANCE = 'REJECT_REBALANCE',
}

export interface SuggestPortfolioRequest {
  capitalRial: number;
  strategy: PortfolioStrategy;
  riskTolerance?: number;
  notes?: string;
}

export interface SuggestItemDto {
  symbol: string;
  assetType: AssetType;
  weightPct: number;
  quantity: number;
  amountRial: number;
  reasonFa: string;
}

export interface SuggestPortfolioResponse {
  strategySummaryFa: string;
  items: SuggestItemDto[];
}

/** نوع گزارش مالی بارگذاری‌شده برای یک سهم */
export type FinancialReportType = 'annual' | 'interim9' | 'interim6' | 'interim3' | 'balance' | 'other';

export const FINANCIAL_REPORT_TYPE_LABELS_FA: Record<FinancialReportType, string> = {
  annual: 'صورت‌های مالی سالانه',
  interim9: 'میان‌دوره‌ای ۹ ماهه',
  interim6: 'میان‌دوره‌ای ۶ ماهه',
  interim3: 'میان‌دوره‌ای ۳ ماهه',
  balance: 'ترازنامه / صورت وضعیت مالی',
  other: 'گزارش مالی دیگر',
};

/** ارقام اصلی صورت مالی؛ همه به میلیون ریال جز EPS و DPS که ریال هستند */
export interface FinancialFigures {
  revenue?: number | null;
  costOfRevenue?: number | null;
  grossProfit?: number | null;
  operatingProfit?: number | null;
  financeCost?: number | null;
  netProfit?: number | null;
  /** سود قابل انتساب به مالکان شرکت اصلی */
  netProfitParent?: number | null;
  eps?: number | null;
  /** سود نقدی پیشنهادی یا مصوب هر سهم */
  dps?: number | null;
  cash?: number | null;
  shortTermInvestments?: number | null;
  receivables?: number | null;
  inventory?: number | null;
  prepayments?: number | null;
  currentAssets?: number | null;
  fixedAssets?: number | null;
  totalAssets?: number | null;
  currentLiabilities?: number | null;
  totalLiabilities?: number | null;
  /** تسهیلات مالی کوتاه‌مدت و بلندمدت */
  borrowings?: number | null;
  /** حقوق مالکانهٔ قابل انتساب به مالکان شرکت اصلی */
  equity?: number | null;
  capital?: number | null;
  retainedEarnings?: number | null;
  operatingCashFlow?: number | null;
  capex?: number | null;
  /** تعداد سهام؛ اگر نبود از سرمایه با ارزش اسمی ۱۰۰ ریال حساب می‌شود */
  shares?: number | null;
  /** ارقام همان دوره در سال قبل (ستون مقایسه‌ای) */
  prevRevenue?: number | null;
  prevNetProfit?: number | null;
  prevEps?: number | null;
  prevOperatingProfit?: number | null;
  /** درصد فروش صادراتی از کل فروش */
  exportSalesPct?: number | null;
}

export const FINANCIAL_FIGURE_LABELS_FA: Record<keyof FinancialFigures, string> = {
  revenue: 'درآمد عملیاتی',
  costOfRevenue: 'بهای تمام‌شده',
  grossProfit: 'سود ناخالص',
  operatingProfit: 'سود عملیاتی',
  financeCost: 'هزینهٔ مالی',
  netProfit: 'سود خالص',
  netProfitParent: 'سود خالص سهم مالکان اصلی',
  eps: 'سود هر سهم (ریال)',
  dps: 'سود نقدی هر سهم (ریال)',
  cash: 'موجودی نقد',
  shortTermInvestments: 'سرمایه‌گذاری کوتاه‌مدت',
  receivables: 'دریافتنی‌های تجاری و غیرتجاری',
  inventory: 'موجودی مواد و کالا',
  prepayments: 'پیش‌پرداخت‌ها',
  currentAssets: 'دارایی‌های جاری',
  fixedAssets: 'دارایی ثابت مشهود',
  totalAssets: 'جمع دارایی‌ها',
  currentLiabilities: 'بدهی‌های جاری',
  totalLiabilities: 'جمع بدهی‌ها',
  borrowings: 'تسهیلات مالی',
  equity: 'حقوق مالکانه',
  capital: 'سرمایه',
  retainedEarnings: 'سود انباشته',
  operatingCashFlow: 'جریان نقد عملیاتی',
  capex: 'خرید دارایی ثابت',
  shares: 'تعداد سهام',
  prevRevenue: 'درآمد دورهٔ مشابه قبل',
  prevNetProfit: 'سود خالص دورهٔ مشابه قبل',
  prevEps: 'سود هر سهم دورهٔ مشابه قبل',
  prevOperatingProfit: 'سود عملیاتی دورهٔ مشابه قبل',
  exportSalesPct: 'سهم فروش صادراتی٪',
};

/** عوامل بیرونی که روی سود شرکت‌های بورسی اثر دارند */
export type MacroDriverKey = 'usd' | 'oil' | 'copper' | 'steel' | 'gold' | 'rate';

export const MACRO_DRIVER_LABELS_FA: Record<MacroDriverKey, string> = {
  usd: 'دلار',
  oil: 'نفت',
  copper: 'مس',
  steel: 'فولاد',
  gold: 'طلا',
  rate: 'نرخ بهره',
};

/** حساسیت سود شرکت به هر عامل: ۲- خیلی منفی تا ۲+ خیلی مثبت؛ صفر یعنی بی‌اثر */
export type FundamentalSensitivity = Partial<Record<MacroDriverKey, number>> & { noteFa?: string | null };
