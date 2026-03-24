export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return 'N/A';
  if (price === 0) return '0.0000';
  
  const absPrice = Math.abs(price);
  
  if (absPrice >= 1000) return price.toFixed(2);
  if (absPrice >= 1) return price.toFixed(4);
  
  const str = absPrice.toString();
  if (str.includes('e')) {
    return price.toFixed(10).replace(/0+$/, '');
  }
  
  const decimals = str.split('.')[1] || '';
  let leadingZeros = 0;
  for (let i = 0; i < decimals.length; i++) {
    if (decimals[i] === '0') leadingZeros++;
    else break;
  }
  
  return price.toFixed(leadingZeros + 4);
}
