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
  // Rewrite Binance URLs to use our backend proxy to avoid CORS
  let proxyUrl = url;
  if (url.includes('fapi.binance.com/fapi/')) {
    const pathAndQuery = url.split('fapi.binance.com/fapi/')[1];
    proxyUrl = `/api/proxy/fapi/${pathAndQuery}`;
  } else if (url.includes('api.binance.com/api/')) {
    const pathAndQuery = url.split('api.binance.com/api/')[1];
    proxyUrl = `/api/proxy/api/${pathAndQuery}`;
  }

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
      console.log(`Fetching via proxy: ${proxyUrl}`);
      let response = await fetchWithTimeout(proxyUrl);
      
      // If proxy fails (e.g., Railway US IP blocked by Binance), fallback to direct fetch
      if (!response.ok) {
        console.warn(`Proxy failed with status ${response.status}, falling back to direct fetch: ${url}`);
        const fallbackResponse = await fetchWithTimeout(url);
        if (fallbackResponse.ok) {
          return fallbackResponse;
        } else {
          throw new Error(`Direct fetch failed with status: ${fallbackResponse.status}`);
        }
      }
      
      return response;
    } catch (error) {
      const isLastAttempt = i === retries;
      console.error(`Error fetching (attempt ${i + 1}/${retries + 1}):`, error instanceof Error ? error.message : String(error));
      lastError = error;
      
      // If network error on proxy (e.g. CORS or DNS), try direct fetch immediately
      if (error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'))) {
        try {
          console.log(`Network error on proxy, trying direct fetch: ${url}`);
          const directResponse = await fetchWithTimeout(url);
          if (directResponse.ok) {
            return directResponse;
          }
        } catch (directError) {
          console.error(`Direct fetch also failed:`, directError instanceof Error ? directError.message : "Unknown error");
        }
      }
      
      if (isLastAttempt) {
        throw lastError;
      }
    }
    
    // Wait before retrying with jitter
    await new Promise((resolve) => setTimeout(resolve, backoff * Math.pow(2, i) + Math.random() * 1000));
  }
  
  throw lastError || new Error('All endpoints failed');
};
