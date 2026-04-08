async function test() {
  const res = await fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=2');
  const data = await res.json();
  console.log(data);
}
test();
