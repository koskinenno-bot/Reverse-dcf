/** Display symbol for a currency code ("$" when unknown, as before). */
export const currencySymbol = (code?: string): string => {
  switch ((code || 'USD').toUpperCase()) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'CHF': return 'CHF ';
    case 'SEK': case 'NOK': case 'DKK': return 'kr ';
    default: return `${code} `;
  }
};
