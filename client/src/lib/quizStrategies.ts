/**
 * Quiz → Strategy Mapping
 *
 * Maps quiz answer combinations to suggested/excluded strategies with
 * estimated savings ranges derived from typical tax rates for each
 * income bracket. Uses 2024/2025 tax law.
 */

import type { QuizSubmission } from "@shared/schema";

export interface QuizStrategyResult {
  strategyId: string;
  status: "suggested" | "excluded";
  savingsMin: number;
  savingsMax: number;
  rationale: string;
}

// Mid-point profit values for savings estimates
const PROFIT_MIDPOINTS: Record<string, number> = {
  under_100k:  60000,
  "100k_250k": 175000,
  "250k_500k": 375000,
  "500k_1m":   750000,
  over_1m:     1200000,
};

const TAX_RATE_FOR_BRACKET: Record<string, number> = {
  under_100k:  0.22,
  "100k_250k": 0.24,
  "250k_500k": 0.32,
  "500k_1m":   0.35,
  over_1m:     0.37,
};

function profit(q: QuizSubmission): number {
  return PROFIT_MIDPOINTS[q.annualProfit] ?? 100000;
}

function rate(q: QuizSubmission): number {
  return TAX_RATE_FOR_BRACKET[q.annualProfit] ?? 0.24;
}

function savingsFromDeduction(deduction: number, q: QuizSubmission): { min: number; max: number } {
  const r = rate(q);
  return {
    min: Math.round(deduction * r * 0.6),
    max: Math.round(deduction * r * 1.4),
  };
}

function isBusiness(q: QuizSubmission): boolean {
  return ["sole_prop", "llc_single", "s_corp", "partnership", "c_corp"].includes(q.businessStructure);
}

function isSCorp(q: QuizSubmission): boolean {
  return q.businessStructure === "s_corp";
}

function isPartnership(q: QuizSubmission): boolean {
  return q.businessStructure === "partnership" || q.businessStructure === "llc_single";
}

function highIncome(q: QuizSubmission): boolean {
  return ["250k_500k", "500k_1m", "over_1m"].includes(q.annualProfit);
}

export function mapQuizToStrategies(q: QuizSubmission): QuizStrategyResult[] {
  const results: QuizStrategyResult[] = [];
  const p = profit(q);

  // ─── ALWAYS suggested for business owners ───────────────────────────

  if (isBusiness(q)) {
    // Accountable Plan — S-Corps especially
    if (["s_corp", "partnership", "c_corp"].includes(q.businessStructure)) {
      const s = savingsFromDeduction(Math.min(p * 0.12, 35000), q);
      results.push({
        strategyId: "accountable_plan",
        status: "suggested",
        savingsMin: Math.max(s.min, 3000),
        savingsMax: Math.min(s.max, 35000),
        rationale: `As a ${q.businessStructure === "s_corp" ? "S-Corporation" : "business"} owner, an accountable plan allows you to reimburse yourself tax-free for home office, vehicle, phone, and other business expenses — reducing both income and payroll taxes.`,
      });
    }

    // Home Office
    if (q.ownsHome === "yes_home_office" || q.ownsHome === "yes") {
      results.push({
        strategyId: "home_office",
        status: "suggested",
        savingsMin: 800,
        savingsMax: 5000,
        rationale: `Business owners who use a dedicated portion of their home for business can deduct a proportional share of home expenses. ${isSCorp(q) ? "S-Corp owners should run this through an accountable plan for maximum benefit." : ""}`,
      });
    }

    // Meals
    const mealSavings = savingsFromDeduction(p * 0.03, q);
    results.push({
      strategyId: "meals",
      status: "suggested",
      savingsMin: Math.max(mealSavings.min, 500),
      savingsMax: Math.min(mealSavings.max, 12000),
      rationale: "Business meals with clients, employees, or business associates are 50% deductible. Proper documentation (purpose, attendees, amount) is essential.",
    });

    // Travel
    const travelSavings = savingsFromDeduction(p * 0.04, q);
    results.push({
      strategyId: "travel",
      status: "suggested",
      savingsMin: Math.max(travelSavings.min, 1000),
      savingsMax: Math.min(travelSavings.max, 12000),
      rationale: "Ordinary and necessary business travel (airfare, lodging, ground transportation) is fully deductible when the primary purpose is business.",
    });

    // Vehicle
    results.push({
      strategyId: "vehicle",
      status: "suggested",
      savingsMin: 1500,
      savingsMax: 12000,
      rationale: "Business use of your vehicle is deductible via actual expenses or standard mileage rate (67¢/mile for 2024). Heavy SUVs/trucks may qualify for Section 179 accelerated expensing.",
    });

    // Section 199A — pass-throughs
    if (["sole_prop", "llc_single", "s_corp", "partnership"].includes(q.businessStructure)) {
      const qbiDeduction = p * 0.20;
      const s = savingsFromDeduction(qbiDeduction, q);
      results.push({
        strategyId: "section_199a",
        status: "suggested",
        savingsMin: Math.max(s.min, 2000),
        savingsMax: Math.min(s.max, 80000),
        rationale: `Pass-through business owners may deduct up to 20% of qualified business income — potentially ${Math.round(qbiDeduction).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} based on your estimated profit. This is one of the most valuable deductions available.`,
      });
    }

    // Maximize Depreciation
    if (["100k_250k", "250k_500k", "500k_1m", "over_1m"].includes(q.annualProfit)) {
      results.push({
        strategyId: "maximize_depreciation",
        status: "suggested",
        savingsMin: 5000,
        savingsMax: 50000,
        rationale: "Section 179 allows up to $1,220,000 of qualifying equipment/property to be expensed in the year of purchase. 60% bonus depreciation applies to new and used property in 2024.",
      });
    }

    // Retirement plans
    if (!["under_100k"].includes(q.annualProfit)) {
      const retMin = Math.round(p * 0.06 * rate(q));
      const retMax = Math.round(Math.min(p * 0.25, 69000) * rate(q));
      results.push({
        strategyId: "traditional_401k_business",
        status: "suggested",
        savingsMin: Math.max(retMin, 3000),
        savingsMax: Math.min(retMax, 25000),
        rationale: "Employer contributions to a 401(k) plan are fully deductible. Combined employee/employer contributions reach $69,000 in 2024, dramatically reducing taxable income.",
      });
    }

    // Profit sharing — higher income
    if (["250k_500k", "500k_1m", "over_1m"].includes(q.annualProfit)) {
      const s = savingsFromDeduction(Math.min(p * 0.15, 69000), q);
      results.push({
        strategyId: "profit_sharing",
        status: "suggested",
        savingsMin: Math.max(s.min, 8000),
        savingsMax: Math.min(s.max, 50000),
        rationale: "A profit-sharing plan allows discretionary employer contributions up to 25% of compensation (max $69,000 in 2024). Ideal for your profit level — flexible contributions let you adjust year to year.",
      });
    }

    // Cash balance plan — high earners
    if (["500k_1m", "over_1m"].includes(q.annualProfit)) {
      results.push({
        strategyId: "cash_balance_plan",
        status: "suggested",
        savingsMin: 30000,
        savingsMax: 150000,
        rationale: "Cash balance / defined benefit plans allow dramatically larger deductions than 401(k)s — often $100K–$300K+ per year for high earners over 50. At your income level this is one of the most powerful tax reduction tools available.",
      });
    }

    // Late S election for partnerships/LLCs
    if (isPartnership(q) && ["100k_250k", "250k_500k", "500k_1m", "over_1m"].includes(q.annualProfit)) {
      const seSavings = Math.round(Math.min(p * 0.35, 150000) * 0.153 * 0.5);
      results.push({
        strategyId: "late_s_election",
        status: "suggested",
        savingsMin: Math.max(seSavings * 0.6, 5000),
        savingsMax: Math.min(seSavings * 1.4, 50000),
        rationale: `Electing S-Corp status for your LLC/partnership can substantially reduce self-employment taxes on your profit. At your income level, the annual payroll tax savings from paying yourself a reasonable salary and taking the remainder as distributions could be significant.`,
      });
    }

    if (["500k_1m", "over_1m"].includes(q.annualProfit)) {
      results.push({
        strategyId: "late_c_election",
        status: "suggested",
        savingsMin: 20000,
        savingsMax: 80000,
        rationale: "At high profit levels, a C-Corp election can provide access to the flat 21% corporate rate, enhanced fringe benefits, and QSBS planning opportunities. Best evaluated alongside an S-Corp comparison.",
      });
    }

    // Hiring kids — business owners with kids
    if (q.hasDependents && q.hasDependents !== "no") {
      results.push({
        strategyId: "hiring_kids",
        status: "suggested",
        savingsMin: 3000,
        savingsMax: 15000,
        rationale: "Paying your children reasonable wages for real work shifts income from your high bracket to their zero/low bracket. Children under 18 in a parent's sole prop or partnership are exempt from FICA taxes.",
      });
    }

    // HRA — if has employees
    if (q.hasEmployees && q.hasEmployees !== "no") {
      results.push({
        strategyId: "health_reimbursement",
        status: "suggested",
        savingsMin: 3000,
        savingsMax: 20000,
        rationale: "An HRA allows you to reimburse employees for health insurance premiums and medical expenses tax-free. Reduces both employer payroll taxes and provides valuable tax-free benefits.",
      });
    }

    // WOTC
    if (q.hasEmployees === "yes_6plus" || q.hasEmployees === "yes_1_5") {
      results.push({
        strategyId: "work_opportunity_credit",
        status: "suggested",
        savingsMin: 1200,
        savingsMax: 15000,
        rationale: "Federal tax credit of 25–40% of first-year wages for employees from targeted groups (veterans, ex-felons, long-term unemployed). Worth $1,200–$9,600 per qualifying hire.",
      });
    }

    // Employee achievement award
    if (q.hasEmployees && q.hasEmployees !== "no") {
      results.push({
        strategyId: "employee_achievement_award",
        status: "suggested",
        savingsMin: 500,
        savingsMax: 3000,
        rationale: "Deductible tangible awards for length of service or safety achievements (up to $1,600/employee). Tax-free to employees and deductible for the business.",
      });
    }

    // Augusta Rule
    results.push({
      strategyId: "augusta_rule",
      status: "suggested",
      savingsMin: 1500,
      savingsMax: 15000,
      rationale: "Rent your home to your business for up to 14 days/year — income is completely excluded from your personal taxes under IRC Section 280A. The business gets a deduction. Clean documentation is key.",
    });

    // Cost segregation — real estate owners
    if (q.investmentActivity === "real_estate" || q.investmentActivity === "multiple") {
      results.push({
        strategyId: "cost_segregation",
        status: "suggested",
        savingsMin: 15000,
        savingsMax: 100000,
        rationale: "A cost segregation study accelerates depreciation on commercial or residential investment property by reclassifying components into 5, 7, or 15-year property. Most beneficial for properties valued over $1M.",
      });
    }

    // 1031 exchange — real estate
    if (q.investmentActivity === "real_estate" || q.investmentActivity === "multiple") {
      results.push({
        strategyId: "1031_exchange",
        status: "suggested",
        savingsMin: 10000,
        savingsMax: 80000,
        rationale: "When selling investment real estate, a 1031 exchange defers all capital gains taxes by reinvesting into like-kind property within strict IRS deadlines (45 days to identify, 180 days to close).",
      });
    }

    // Captive insurance — high revenue
    if (["500k_1m", "over_1m"].includes(q.annualRevenue ?? "")) {
      results.push({
        strategyId: "captive_insurance",
        status: "suggested",
        savingsMin: 25000,
        savingsMax: 120000,
        rationale: "A captive insurance company converts retained business risk into deductible insurance premiums paid to a company you own. Most beneficial for businesses with revenue over $500K facing insurable risks.",
      });
    }
  }

  // ─── INDIVIDUAL strategies ────────────────────────────────────────────

  // Itemized deductions — homeowners
  if (q.ownsHome !== "no" && q.ownsHome) {
    results.push({
      strategyId: "itemized_deductions",
      status: "suggested",
      savingsMin: 2000,
      savingsMax: 10000,
      rationale: "Homeowners typically benefit from itemizing — mortgage interest, property taxes (capped at $10K), and charitable donations often exceed the standard deduction. Especially valuable in high-tax states.",
    });

    results.push({
      strategyId: "sell_your_home",
      status: "suggested",
      savingsMin: 15000,
      savingsMax: 75000,
      rationale: "As a homeowner, you may qualify to exclude up to $500,000 (MFJ) or $250,000 (single) of capital gains when selling your primary residence — one of the largest tax-free gains available.",
    });
  }

  // HSA
  results.push({
    strategyId: "health_savings_account",
    status: "suggested",
    savingsMin: 1000,
    savingsMax: 8300,
    rationale: "An HSA offers a triple tax advantage — pre-tax contributions, tax-free growth, and tax-free withdrawals for qualified medical expenses. Requires enrollment in a High Deductible Health Plan.",
  });

  // Traditional 401k individual
  results.push({
    strategyId: "traditional_401k_individual",
    status: "suggested",
    savingsMin: 1500,
    savingsMax: Math.round(23000 * rate(q)),
    rationale: `Contributing up to $23,000 (2024) to a traditional 401(k) reduces your taxable income dollar-for-dollar. At your tax bracket, maxing this out saves approximately ${Math.round(23000 * rate(q)).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} in federal taxes.`,
  });

  // Child strategies
  if (q.hasDependents && q.hasDependents !== "no") {
    results.push({
      strategyId: "child_tax_credit",
      status: "suggested",
      savingsMin: 1000,
      savingsMax: 5000,
      rationale: "The Child Tax Credit provides up to $2,000 per qualifying child under 17. Partially refundable up to $1,600. Subject to phase-out above $400,000 AGI (MFJ).",
    });
  }

  // Child Roth IRA — only if kids have earned income
  if (q.hasDependents === "yes_earned_income") {
    results.push({
      strategyId: "child_roth_ira",
      status: "suggested",
      savingsMin: 500,
      savingsMax: 7000,
      rationale: "Children with earned income can contribute to a Roth IRA. Tax-free compound growth from childhood to retirement is one of the most powerful long-term wealth-building strategies for families.",
    });
  }

  // Investment strategies
  if (q.investmentActivity === "stocks" || q.investmentActivity === "multiple") {
    results.push({
      strategyId: "tax_loss_harvesting",
      status: "suggested",
      savingsMin: 2000,
      savingsMax: 20000,
      rationale: "Strategically selling losing investments to offset capital gains and up to $3,000 of ordinary income. Most effective for investors with both unrealized losses and realized gains in the same tax year.",
    });
  }

  if (highIncome(q) && (q.investmentActivity === "stocks" || q.investmentActivity === "multiple")) {
    results.push({
      strategyId: "oil_and_gas",
      status: "suggested",
      savingsMin: 10000,
      savingsMax: 50000,
      rationale: "Oil and gas investments offer significant upfront deductions (often 70–80% of the investment in year one) through intangible drilling costs. Best for high-income earners seeking to offset ordinary income.",
    });
  }

  // Opportunity zone
  if (highIncome(q) && (q.investmentActivity === "stocks" || q.investmentActivity === "real_estate" || q.investmentActivity === "multiple")) {
    results.push({
      strategyId: "opportunity_zone",
      status: "suggested",
      savingsMin: 5000,
      savingsMax: 40000,
      rationale: "Investing capital gains in Qualified Opportunity Zone Funds defers the gain and, if held 10+ years, the appreciation from the QOZ investment is entirely tax-free.",
    });
  }

  // Charitable strategies — high earners
  if (highIncome(q) && (q.biggestFrustration === "paying_too_much" || q.biggestFrustration === "no_strategy")) {
    results.push({
      strategyId: "charitable_remainder_trust",
      status: "suggested",
      savingsMin: 15000,
      savingsMax: 80000,
      rationale: "A Charitable Remainder Trust lets you donate appreciated assets, receive an immediate charitable deduction, avoid capital gains on the sale, and receive an income stream for life — with the remainder going to charity.",
    });
  }

  // QCDs — retirees / high earners
  if (["500k_1m", "over_1m"].includes(q.annualProfit)) {
    results.push({
      strategyId: "qcds",
      status: "suggested",
      savingsMin: 1000,
      savingsMax: 12000,
      rationale: "Taxpayers age 70½ or older can transfer up to $100,000/year from an IRA directly to charity, reducing taxable income and satisfying RMD requirements — even if you don't itemize.",
    });
  }

  // QSBS — for C-Corps
  if (q.businessStructure === "c_corp" || q.businessStructure === "s_corp") {
    results.push({
      strategyId: "qsbs",
      status: "suggested",
      savingsMin: 5000,
      savingsMax: 50000,
      rationale: "Section 1202 allows 100% exclusion of capital gains (up to $10M or 10× cost basis) from the sale of Qualified Small Business Stock held 5+ years. Planning now for a future exit can be extremely valuable.",
    });
  }

  // Deferred compensation — C-Corps, high earners
  if (q.businessStructure === "c_corp" && highIncome(q)) {
    results.push({
      strategyId: "deferred_compensation",
      status: "suggested",
      savingsMin: 10000,
      savingsMax: 60000,
      rationale: "Non-qualified deferred compensation plans allow highly compensated executives to defer income to a future, lower-tax year. Must meet strict IRC 409A requirements.",
    });
  }

  // ─── EXCLUDED strategies (with reasons) ────────────────────────────

  // Child Roth IRA excluded if kids but no earned income
  if (q.hasDependents === "yes") {
    results.push({
      strategyId: "child_roth_ira",
      status: "excluded",
      savingsMin: 0,
      savingsMax: 0,
      rationale: "Your dependents don't currently have earned income. A Child Roth IRA requires earned income. This strategy becomes available if your children start working or working in your business.",
    });
  }

  // Late S-election excluded for existing S-Corps
  if (q.businessStructure === "s_corp") {
    results.push({
      strategyId: "late_s_election",
      status: "excluded",
      savingsMin: 0,
      savingsMax: 0,
      rationale: "You're already an S-Corporation, so a late S-election doesn't apply. However, it may be worth evaluating whether an S-Corp or C-Corp structure is optimal for your current income level.",
    });
  }

  // Cost segregation excluded for non-real-estate
  if (q.investmentActivity === "business_only" || q.investmentActivity === "stocks") {
    results.push({
      strategyId: "cost_segregation",
      status: "excluded",
      savingsMin: 0,
      savingsMax: 0,
      rationale: "Cost segregation applies to real property ownership. Since you don't currently own real estate investments, this strategy isn't applicable — but worth revisiting if you acquire property.",
    });
  }

  // 1031 excluded for non-real-estate
  if (q.investmentActivity === "business_only" || q.investmentActivity === "stocks") {
    results.push({
      strategyId: "1031_exchange",
      status: "excluded",
      savingsMin: 0,
      savingsMax: 0,
      rationale: "1031 exchanges apply to investment real estate. Without investment property, this strategy doesn't apply currently.",
    });
  }

  // Tax loss harvesting excluded if no investments
  if (q.investmentActivity === "business_only") {
    results.push({
      strategyId: "tax_loss_harvesting",
      status: "excluded",
      savingsMin: 0,
      savingsMax: 0,
      rationale: "Tax loss harvesting requires investment securities. Since your income is primarily from business operations, this strategy doesn't currently apply.",
    });
  }

  // Deduplicate (suggested wins over excluded)
  const seen = new Map<string, QuizStrategyResult>();
  for (const r of results) {
    const existing = seen.get(r.strategyId);
    if (!existing || (r.status === "suggested" && existing.status === "excluded")) {
      seen.set(r.strategyId, r);
    }
  }

  return Array.from(seen.values());
}

// ─── Revenue bracket label ──────────────────────────────────────────────────
export function revenueLabel(val: string): string {
  const map: Record<string, string> = {
    under_100k: "Under $100K", "100k_250k": "$100K–$250K", "250k_500k": "$250K–$500K",
    "500k_1m": "$500K–$1M", "1m_2m": "$1M–$2M", over_2m: "Over $2M",
  };
  return map[val] ?? val;
}

export function profitLabel(val: string): string {
  const map: Record<string, string> = {
    under_100k: "Under $100K", "100k_250k": "$100K–$250K", "250k_500k": "$250K–$500K",
    "500k_1m": "$500K–$1M", over_1m: "Over $1M",
  };
  return map[val] ?? val;
}

export function taxBillLabel(val: string): string {
  const map: Record<string, string> = {
    under_25k: "Under $25K", "25k_50k": "$25K–$50K", "50k_100k": "$50K–$100K",
    "100k_200k": "$100K–$200K", over_200k: "Over $200K",
  };
  return map[val] ?? val;
}

export function structureLabel(val: string): string {
  const map: Record<string, string> = {
    sole_prop: "Sole Proprietor / 1099", llc_single: "LLC (Single Member)",
    s_corp: "S-Corporation", partnership: "Partnership / Multi-Member LLC",
    c_corp: "C-Corporation", not_sure: "Not Sure",
  };
  return map[val] ?? val;
}

// ─── Entity type from business structure ────────────────────────────────────
export function entityTypeFromStructure(structure: string): string {
  const map: Record<string, string> = {
    sole_prop:   "1040",
    llc_single:  "1065",
    s_corp:      "1120S",
    partnership: "1065",
    c_corp:      "C-Corp",
    not_sure:    "1040",
  };
  return map[structure] ?? "1040";
}
