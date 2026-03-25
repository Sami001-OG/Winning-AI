const BINANCE_ENDPOINTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];

const BINANCE_FUTURES_ENDPOINTS = [
  'https://fapi.binance.com'
];

export const fetchWithRetry = async (
  url: string,
  retries = 3,
  backoff = 1000
): Promise<Response> => {
  const isBinanceSpot = url.includes('api.binance.com');
  const isBinanceFutures = url.includes('fapi.binance.com');
  
  if (isBinanceSpot || isBinanceFutures) {
    const path = url.split('binance.com')[1];
    let lastError: any;
    
    const endpoints = isBinanceFutures ? BINANCE_FUTURES_ENDPOINTS : BINANCE_ENDPOINTS;
    
    for (let i = 0; i < endpoints.length; i++) {
      try {
        const endpoint = endpoints[i];
        const response = await fetch(`${endpoint}${path}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        // Try next endpoint immediately, no backoff for Binance endpoints
        continue;
      }
    }
    throw lastError || new Error('All Binance endpoints failed');
  }

  // Fallback for non-Binance URLs
  let currentUrl = url;
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(currentUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoff * Math.pow(2, i)));
    }
  }
  throw new Error('Fetch failed after retries');
};
