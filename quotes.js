'use strict';
// Independent of TradingView and the server-side technical-signal monitor.
let quoteTimer=null, quoteBusy=false, quoteController=null, quoteGeneration=0;
let quoteNextRequest=0, quoteBackoffUntil=0;
const QUOTE_REFRESH_MS=60000, QUOTE_GAP_MS=1200;
function quoteStatus(message){$('quoteRefreshStatus').textContent=message}
function scheduleQuotes(){
  clearTimeout(quoteTimer);
  if(!cfg.marketKey){quoteStatus('自动报价未启用：请在“连接与设置”填写 Finnhub Key');return}
  if(document.hidden){quoteStatus('自动报价已暂停：返回此页面后恢复');return}
  if(Date.now()<quoteBackoffUntil)quoteStatus('接口限流：暂停约 2 分钟后重试，保留上次报价');
  quoteTimer=setTimeout(()=>refreshQuotes(true),Math.max(QUOTE_REFRESH_MS,quoteBackoffUntil-Date.now()));
}
async function refreshQuotes(automatic=false){
  if(quoteBusy)return;
  clearTimeout(quoteTimer);
  if(!cfg.marketKey){scheduleQuotes();if(!automatic)toast('请先在“连接与设置”填写 Finnhub Key');return}
  if(document.hidden&&automatic){scheduleQuotes();return}
  if(Date.now()<quoteBackoffUntil){quoteStatus('接口限流：稍后自动重试，保留上次报价');scheduleQuotes();return}
  const generation=quoteGeneration, workspace=data, key=cfg.marketKey;
  const current=()=>generation===quoteGeneration&&workspace===data&&key===cfg.marketKey;
  const stocks=[...data.stocks], updated=new Set();
  let failures=0;
  quoteBusy=true;
  $('refreshQuotes').disabled=true;$('refreshQuotes').textContent='更新中…';
  quoteStatus('正在从 Finnhub 获取报价…');
  try{
    for(const stock of stocks){
      if(!current()||document.hidden)break;
      const delay=quoteNextRequest-Date.now();
      if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      if(!current()||document.hidden)break;
      quoteNextRequest=Date.now()+QUOTE_GAP_MS;
      quoteController=new AbortController();
      const timeout=setTimeout(()=>quoteController?.abort(),10000);
      let rateLimited=false;
      try{
        const response=await fetch('https://finnhub.io/api/v1/quote?symbol='+encodeURIComponent(stock.symbol),{
          headers:{'X-Finnhub-Token':key},signal:quoteController.signal,cache:'no-store'
        });
        if(response.status===429){rateLimited=true;quoteBackoffUntil=Date.now()+120000;throw Error('接口限流')}
        if(!response.ok)throw Error(response.status===401||response.status===403?'密钥或行情权限不可用':'行情服务暂不可用');
        const q=await response.json();
        if(!Number.isFinite(q.c)||q.c<=0||!Number.isFinite(q.t)||q.t<=0||q.t*1000>Date.now()+60000)throw Error('行情数据无效');
        if(!current()||!data.stocks.includes(stock))continue;
        if(stock.quoteAt&&q.t*1000<stock.quoteAt)throw Error('返回的报价早于已保存报价');
        stock.price=q.c;stock.quoteAt=q.t*1000;
        stock.priceAt=new Date(stock.quoteAt).toLocaleString('zh-CN',{hour12:false})+'（本地时区）';
        stock.source='Finnhub 报价';stock.quoteCheckedAt=Date.now();delete stock.quoteError;
        updated.add(stock.symbol);
      }catch(error){
        if(current()&&data.stocks.includes(stock)){
          // Never surface raw network errors: they may contain request credentials.
          stock.quoteError=error.name==='AbortError'?'请求超时':
            ['接口限流','密钥或行情权限不可用','行情服务暂不可用','行情数据无效','返回的报价早于已保存报价'].includes(error.message)?error.message:'网络请求失败';
          stock.quoteCheckedAt=Date.now();failures++;
        }
      }finally{clearTimeout(timeout);quoteController=null}
      if(rateLimited)break;
    }
    if(current()){
      // Quote polling stays local; explicit edits/uploads retain existing cloud sync behavior.
      localStorage.setItem(KEY,JSON.stringify(data));render();
      $('notice').textContent='左侧报价由 Finnhub 提供，可能延迟；右侧 TradingView 使用独立行情源。自动报价仅在页面可见时运行，后台技术信号由 GitHub Actions 独立处理。';
      quoteStatus(`自动报价：成功 ${updated.size} / ${stocks.length}，失败 ${failures} · ${new Date().toLocaleTimeString()} 检查 · 约每分钟刷新`);
      if(!automatic){
        const triggered=data.alerts.filter(a=>a.enabled&&updated.has(a.symbol)&&data.stocks.some(s=>s.symbol===a.symbol&&Date.now()-s.quoteAt<=900000&&((a.direction==='below'&&s.price<=a.threshold)||(a.direction==='above'&&s.price>=a.threshold))));
        toast(`报价更新 ${updated.size} 只${triggered.length?'；符合观察条件：'+triggered.map(a=>a.symbol+' '+a.label).join('；'):''}`);
      }
    }
  }finally{
    quoteBusy=false;$('refreshQuotes').disabled=false;$('refreshQuotes').textContent='更新报价';scheduleQuotes();
  }
}
$('refreshQuotes').onclick=()=>refreshQuotes(false);
window.addEventListener('tradescope-market-config',()=>{
  quoteGeneration++;quoteController?.abort();quoteBackoffUntil=0;
  if(!quoteBusy)refreshQuotes(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearTimeout(quoteTimer);quoteStatus('自动报价已暂停：返回此页面后恢复')}
  else refreshQuotes(true);
});
refreshQuotes(true);
