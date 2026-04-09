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
  backoff = 2000,
  timeout = 60000
): Promise<Response> => {
  const targetUrl = url;

  const fetchWithTimeout = async (fetchUrl: string) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(fetchUrl, { signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };

  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`Fetching: ${targetUrl}`);
      const response = await fetchWithTimeout(targetUrl);
      
      if (response.status === 418) {
        throw new Error('Rate limited (418)');
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      console.error(`Error fetching ${targetUrl}:`, error);
      lastError = error;
    }
    
    // Wait before retrying with jitter
    await new Promise((resolve) => setTimeout(resolve, backoff * Math.pow(2, i) + Math.random() * 1000));
  }
  
  throw lastError || new Error('All endpoints failed');
};
