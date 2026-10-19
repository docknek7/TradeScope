'use strict';
// Additive V3 UI: V2 storage keys and payload fields remain compatible.
let historyPage=0, historySnapshot='', historyRequest=0, historyScope='';
const historyTime=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false})+'（本地）':'—';
function clearMonitorHistory(){
  historyRequest++;historyPage=0;historySnapshot='';
  $('historyList').replaceChildren();$('monitorHealth').replaceChildren();
  $('historyStatus').textContent='登录后刷新以查看当前账号历史。';
  $('historyPrev').disabled=true;$('historyNext').disabled=true;
}
function renderMonitorControls(){
  $('monitorEnabled').checked=data.monitor?.enabled===true;
  $('monitorTechnical').checked=data.monitor?.technical!==false;
}
for(const id of ['monitorEnabled','monitorTechnical']){
  $(id).onchange=()=>{
    data.monitor={enabled:$('monitorEnabled').checked,technical:$('monitorTechnical').checked,
      generation:crypto.randomUUID()};
    persist();
    $('monitorConfigStatus').textContent=remoteLoaded?'已本地保存；请确认顶部显示“已同步”后后台才会使用新设置。':'已本地保存。请登录并手动上传工作区后才会后台运行。';
  };
}
async function monitorRead(table,params){
  const token=await ensureToken();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(project()+'/rest/v1/'+table+'?'+new URLSearchParams(params),{
      headers:{apikey:cfg.anon,Authorization:'Bearer '+token},signal:controller.signal});
    if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录':response.status===404?'监测表尚未部署，请执行 V3 SQL 迁移':'读取失败（HTTP '+response.status+'），请检查迁移、权限和网络');
    return await response.json();
  }finally{clearTimeout(timer)}
}
async function loadMonitorHistory(reset=false){
  if(reset){historyPage=0;historySnapshot=new Date().toISOString()}
  if(!historySnapshot)historySnapshot=new Date().toISOString();
  const requestId=++historyRequest,scope=cfg.url+'|'+cfg.userId;
  $('historyStatus').textContent='正在读取…';
  $('historyList').replaceChildren();
  $('historyPrev').disabled=true;$('historyNext').disabled=true;
  try{
    if(!cfg.userId||!cfg.token)throw Error('请先在“连接与设置”登录 Supabase');
    const symbol=$('historySymbol').value.trim().toUpperCase();
    if(symbol&&!/^[A-Z][A-Z0-9.-]{0,12}$/.test(symbol))throw Error('请输入有效的股票代码');
    const params={select:'*',order:'bar_at.desc,id.desc',limit:51,offset:historyPage*50,
      user_id:'eq.'+cfg.userId,detected_at:'lte.'+historySnapshot};
    if(symbol)params.symbol='eq.'+symbol;
    const signal=$('historySignal').value;
    if(signal)params.signal='like.'+signal+'*';
    const [rows,health]=await Promise.all([monitorRead('monitor_events',params),
      monitorRead('monitor_state',{select:'symbol,health,updated_at',user_id:'eq.'+cfg.userId,order:'symbol',limit:200})]);
    if(requestId!==historyRequest||scope!==cfg.url+'|'+cfg.userId)return;
    $('historyList').innerHTML=rows.slice(0,50).map(row=>`<article class="record"><div class="recordhead"><strong>${escapeHTML(row.symbol)}</strong><span class="tag">${escapeHTML(row.signal)}</span><strong>${money(row.price)}</strong></div><p>${escapeHTML(row.label)}</p><div class="small">K 线开始：${escapeHTML(historyTime(row.bar_at))}<br>入库时间：${escapeHTML(historyTime(row.detected_at))}<br>来源：${escapeHTML(row.source)} · ${escapeHTML(row.timeframe)} · 仅收盘确认</div><details><summary>指标值</summary><pre>${escapeHTML(JSON.stringify(row.values,null,2))}</pre></details></article>`).join('')||'<p class="empty">暂无匹配事件。首次运行只建立基线；无事件不等于任务已正常运行，请检查下方状态。</p>';
    $('monitorHealth').innerHTML=health.map(row=>`<div class="record"><strong>${escapeHTML(row.symbol)}</strong><p class="small">最近检查：${escapeHTML(historyTime(row.updated_at))}<br>最后已检查 K 线开始：${escapeHTML(historyTime(row.health.last_bar))}<br>本次缺线 ${escapeHTML(row.health.missing_bars)}；连续预热 ${escapeHTML(row.health.warmup_bars)} 根${row.health.baseline?'；本次建立基线':''}</p></div>`).join('')||'<p class="empty">没有后台运行记录。请核对监测开关、云端上传、GitHub Secrets 和 Actions 日志。</p>';
    $('historyStatus').textContent=`第 ${historyPage+1} 页 · ${Math.min(rows.length,50)} 条 · 刷新可获取最新事件`;
    $('historyPrev').disabled=historyPage===0;$('historyNext').disabled=rows.length<=50;
  }catch(error){
    if(requestId!==historyRequest)return;
    $('historyStatus').textContent=error.name==='AbortError'?'请求超时，请重试':error.message;
    $('monitorHealth').replaceChildren();
  }
}
$('historyRefresh').onclick=()=>loadMonitorHistory(true);
$('historyPrev').onclick=()=>{historyPage=Math.max(0,historyPage-1);loadMonitorHistory()};
$('historyNext').onclick=()=>{historyPage++;loadMonitorHistory()};
$('historySymbol').onchange=()=>loadMonitorHistory(true);
$('historySignal').onchange=()=>loadMonitorHistory(true);
document.addEventListener('click',event=>{
  if(event.target.closest('[data-tab="history"]')){renderMonitorControls();loadMonitorHistory(true)}
});
window.addEventListener('tradescope-session',()=>{
  const scope=cfg.url+'|'+cfg.userId;
  if(scope!==historyScope){historyScope=scope;clearMonitorHistory()}
});
window.addEventListener('tradescope-render',renderMonitorControls);
renderMonitorControls();
