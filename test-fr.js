async function test() {
  const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT');
  const data = await res.json();
  console.log(data);
}
test();
