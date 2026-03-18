import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // API Routes
  app.get("/api/symbols", async (req, res) => {
    try {
      const response = await axios.get("https://api.binance.com/api/v3/exchangeInfo");
      const symbols = response.data.symbols
        .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT")
        .map((s: any) => ({
          id: s.symbol,
          name: s.baseAsset
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      
      res.json(symbols);
    } catch (error: any) {
      console.error("Binance Symbols Error:", error.message);
      res.status(500).json({ error: "Failed to fetch symbols" });
    }
  });

  app.get("/api/klines", async (req, res) => {
    try {
      const { symbol = "BTCUSDT", interval = "15m", limit = "500" } = req.query;
      
      const headers: Record<string, string> = {};
      if (process.env.BINANCE_API_KEY) {
        headers["X-MBX-APIKEY"] = process.env.BINANCE_API_KEY;
      }

      const response = await axios.get("https://api.binance.com/api/v3/klines", {
        params: {
          symbol,
          interval,
          limit
        },
        headers
      });

      const candles = response.data.map((k: any) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));

      res.json(candles);
    } catch (error: any) {
      console.error("Binance API Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch data from Binance" });
    }
  });

  // WebSocket Proxy
  wss.on("connection", (ws) => {
    let binanceWs: WebSocket | null = null;

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "SUBSCRIBE") {
          const symbol = data.symbol.toLowerCase();
          const interval = data.interval || "15m";

          if (binanceWs) {
            binanceWs.removeAllListeners();
            if (binanceWs.readyState === WebSocket.OPEN || binanceWs.readyState === WebSocket.CONNECTING) {
              binanceWs.close();
            }
            binanceWs = null;
          }

          const wsUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`;
          binanceWs = new WebSocket(wsUrl);
          
          binanceWs.on("message", (binanceMessage) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            
            try {
              const klineData = JSON.parse(binanceMessage.toString());
              if (!klineData.k) return;
              
              const k = klineData.k;
              const candle = {
                time: new Date(k.t).toISOString(),
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v),
                isFinal: k.x
              };
              ws.send(JSON.stringify({ type: "KLINE_UPDATE", candle }));
            } catch (e) {
              console.error("Error parsing Binance message:", e);
            }
          });

          binanceWs.on("error", (err) => {
            // Ignore "closed before established" errors during rapid switching
            if (err.message?.includes("closed before the connection was established")) {
              return;
            }
            console.error("Binance WS Error:", err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ERROR", message: "Binance WS Error" }));
            }
          });

          binanceWs.on("close", () => {
            binanceWs = null;
          });
        }
      } catch (err) {
        console.error("WS Message Error:", err);
      }
    });

    ws.on("close", () => {
      if (binanceWs) binanceWs.close();
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
