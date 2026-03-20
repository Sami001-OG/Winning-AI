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
  let currentUrl = url;
  
  // If it's a Binance URL, we can try different endpoints
  const isBinance = url.includes('binance.com');
  
  for (let i = 0; i <= retries; i++) {
    try {
      if (isBinance) {
        // Try different endpoint on each retry if it's a Binance URL
        const endpoint = BINANCE_ENDPOINTS[i % BINANCE_ENDPOINTS.length];
        const path = url.split('binance.com')[1];
        currentUrl = `${endpoint}${path}`;
      }
      
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
