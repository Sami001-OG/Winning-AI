async function test() {
  const res = await fetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1500");
  console.log(res.status, await res.text());
}
test();
