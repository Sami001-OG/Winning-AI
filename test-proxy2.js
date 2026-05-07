async function test() {
  const url = encodeURIComponent('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1500');
  const res = await fetch("https://api.codetabs.com/v1/proxy?quest=" + url);
  console.log(res.status, await res.text());
}
test();
