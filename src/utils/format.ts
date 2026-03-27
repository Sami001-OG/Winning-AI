export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return 'N/A';
  if (price === 0) return '0.0000';
  
  const absPrice = Math.abs(price);
  
  if (absPrice >= 1000) return price.toFixed(2);
  if (absPrice >= 1) return price.toFixed(4);
  
  // Convert to string without scientific notation
  const str = price.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 20 });
  
  const parts = str.split('.');
  if (parts.length === 1) return str;
  
  const decimals = parts[1];
  let leadingZeros = 0;
  for (let i = 0; i < decimals.length; i++) {
    if (decimals[i] === '0') leadingZeros++;
    else break;
  }
  
  // Show 4 significant digits after leading zeros, capped at 20 decimals
  const fractionDigits = Math.min(leadingZeros + 4, 20);
  return price.toFixed(fractionDigits);
}
