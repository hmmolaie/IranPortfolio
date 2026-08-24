export enum AssetType {
  STOCK = 'STOCK',
  GOLD_ETF = 'GOLD_ETF',
  OPTION = 'OPTION',
  DEPOSIT = 'DEPOSIT',
  FUND = 'FUND',
  CASH = 'CASH',
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
