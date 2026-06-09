export const frequencyMap = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
  irregular: 1,
  unknown: 1
};

export function calculateDividendModel(input) {
  const investmentAmount = cleanNumber(input.investmentAmount);
  const fees = cleanNumber(input.fees);
  const availableInvestment = Math.max(0, investmentAmount - fees);
  const sharePrice = cleanNumber(input.sharePrice);
  const dividendPerShare = cleanNumber(input.dividendPerShare);
  const frequency = input.frequency || 'quarterly';
  const paymentsPerYear = frequencyMap[frequency] || 1;
  const allowFractionalShares = input.allowFractionalShares !== false;
  const taxRate = clamp(cleanNumber(input.taxRate), 0, 100) / 100;
  const projectionYears = Math.max(1, Math.min(50, Math.round(cleanNumber(input.projectionYears) || 1)));
  const dividendGrowthRate = cleanNumber(input.dividendGrowthRate) / 100;
  const priceGrowthRate = cleanNumber(input.priceGrowthRate) / 100;
  const recurringContribution = cleanNumber(input.recurringContribution);
  const reinvestDividends = Boolean(input.reinvestDividends);

  const shares = sharePrice > 0
    ? allowFractionalShares
      ? availableInvestment / sharePrice
      : Math.floor(availableInvestment / sharePrice)
    : 0;

  const annualDividendPerShare = dividendPerShare * paymentsPerYear;
  const annualIncome = shares * annualDividendPerShare;
  const afterTaxAnnualIncome = annualIncome * (1 - taxRate);
  const monthlyIncome = annualIncome / 12;
  const yieldOnCost = investmentAmount > 0 ? annualIncome / investmentAmount : 0;
  const currentYield = sharePrice > 0 ? annualDividendPerShare / sharePrice : 0;

  return {
    inputs: {
      investmentAmount,
      fees,
      availableInvestment,
      sharePrice,
      dividendPerShare,
      frequency,
      paymentsPerYear,
      taxRate,
      projectionYears,
      dividendGrowthRate,
      priceGrowthRate,
      recurringContribution,
      reinvestDividends,
      allowFractionalShares
    },
    shares,
    annualDividendPerShare,
    annualIncome,
    afterTaxAnnualIncome,
    monthlyIncome,
    yieldOnCost,
    currentYield,
    projection: projectYears({
      shares,
      sharePrice,
      annualDividendPerShare,
      projectionYears,
      dividendGrowthRate,
      priceGrowthRate,
      recurringContribution,
      reinvestDividends,
      taxRate,
      allowFractionalShares
    }),
    payoutSchedule: buildPayoutSchedule({ frequency, annualIncome })
  };
}

export function inferDividendInputs(events) {
  const sorted = [...(events || [])]
    .filter((event) => event.amount > 0 && event.exDividendDate)
    .sort((a, b) => b.exDividendDate.localeCompare(a.exDividendDate));

  if (!sorted.length) {
    return { frequency: 'unknown', dividendPerShare: 0, annualDividend: 0 };
  }

  const frequency = inferFrequency(sorted);
  const annualDividend = inferAnnualDividend(sorted, frequency);
  const paymentsPerYear = frequencyMap[frequency] || 1;

  return {
    frequency,
    annualDividend,
    dividendPerShare: paymentsPerYear > 0 ? annualDividend / paymentsPerYear : annualDividend
  };
}

function projectYears({
  shares,
  sharePrice,
  annualDividendPerShare,
  projectionYears,
  dividendGrowthRate,
  priceGrowthRate,
  recurringContribution,
  reinvestDividends,
  taxRate,
  allowFractionalShares
}) {
  const years = [];
  let projectedShares = shares;
  let projectedPrice = sharePrice;
  let projectedDividend = annualDividendPerShare;

  for (let year = 1; year <= projectionYears; year += 1) {
    if (year > 1) {
      projectedPrice *= 1 + priceGrowthRate;
      projectedDividend *= 1 + dividendGrowthRate;
    }

    const yearlyContribution = recurringContribution * 12;
    const contributionShares = projectedPrice > 0
      ? allowFractionalShares
        ? yearlyContribution / projectedPrice
        : Math.floor(yearlyContribution / projectedPrice)
      : 0;

    projectedShares += contributionShares;

    const grossIncome = projectedShares * projectedDividend;
    const afterTaxIncome = grossIncome * (1 - taxRate);
    const reinvestedShares = reinvestDividends && projectedPrice > 0
      ? allowFractionalShares
        ? afterTaxIncome / projectedPrice
        : Math.floor(afterTaxIncome / projectedPrice)
      : 0;

    projectedShares += reinvestedShares;

    years.push({
      year,
      shares: projectedShares,
      price: projectedPrice,
      annualDividendPerShare: projectedDividend,
      grossIncome,
      afterTaxIncome,
      reinvestedShares,
      contributionShares,
      portfolioValue: projectedShares * projectedPrice
    });
  }

  return years;
}

function buildPayoutSchedule({ frequency, annualIncome }) {
  if (!annualIncome) return [];

  const labels = {
    monthly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    quarterly: ['Q1', 'Q2', 'Q3', 'Q4'],
    semiannual: ['First half', 'Second half'],
    annual: ['Annual'],
    irregular: ['Estimated annual total'],
    unknown: ['Estimated annual total']
  }[frequency] || ['Estimated annual total'];

  const amount = annualIncome / labels.length;
  return labels.map((label) => ({ label, amount }));
}

function inferFrequency(events) {
  const recent = events.slice(0, 8);
  if (recent.length < 2) return 'unknown';

  const gaps = [];
  for (let index = 0; index < recent.length - 1; index += 1) {
    const current = Date.parse(recent[index].exDividendDate);
    const next = Date.parse(recent[index + 1].exDividendDate);
    if (Number.isFinite(current) && Number.isFinite(next)) {
      gaps.push(Math.abs(current - next) / 86400000);
    }
  }

  if (!gaps.length) return 'unknown';

  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (averageGap <= 40) return 'monthly';
  if (averageGap <= 120) return 'quarterly';
  if (averageGap <= 220) return 'semiannual';
  if (averageGap <= 430) return 'annual';
  return 'irregular';
}

function inferAnnualDividend(events, frequency) {
  const latestDate = Date.parse(events[0].exDividendDate);
  const oneYearAgo = latestDate - 370 * 86400000;
  const lastYearEvents = events.filter((event) => Date.parse(event.exDividendDate) >= oneYearAgo);

  if (lastYearEvents.length >= 2 || frequency === 'annual') {
    return lastYearEvents.reduce((sum, event) => sum + event.amount, 0);
  }

  const multiplier = frequencyMap[frequency] || 1;
  return events[0].amount * multiplier;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
