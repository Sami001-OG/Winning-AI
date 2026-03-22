import "dotenv/config";
import { analyzeChart } from "../../src/analysis";

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.2, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0 };

async function sendTelegramSignal(botToken: string, chatId: string, message: string, imageUrl?: string) {
  const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
  let cleanChatId = chatId.replace(/^["']|["']$/g, '').trim();
  
  if (cleanChatId.includes('t.me/')) {
    cleanChatId = cleanChatId.split('t.me/')[1].split('/')[0].split('?')[0];
  }
  
  if (!/^-?\d+$/.test(cleanChatId) && !cleanChatId.startsWith('@')) {
    cleanChatId = '@' + cleanChatId;
  }
  
  const finalToken = cleanToken.toLowerCase().startsWith('bot') 
    ? cleanToken.substring(3) 
    : cleanToken;

  let url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  let body: any = {
    chat_id: cleanChatId,
    text: message,
    parse_mode: 'HTML',
  };

  if (imageUrl) {
    url = `https://api.telegram.org/bot${finalToken}/sendPhoto`;
    body = {
      chat_id: cleanChatId,
      photo: imageUrl,
      caption: message,
      parse_mode: 'HTML',
    };
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  return response.ok;
}

async function fetchTopSymbols() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const data = await res.json();
    return data
      .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.volume) > 0)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 30)
      .map((t: any) => t.symbol);
  } catch (e) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
  }
}

async function fetchKlines(symbol: string, tf: string) {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=250`);
  const data = await res.json();
  return data.map((d: any) => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    isFinal: true
  }));
}

export default async function handler(req: any, res: any) {
  const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.VITE_TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    return res.status(400).json({ error: "Missing Telegram credentials in environment variables" });
  }

  try {
    const symbols = await fetchTopSymbols();
    const timeframes = ['15m', '1h', '4h', '1d'];
    const sentSignals = [];

    // Create an array of all tasks
    const tasks = [];
    for (const symbol of symbols) {
      for (const tf of timeframes) {
        tasks.push({ symbol, tf });
      }
    }

    // Process in batches of 10 to avoid hitting Binance rate limits too hard, but fast enough for Vercel
    const BATCH_SIZE = 10;
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async ({ symbol, tf }) => {
        try {
          const klines = await fetchKlines(symbol, tf);
          const analysis = analyzeChart(klines, DEFAULT_RELIABILITY, [], symbol);
          
          if (analysis.signal !== 'NO TRADE' && analysis.confidence >= 75) {
            // Check if the previous candles also had the same signal to prevent continuous spam
            const prevKlines1 = klines.slice(0, -1);
            const prevAnalysis1 = analyzeChart(prevKlines1, DEFAULT_RELIABILITY, [], symbol);
            
            const prevKlines2 = klines.slice(0, -2);
            const prevAnalysis2 = analyzeChart(prevKlines2, DEFAULT_RELIABILITY, [], symbol);

            const prevKlines3 = klines.slice(0, -3);
            const prevAnalysis3 = analyzeChart(prevKlines3, DEFAULT_RELIABILITY, [], symbol);
            
            const isContinuous = 
              (prevAnalysis1.signal === analysis.signal && prevAnalysis1.confidence >= 70) ||
              (prevAnalysis2.signal === analysis.signal && prevAnalysis2.confidence >= 70) ||
              (prevAnalysis3.signal === analysis.signal && prevAnalysis3.confidence >= 70);

            if (isContinuous) {
              // This is a continuous signal, skip sending an alert
              return;
            }

            const now = new Date();
            const minutes = now.getUTCMinutes();
            const hours = now.getUTCHours();
            
            let shouldSend = false;
            if (tf === '15m' && minutes % 15 === 0) shouldSend = true;
            else if (tf === '1h' && minutes === 0) shouldSend = true;
            else if (tf === '4h' && hours % 4 === 0 && minutes === 0) shouldSend = true;
            else if (tf === '1d' && hours === 0 && minutes === 0) shouldSend = true;

            if (shouldSend || req.query?.force === 'true') {
              const entryPrice = analysis.suggestedEntry || (klines.length > 0 ? klines[klines.length - 1].close : 0);

              const message = `Symbol : ${symbol}
Trade Direction : ${analysis.signal === 'LONG' ? 'Long' : 'Short'}
Entry : ${(entryPrice || 0).toFixed(4)}
TP : ${analysis.tp?.toFixed(4) || 'N/A'}
SL : ${analysis.sl?.toFixed(4) || 'N/A'}
Confidence : ${(analysis.confidence || 0).toFixed(1)}%
Time Frame : ${tf}`;

              const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
              const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
              const imageUrl = analysis.signal === 'LONG' ? bullishImageUrl : bearishImageUrl;

              await sendTelegramSignal(botToken, chatId, message, imageUrl);
              sentSignals.push({ symbol, tf, direction: analysis.signal });
            }
          }
        } catch (err) {
          console.error(`Error processing symbol ${symbol} on ${tf}:`, err);
        }
      }));
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return res.status(200).json({ success: true, sentSignals });
  } catch (err) {
    console.error('Error in cron scan:', err);
    return res.status(500).json({ error: "Internal server error during scan" });
  }
}
