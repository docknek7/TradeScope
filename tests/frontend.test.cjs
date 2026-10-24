const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.confirm=()=>true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.fetch=async()=>{throw Error('Unexpected network request')};
  w.eval(fs.readFileSync('app.js','utf8')+'\n'+fs.readFileSync('monitor.js','utf8')+'\n'+fs.readFileSync('quotes.js','utf8')+`
    window.testAPI={refreshQuotes,setMarketKey:k=>{cfg.marketKey=k},getData:()=>data,setData:d=>{data=d;render()},setSession:()=>{cfg={url:'https://test.supabase.co',anon:'public',userId:'user',token:{access_token:'token',expires_at:Date.now()/1000+3600}};saveCfg()},loadMonitorHistory};`);
  return dom;
}
test('V2 stock editing, note pinning, alert toggles and backups stay available',()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    assert.equal(d.querySelectorAll('#stockGrid .stock').length,3);
    for(const id of ['exportData','importData','saveSelection','saveWhole','uploadNow','downloadNow','refreshQuotes','signIn','signUp'])assert.ok(d.getElementById(id));
    d.querySelector('[data-pin="n1"]').click();
    assert.equal(w.testAPI.getData().notes[0].pinned,false);
    d.querySelector('[data-alerttoggle="a1"]').click();
    assert.equal(w.testAPI.getData().alerts[0].enabled,false);
    d.getElementById('addSymbol').click();
    d.querySelector('[name="symbol"]').value='AAPL';
    d.querySelector('[name="price"]').value='200';
    d.getElementById('editForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
    assert.ok(w.testAPI.getData().stocks.some(s=>s.symbol==='AAPL'));
    assert.equal(JSON.parse(w.localStorage.getItem('tradescope.v2.data')).stocks.length,4);
  }finally{w.close()}
});
test('monitoring opt-in preserves V2 payload and creates new baseline generation',()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    assert.equal(d.getElementById('monitorEnabled').checked,false);
    d.getElementById('monitorEnabled').click();
    const data=w.testAPI.getData();
    assert.equal(data.version,2);
    assert.equal(data.monitor.enabled,true);
    assert.ok(data.monitor.generation);
    assert.equal(data.notes.length,3);
  }finally{w.close()}
});
test('watchlist selection updates isolated chart and details without remounting on note changes',()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    const first=d.querySelector('#chartHost iframe');
    assert.match(first.src,/symbol=NASDAQ%3AMU/);
    assert.ok(first.getAttribute('src').startsWith('chart.html?'));
    const wrapper=fs.readFileSync('chart.html','utf8');
    assert.ok(wrapper.includes('https://www.tradingview-widget.com/embed-widget/advanced-chart/'));
    assert.ok(!wrapper.includes("createElement('script')"));
    d.querySelector('[data-symbol="NVDA"]').click();
    const nvda=d.querySelector('#chartHost iframe');
    assert.match(nvda.src,/symbol=NASDAQ%3ANVDA/);
    assert.match(d.getElementById('detailTitle').textContent,/NVDA/);
    assert.equal(d.querySelector('[data-symbol="NVDA"]').getAttribute('aria-pressed'),'true');
    d.querySelector('[data-pin="n1"]').click();
    assert.equal(d.querySelector('#chartHost iframe'),nvda);
    d.getElementById('chartInterval').value='60';
    d.getElementById('chartInterval').dispatchEvent(new w.Event('change'));
    assert.match(d.querySelector('#chartHost iframe').src,/interval=60/);
    w.testAPI.setData({version:2,stocks:[],notes:[],alerts:[]});
    assert.equal(d.querySelector('#chartHost iframe'),null);
    assert.match(d.getElementById('chartHost').textContent,/还没有/);
  }finally{w.close()}
});
test('history pagination, escaped content, filters and logout clearing',async()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    w.testAPI.setSession();
    const requests=[];
    w.fetch=async url=>{
      requests.push(url);
      return {ok:true,json:async()=>url.includes('monitor_events')?Array.from({length:51},(_,i)=>({symbol:'<img src=x onerror=alert(1)>',signal:'price_above',label:'<script>bad</script>',bar_at:'2026-10-19T14:00:00Z',detected_at:'2026-10-19T14:22:00Z',price:100,source:'alpaca:iex',timeframe:'15Min',values:{close:100},id:i})):[]};
    };
    await w.testAPI.loadMonitorHistory(true);
    assert.equal(d.querySelectorAll('#historyList article').length,50);
    assert.equal(d.querySelector('#historyList img'),null);
    assert.equal(d.getElementById('historyNext').disabled,false);
    assert.equal(d.getElementById('historyPrev').disabled,true);
    d.getElementById('historySymbol').value='MU';
    await w.testAPI.loadMonitorHistory(true);
    assert.ok(requests.some(url=>url.includes('symbol=eq.MU')));
    d.getElementById('disconnect').click();
    assert.equal(d.getElementById('historyList').children.length,0);
  }finally{w.close()}
});
test('failed or logged-out history has actionable message; privileged keys rejected',async()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    await w.testAPI.loadMonitorHistory(true);
    assert.match(d.getElementById('historyStatus').textContent,/请先/);
    d.getElementById('supabaseUrl').value='https://test.supabase.co';
    d.getElementById('supabaseKey').value='sb_secret_forbidden';
    d.getElementById('saveCloudConfig').click();
    assert.match(d.getElementById('toast').textContent,/禁止/);
    assert.equal(w.localStorage.getItem('tradescope.v2.config'),null);
  }finally{w.close()}
});
test('inflight response cannot leak previous account history after logout',async()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    w.testAPI.setSession();
    let release;
    const pending=new Promise(resolve=>release=resolve);
    w.fetch=async()=>{await pending;return {ok:true,json:async()=>[]}};
    const load=w.testAPI.loadMonitorHistory(true);
    d.getElementById('disconnect').click();
    release();await load;
    assert.equal(d.getElementById('historyList').children.length,0);
    assert.match(d.getElementById('historyStatus').textContent,/登录后/);
  }finally{w.close()}
});

test('automatic quotes update price and timestamp but preserve holdings; missing key makes no request',async()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    assert.match(d.getElementById('quoteRefreshStatus').textContent,/填写 Finnhub/);
    const data=w.testAPI.getData();data.stocks=data.stocks.slice(0,1);
    const stock=data.stocks[0],cost=stock.cost;stock.shares=12;
    const stamp=Math.floor(Date.now()/1000);let requests=0;
    w.testAPI.setMarketKey('test-key');
    w.fetch=async(url,opts)=>{requests++;assert.ok(!url.includes('test-key'));assert.equal(opts.headers['X-Finnhub-Token'],'test-key');return {ok:true,json:async()=>({c:900,t:stamp})}};
    await w.testAPI.refreshQuotes(true);
    assert.equal(requests,1);assert.equal(stock.price,900);assert.equal(stock.cost,cost);assert.equal(stock.shares,12);
    assert.equal(stock.quoteAt,stamp*1000);assert.equal(stock.source,'Finnhub 报价');
    assert.match(d.getElementById('stockGrid').textContent,/已获取报价/);
    assert.equal(JSON.parse(w.localStorage.getItem('tradescope.v2.data')).stocks[0].price,900);
  }finally{w.close()}
});
test('failed and invalid quotes retain last price and do not trigger old-price alerts',async()=>{
  const dom=app(),w=dom.window,d=w.document;
  try{
    const data=w.testAPI.getData();data.stocks=data.stocks.slice(0,1);const stock=data.stocks[0],price=stock.price;
    w.testAPI.setMarketKey('secret');
    w.fetch=async()=>{throw Error('network https://example.test?token=secret')};
    await w.testAPI.refreshQuotes(false);
    assert.equal(stock.price,price);assert.equal(stock.quoteError,'网络请求失败');
    assert.match(d.getElementById('stockGrid').textContent,/旧报价已过期/);
    assert.ok(!d.body.textContent.includes('token=secret'));assert.ok(!d.getElementById('toast').textContent.includes('符合观察条件'));
    w.fetch=async()=>({ok:true,json:async()=>({c:0,t:Date.now()/1000})});
    await w.testAPI.refreshQuotes(true);assert.equal(stock.price,price);assert.equal(stock.quoteError,'行情数据无效');
  }finally{w.close()}
});
test('rate limit stops batch and backs off even on manual refresh',async()=>{
  const dom=app(),w=dom.window;
  try{
    w.testAPI.setMarketKey('test');let calls=0;
    w.fetch=async()=>{calls++;return {ok:false,status:429}};
    await w.testAPI.refreshQuotes(true);await w.testAPI.refreshQuotes(false);
    assert.equal(calls,1);assert.equal(w.testAPI.getData().stocks[0].quoteError,'接口限流');
  }finally{w.close()}
});
test('late quotes cannot overwrite a replaced workspace; duplicate refresh is ignored',async()=>{
  const dom=app(),w=dom.window;
  try{
    w.testAPI.setMarketKey('test');let release,calls=0;
    w.fetch=async()=>{calls++;await new Promise(r=>release=r);return {ok:true,json:async()=>({c:999,t:Math.floor(Date.now()/1000)})}};
    const pending=w.testAPI.refreshQuotes(true);await w.testAPI.refreshQuotes(true);
    const next=JSON.parse(JSON.stringify(w.testAPI.getData()));w.testAPI.setData(next);
    release();await pending;assert.equal(calls,1);assert.equal(next.stocks[0].price,872.556);
  }finally{w.close()}
});
test('hidden page pauses automatic polling; older provider timestamps do not replace prices',async()=>{
  const dom=app(),w=dom.window;
  try{
    w.testAPI.setMarketKey('test');let calls=0;
    Object.defineProperty(w.document,'hidden',{configurable:true,value:true});
    w.fetch=async()=>{calls++;return {ok:true,json:async()=>({c:1,t:1})}};
    await w.testAPI.refreshQuotes(true);assert.equal(calls,0);
    Object.defineProperty(w.document,'hidden',{configurable:true,value:false});
    const data=w.testAPI.getData();data.stocks=data.stocks.slice(0,1);data.stocks[0].quoteAt=Date.now();
    await w.testAPI.refreshQuotes(true);
    assert.equal(data.stocks[0].price,872.556);assert.match(data.stocks[0].quoteError,/早于/);
  }finally{w.close()}
});
