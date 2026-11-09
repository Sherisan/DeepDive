const SYMBOLS: Record<string, string> = {
  ZAR: 'R',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbol(currency = 'ZAR'): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

export function formatMoney(amount: number, currency = 'ZAR'): string {
  const symbol = currencySymbol(currency);
  return `${symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(2)}`;
}
