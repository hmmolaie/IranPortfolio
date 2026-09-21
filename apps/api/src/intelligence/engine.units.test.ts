import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDna,
  buildPlan,
  classifyRegime,
  fundShift,
  healthScore,
  maxDrawdownPct,
  scenarioImpact,
  scoreRisk,
  weightsFromAmounts,
} from './engine';

const empty = { equity: 0, fixed: 0, gold: 0, usd: 0, cash: 0 };
const factsEmpty = {
  usdChangePct: null,
  goldChangePct: null,
  interestRatePct: null,
  interestRateChangePoints: null,
  inflationPct: null,
  geoRiskScore: null,
  newsBearish: 0,
  newsBullish: 0,
};

describe('regime', () => {
  it('stays neutral without enough facts', () => {
    const r = classifyRegime(factsEmpty);
    assert.equal(r.regime, 'NEUTRAL');
    assert.equal(r.confidence, null);
    assert.equal(r.enough, false);
  });

  it('uses only supplied drivers', () => {
    const r = classifyRegime({
      ...factsEmpty,
      usdChangePct: 8,
      interestRateChangePoints: 1,
      geoRiskScore: 8,
    });
    assert.equal(r.enough, true);
    assert.ok(r.regime === 'CRISIS' || r.regime === 'RISK_OFF' || r.regime === 'DEFENSIVE');
    assert.ok(r.drivers.every((d) => d.labelFa.length > 0));
    assert.ok((r.confidence ?? 0) <= 0.85);
  });
});

describe('weights and plan', () => {
  it('turns amounts into shares', () => {
    const w = weightsFromAmounts([
      { assetType: 'STOCK', amountRial: 50 },
      { assetType: 'PHYSICAL_GOLD', amountRial: 50 },
    ]);
    assert.equal(w.equity + w.gold, 100);
  });

  it('does not tilt when regime is unknown', () => {
    const plan = buildPlan({
      riskTolerance: 5,
      weights: { ...empty, equity: 100 },
      regime: 'NEUTRAL',
      confidence: null,
      drivers: [],
    });
    assert.equal(plan.tilted, false);
    assert.equal(plan.lines.find((l) => l.asset === 'equity')?.confidence, null);
  });
});

describe('risk and health', () => {
  it('refuses a score for an empty book', () => {
    const risk = scoreRisk(empty, false);
    assert.equal(risk.score, null);
    assert.equal(healthScore(empty, null).score, null);
  });

  it('needs five marks for drawdown', () => {
    assert.equal(maxDrawdownPct([1, 2, 3]).pct, null);
    const dd = maxDrawdownPct([100, 100, 80, 90, 70]);
    assert.equal(dd.pct, 30);
  });
});

describe('scenario and funds', () => {
  it('applies the shock only to that sleeve', () => {
    const out = scenarioImpact({ ...empty, gold: 20, cash: 80 }, { gold: 10 });
    assert.equal(out.enough, true);
    assert.equal(out.impactPct, 2);
  });

  it('does not invent a manager pattern from one report', () => {
    const out = fundShift([{ label: '۱', weights: { equity: 40 } }]);
    assert.equal(out.enough, false);
  });
});

describe('dna', () => {
  it('keeps declared risk and does not invent inflation sensitivity', () => {
    const dna = buildDna({
      riskTolerance: 8,
      horizonMonths: 48,
      liquidityNeed: null,
      maxDrawdownPct: null,
      inflationSensitivity: null,
      fxSensitivity: 'LOW',
      weights: { ...empty, usd: 25, cash: 75 },
    });
    assert.equal(dna.riskScore, 8);
    assert.equal(dna.horizon, 'LONG');
    assert.equal(dna.inflationSensitivity, null);
    assert.equal(dna.fxExposure, 'HIGH');
  });
});
