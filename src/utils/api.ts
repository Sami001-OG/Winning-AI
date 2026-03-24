const BINANCE_ENDPOINTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];

export const fetchWithRetry = async (
  url: string,
  retries = 3,
  backoff = 1000
): Promise<Response> => {
  const isBinance = url.includes('binance.com');
  
  if (isBinance) {
    const path = url.split('binance.com')[1];
    let lastError: any;
    
    for (let i = 0; i < BINANCE_ENDPOINTS.length; i++) {
      try {
        const endpoint = BINANCE_ENDPOINTS[i];
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
