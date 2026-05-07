import https from "https";
https.get("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1500", (res) => {
  let data = "";
  res.on("data", (c) => data += c);
  res.on("end", () => console.log(res.statusCode, data));
});
