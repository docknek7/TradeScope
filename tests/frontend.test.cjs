const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test',runScripts:'outside-only'});
  const w=dom.window;
  w.confirm=()=>true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.fetch=async()=>{throw Error('Unexpected network request')};
  w.eval(fs.readFileSync('app.js','utf8')+'\n'+fs.readFileSync('monitor.js','utf8')+`
    window.testAPI={getData:()=>data,setData:d=>{data=d;render()},setSession:()=>{cfg={url:'https://test.supabase.co',anon:'public',userId:'user',token:{access_token:'token',expires_at:Date.now()/1000+3600}};saveCfg()},loadMonitorHistory};`);
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
