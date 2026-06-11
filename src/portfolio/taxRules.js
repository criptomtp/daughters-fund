// Ставки податків для фізособи-резидента України, станом на 2026.
// Джерела: ПКУ ст. 165.1.52, Закон № 4015-IX (ВЗ 5% з 01.12.2024).
// ОВДП — пільга збережена після підвищення ВЗ.

export const TAX_RULES = {
  ovdp: {
    coupon:           { pdfo: 0,    militaryTax: 0    },
    redemption:       { pdfo: 0,    militaryTax: 0    },
    secondaryMarket:  { pdfo: 0,    militaryTax: 0    },
  },
  corporate: {
    coupon:           { pdfo: 0.18, militaryTax: 0.05 },
    redemption:       { pdfo: 0,    militaryTax: 0    },
    secondaryMarket:  { pdfo: 0.18, militaryTax: 0.05 },
  },
};

export const BOND_TYPES = ["ovdp", "corporate"];
export const CURRENCIES = ["UAH", "USD", "EUR"];
export const COUPON_FREQUENCIES = [
  { value: 0, label: "Без купона (дисконтна)" },
  { value: 1, label: "Раз на рік" },
  { value: 2, label: "Раз на півроку" },
  { value: 4, label: "Щоквартально" },
  { value: 12, label: "Щомісяця" },
];

export function getTaxRule(bondType, payoutType = "coupon") {
  return TAX_RULES[bondType]?.[payoutType] ?? { pdfo: 0, militaryTax: 0 };
}

export function netRate(bondType, payoutType = "coupon") {
  const r = getTaxRule(bondType, payoutType);
  return 1 - r.pdfo - r.militaryTax;
}

export function applyTax(grossAmount, bondType, payoutType = "coupon") {
  return grossAmount * netRate(bondType, payoutType);
}

export function taxRateLabel(bondType, payoutType = "coupon") {
  const r = getTaxRule(bondType, payoutType);
  const total = (r.pdfo + r.militaryTax) * 100;
  if (total === 0) return "Без податків";
  return `ПДФО ${r.pdfo * 100}% + ВЗ ${r.militaryTax * 100}% = ${total}%`;
}
