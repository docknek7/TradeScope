'use strict';
const $=id=>document.getElementById(id), KEY='tradescope.v2.data', CONFIG='tradescope.v2.config';
const sample=()=>({version:2,stocks:[{symbol:'MU',name:'美光科技',price:872.556,cost:990.79,shares:0,priceAt:'2026-10-15 21:50 (UTC+8)',source:'截图快照',support:'858–862',resistance:'880–885 / 900–910',thesis:'小时图空头排列，超卖但尚未出现明确反转；关注 858 失守风险。'},{symbol:'NVDA',name:'英伟达',price:214.305,cost:234.62,shares:0,priceAt:'2026-10-15 21:50 (UTC+8)',source:'截图快照',support:'211–213',resistance:'217–218 / 220–222',thesis:'此前已减仓约一半；短期不急于补回，观察能否重新站稳 217–218。'},{symbol:'GOOGL',name:'Alphabet',price:349.644,cost:343.47,shares:0,priceAt:'2026-10-15 21:50 (UTC+8)',source:'截图快照',support:'346.5–347',resistance:'349.8–351.4',thesis:'相对强势，分钟级 RSI 偏高；不追涨，关注回踩与突破确认。'}],notes:[{id:'n1',symbol:'MU',title:'关键观察',body:'重新站上 880–885 才能初步改善形态；失守 858 且无法收复则需重新评估风险。',pinned:true,created:'2026-10-15',source:'AI 分析摘要'},{id:'n2',symbol:'NVDA',title:'剩余仓位',body:'不要急于补回此前卖出的 50%；重点观察 211–213 支撑与 217–218 反弹压力。',pinned:true,created:'2026-10-15',source:'AI 分析摘要'},{id:'n3',symbol:'GOOGL',title:'短线管理',body:'现有仓位以持有观察为主，不因一分钟图上涨而追高；观察 346.5–347 回踩支撑。',pinned:true,created:'2026-10-15',source:'AI 分析摘要'}],alerts:[{id:'a1',symbol:'MU',direction:'below',threshold:858,label:'跌破前低，重新评估仓位',enabled:true},{id:'a2',symbol:'NVDA',direction:'below',threshold:213,label:'测试关键支撑，关注能否收复',enabled:true},{id:'a3',symbol:'GOOGL',direction:'above',threshold:351.4,label:'突破短线压力，检查是否有效',enabled:true}]});
function getJSON(key,fallback){try{const v=JSON.parse(localStorage.getItem(key));return v??fallback}catch{return fallback}}
let data=getJSON(KEY,sample()), cfg=getJSON(CONFIG,{url:'',anon:'',token:null,userId:null,marketKey:''}),selected='MU',tab='overview',editType='',editId='',remoteLoaded=false,saveTimer=null;
function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').style.display='none',3500)}
function persist(){localStorage.setItem(KEY,JSON.stringify(data));render();if(cfg.token&&remoteLoaded){clearTimeout(saveTimer);saveTimer=setTimeout(()=>syncUpload(false),900)}else if(cfg.token){status('云端未加载：本地待确认')} }
function status(s){$('syncStatus').textContent=s}
function money(v){return Number.isFinite(+v)?'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}):'—'}
function quoteHealth(s){
  if(s.quoteError)return '更新失败 · 旧报价已过期（'+s.quoteError+'）';
  if(!s.quoteAt)return '未自动更新';
  return Date.now()-s.quoteAt>15*60*1000?'报价超过 15 分钟 · 可能休市或延迟':'已获取报价 · 行情可能延迟';
}
function render(){const stockList=data.stocks||[];if(!stockList.find(s=>s.symbol===selected))selected=stockList[0]?.symbol||'';
$('stockCount').textContent=stockList.length+' 只';
$('stockGrid').innerHTML=stockList.map(s=>{const pct=s.cost>0?((s.price/s.cost-1)*100):null;return `<button class="stock ${selected===s.symbol?'active':''}" data-symbol="${escapeHTML(s.symbol)}" aria-pressed="${selected===s.symbol}"><div class="stockhead"><span class="stockname">${escapeHTML(s.symbol)}</span><span class="tag">${escapeHTML(s.source||'手动输入')}</span></div><div class="price">${money(s.price)}</div><div class="${pct===null?'textmuted':pct>=0?'pos':'neg'}">${pct===null?'未设成本':(pct>0?'+':'')+pct.toFixed(2)+'%（相对成本）'}</div><div class="small">${escapeHTML(s.name)} · ${escapeHTML(s.priceAt||'时间未知')}</div><div class="small quote-health">${escapeHTML(quoteHealth(s))}</div></button>`}).join('')||'<p class="empty">还没有股票，点击“新增股票”。</p>';
const s=stockList.find(x=>x.symbol===selected);$('detailTitle').textContent=s?`${s.symbol} · ${s.name}`:'标的详情';$('quoteBadge').textContent=s?.source||'—';$('detailBody').innerHTML=s?`<p class="small">价格记录时间：${escapeHTML(s.priceAt||'未知')}；${escapeHTML(s.source||'来源未注明')} · ${escapeHTML(quoteHealth(s))}</p><div class="levelgrid"><div class="level"><span class="small">成本价</span><strong>${money(s.cost)}</strong></div><div class="level"><span class="small">手动记录股数</span><strong>${Number(s.shares)||0}</strong></div><div class="level"><span class="small">支持区域</span><strong>${escapeHTML(s.support)}</strong></div><div class="level"><span class="small">压力区域</span><strong>${escapeHTML(s.resistance)}</strong></div></div><p>${escapeHTML(s.thesis)}</p><div class="actions"><button data-stockedit="${escapeHTML(s.symbol)}">编辑持仓和价格</button><button data-stockdelete="${escapeHTML(s.symbol)}">移除股票</button></div>`:'<p class="empty">尚无标的</p>';
$('discipline').innerHTML=(data.notes||[]).filter(n=>n.pinned).slice(0,6).map(n=>`<div class="record pinned"><span class="tag">${escapeHTML(n.symbol)}</span><p>${escapeHTML(n.body)}</p></div>`).join('')||'<p class="empty">可在 AI 结论库置顶重要规则。</p>';
for(let id of ['clipSymbol','filterSymbol']){const old=$(id).value;$(id).innerHTML=(id==='filterSymbol'?'<option value="ALL">全部股票</option>':'')+stockList.map(s=>`<option value="${escapeHTML(s.symbol)}">${escapeHTML(s.symbol)}</option>`).join('');$(id).value=[...$(id).options].some(o=>o.value===old)?old:id==='filterSymbol'?'ALL':selected}
const filter=$('filterSymbol').value; $('notesList').innerHTML=(data.notes||[]).filter(n=>filter==='ALL'||n.symbol===filter).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(b.created).localeCompare(String(a.created))).map(n=>`<article class="record ${n.pinned?'pinned':''}"><div class="recordhead"><span class="tag">${escapeHTML(n.symbol)}</span><strong>${escapeHTML(n.title)}</strong>${n.pinned?'<span class="tag">置顶</span>':''}<span class="subtitle">${escapeHTML(n.created)}</span></div><p>${escapeHTML(n.body)}</p><div class="subtitle">${escapeHTML(n.source||'手工录入')}</div><div class="actions"><button data-pin="${escapeHTML(n.id)}">${n.pinned?'取消置顶':'置顶'}</button><button data-noteedit="${escapeHTML(n.id)}">编辑</button><button data-notedelete="${escapeHTML(n.id)}">删除</button></div></article>`).join('')||'<p class="empty">没有保存的结论。</p>';
$('alertList').innerHTML=(data.alerts||[]).map(a=>`<div class="record"><div class="recordhead"><strong>${escapeHTML(a.symbol)}</strong><span class="tag">${a.direction==='below'?'跌破':'突破'} ${money(a.threshold)}</span><span class="tag">${a.enabled?'启用':'停用'}</span></div><p>${escapeHTML(a.label)}</p><div class="actions"><button data-alerttoggle="${escapeHTML(a.id)}">${a.enabled?'暂停':'恢复'}</button><button data-alertedit="${escapeHTML(a.id)}">编辑</button><button data-alertdelete="${escapeHTML(a.id)}">删除</button></div></div>`).join('')||'<p class="empty">尚未设置价格条件。</p>';
window.dispatchEvent(new Event('tradescope-render'));
}
function openEditor(type,id=''){editType=type;editId=id;let x=type==='stock'?data.stocks.find(s=>s.symbol===id):type==='note'?data.notes.find(n=>n.id===id):data.alerts.find(a=>a.id===id);const field=(name,label,val='',kind='text')=>`<label>${label}<input name="${name}" type="${kind}" value="${escapeHTML(val)}" ${name==='symbol'?'required':''}></label>`;const select=(name,label,opts,val)=>`<label>${label}<select name="${name}">${opts.map(o=>`<option value="${escapeHTML(o[0])}" ${o[0]===val?'selected':''}>${escapeHTML(o[1])}</option>`).join('')}</select></label>`;const symbols=data.stocks.map(s=>[s.symbol,s.symbol]);let html='';if(type==='stock'){html=field('symbol','股票代码（如 MU）',x?.symbol||'')+field('name','公司名称',x?.name||'')+field('chartSymbol','图表代码（可选，例如 NASDAQ:MU 或 NYSE:IBM）',x?.chartSymbol||'')+field('price','参考价格',x?.price||0,'number')+field('cost','持仓均价',x?.cost||0,'number')+field('shares','股数（手动记录）',x?.shares||0,'number')+field('support','支撑区域',x?.support||'')+field('resistance','压力区域',x?.resistance||'')+`<label>交易判断<textarea name="thesis">${escapeHTML(x?.thesis||'')}</textarea></label>`}else if(type==='note'){html=select('symbol','标的',symbols,x?.symbol||selected)+field('title','标题',x?.title||'重要结论')+`<label>内容<textarea name="body" required>${escapeHTML(x?.body||'')}</textarea></label>`+field('source','出处',x?.source||'手工摘录')}else{html=select('symbol','标的',symbols,x?.symbol||selected)+select('direction','价格条件',[['below','价格小于或等于'],['above','价格大于或等于']],x?.direction||'below')+field('threshold','触发价格',x?.threshold||0,'number')+field('label','触发后核查什么',x?.label||'重新检查交易条件')}
$('editHeading').textContent=({stock:'股票与持仓',note:'AI 结论',alert:'价格观察条件'})[type];$('editFields').innerHTML=html;$('editDialog').showModal()}
$('editForm').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));if(editType==='stock'){const symbol=String(v.symbol||'').trim().toUpperCase();if(!/^[A-Z][A-Z0-9.-]{0,12}$/.test(symbol)){toast('股票代码格式不正确');return}if(data.stocks.some(s=>s.symbol===symbol&&s.symbol!==editId)){toast('股票已存在');return}const chartSymbol=String(v.chartSymbol||'').trim().toUpperCase();if(chartSymbol&&!/^(?:[A-Z0-9_]+:)?[A-Z0-9][A-Z0-9._-]{0,24}$/.test(chartSymbol)){toast('图表代码格式不正确');return}const old=data.stocks.find(s=>s.symbol===editId)||{};const item={...old,symbol,chartSymbol,name:v.name,price:Number(v.price),cost:Number(v.cost),shares:Number(v.shares),support:v.support,resistance:v.resistance,thesis:v.thesis,source:editId?old.source:'手动输入',priceAt:editId?old.priceAt:'手动记录 / 未指定时间'};data.stocks=editId?data.stocks.map(s=>s.symbol===editId?item:s):[...data.stocks,item];selected=symbol}else if(editType==='note'){const n={id:editId||crypto.randomUUID(),symbol:v.symbol,title:v.title,body:v.body,source:v.source,created:new Date().toISOString().slice(0,10),pinned:!!data.notes.find(n=>n.id===editId)?.pinned};data.notes=editId?data.notes.map(a=>a.id===editId?n:a):[...data.notes,n]}else{if(!Number.isFinite(+v.threshold)||+v.threshold<=0){toast('价格必须大于 0');return}const a={id:editId||crypto.randomUUID(),symbol:v.symbol,direction:v.direction,threshold:Number(v.threshold),label:v.label,enabled:editId?!!data.alerts.find(a=>a.id===editId)?.enabled:true};data.alerts=editId?data.alerts.map(x=>x.id===editId?a:x):[...data.alerts,a]}$('editDialog').close();persist();toast('已保存')};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;if(d.tab){tab=d.tab;document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('selected',x.dataset.tab===tab));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==`view-${tab}`))}if(d.symbol){selected=d.symbol;render()}if(d.close)$(d.close).close();if(d.stockedit)openEditor('stock',d.stockedit);if(d.stockdelete&&confirm('确定移除该股票？相关收藏和观察条件仍保留。')){data.stocks=data.stocks.filter(s=>s.symbol!==d.stockdelete);persist()}if(d.noteedit)openEditor('note',d.noteedit);if(d.notedelete&&confirm('删除这条结论？')){data.notes=data.notes.filter(n=>n.id!==d.notedelete);persist()}if(d.pin){data.notes.find(n=>n.id===d.pin).pinned=!data.notes.find(n=>n.id===d.pin).pinned;persist()}if(d.alertedit)openEditor('alert',d.alertedit);if(d.alertdelete&&confirm('删除条件？')){data.alerts=data.alerts.filter(a=>a.id!==d.alertdelete);persist()}if(d.alerttoggle){const a=data.alerts.find(a=>a.id===d.alerttoggle);a.enabled=!a.enabled;persist()}});
$('addSymbol').onclick=()=>openEditor('stock');$('newNote').onclick=()=>openEditor('note');$('newAlert').onclick=()=>openEditor('alert');$('filterSymbol').onchange=render;
function saveClip(selectedOnly){const el=$('clipText'),body=selectedOnly?el.value.slice(el.selectionStart,el.selectionEnd).trim():el.value.trim();if(!body){toast(selectedOnly?'请先在文本框中选中文字':'请先粘贴分析文字');return}const n={id:crypto.randomUUID(),symbol:$('clipSymbol').value,title:selectedOnly?'划线摘录':'AI 分析全文',body,source:'聊天内容手动摘录',created:new Date().toISOString().slice(0,10),pinned:selectedOnly};data.notes.push(n);persist();toast('已收藏；可在右侧编辑与置顶')}
$('saveSelection').onclick=()=>saveClip(true);$('saveWhole').onclick=()=>saveClip(false);
$('exportData').onclick=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),data},null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='tradescope-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)};
$('importData').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const json=JSON.parse(await f.text()),p=json.data||json;validateData(p);if(!confirm('导入将覆盖当前数据，确定？'))return;data=p;remoteLoaded=false;persist();toast('已导入本地。若要云端同步请手动上传')}catch(err){toast('导入失败：'+err.message)}e.target.value=''};
function validateData(d){if(!d||!Array.isArray(d.stocks)||!Array.isArray(d.notes)||!Array.isArray(d.alerts)||d.stocks.length>2000||d.notes.length>30000)throw Error('文件结构不符合看板格式')}
$('openSettings').onclick=()=>{$('supabaseUrl').value=cfg.url||'';$('supabaseKey').value=cfg.anon||'';$('finnhubKey').value=cfg.marketKey||'';$('settingsDialog').showModal()};
$('saveCloudConfig').onclick=()=>{const url=$('supabaseUrl').value.trim().replace(/\/$/,'');if(url&&!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)){toast('请填写真实 Supabase 项目 URL');return}const publicKey=$('supabaseKey').value.trim();let privileged=publicKey.startsWith('sb_secret_');try{privileged ||= JSON.parse(atob(publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role'}catch{}if(privileged){toast('禁止在网页保存 service_role / secret key，请仅填写 publishable / anon key');return}const changed=cfg.url!==url||cfg.anon!==$('supabaseKey').value.trim();cfg.url=url;cfg.anon=$('supabaseKey').value.trim();if(changed){cfg.token=null;cfg.userId=null;remoteLoaded=false}saveCfg();toast('连接参数已保存')};
$('saveMarketConfig').onclick=()=>{cfg.marketKey=$('finnhubKey').value.trim();saveCfg();window.dispatchEvent(new Event('tradescope-market-config'));toast('行情设置已保存')};
function saveCfg(){window.dispatchEvent(new Event('tradescope-session'));localStorage.setItem(CONFIG,JSON.stringify(cfg));status(cfg.userId?'已登录 · '+(remoteLoaded?'云端同步已启用':'等待载入云端'):'本地演示模式')}
function project(){if(!cfg.url||!cfg.anon)throw Error('请先配置 Supabase 项目 URL 和 key');return cfg.url}
async function authCall(path,body){
const url=project(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
try{
const r=await fetch(url+'/auth/v1/'+path,{method:'POST',headers:{apikey:cfg.anon,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
let j;try{j=await r.json()}catch(e){if(e.name==='AbortError')throw e;throw Error('认证服务返回异常（HTTP '+r.status+'），请检查项目 URL 和网络后重试')}
if(!r.ok){const error=Error(j.msg||j.error_description||j.message||'认证失败（HTTP '+r.status+'）');error.code=j.code||j.error_code;error.status=r.status;throw error}return j;
}catch(e){if(e.name==='AbortError')throw Error('连接超时，请检查网络及 Supabase 项目状态后重试');if(e instanceof TypeError)throw Error('无法连接 Supabase，请检查网络、项目 URL 和项目是否可用后重试');throw e}finally{clearTimeout(timer)}
}
function accountMessage(message,isError=false){
const el=$('accountStatus');el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.className=isError?'neg':'textmuted';el.textContent=message;
}
function authErrorMessage(e){
const message=e.message||'请求失败，请稍后重试',code=e.code||'';
if(code==='invalid_credentials'||/invalid login credentials/i.test(message))return '邮箱或密码不正确。请检查输入；尚无账号请先注册。';
if(code==='email_not_confirmed'||/email not confirmed/i.test(message))return '邮箱尚未验证，请查收验证邮件（包括垃圾邮件文件夹），完成验证后再登录。';
if(code==='user_already_exists'||/user already registered/i.test(message))return '该邮箱已注册，请使用已有密码登录。';
if(code==='weak_password'||/password should be at least/i.test(message))return '密码不符合要求，请使用至少 6 位且符合项目安全要求的密码。';
if(e.status===429)return '请求过于频繁，请稍后再试。';
if(/invalid api key/i.test(message))return '连接密钥无效，请检查并保存正确的 Supabase Publishable / anon key。';
return message;
}
let authPending=false;
async function submitAuth(signUp=false){
if(authPending)return;
const email=$('email').value.trim(),password=$('password').value;
if(!email||!password){accountMessage('请填写邮箱和密码。',true);return}
if(!$('email').checkValidity()){accountMessage('请输入有效的邮箱地址。',true);return}
authPending=true;
const controls=['signIn','signUp','disconnect','saveCloudConfig','supabaseUrl','supabaseKey','email','password'].map(id=>$(id));
const disabled=controls.map(el=>el.disabled),button=$(signUp?'signUp':'signIn'),label=button.textContent;
controls.forEach(el=>el.disabled=true);button.textContent=signUp?'注册中…':'登录中…';button.setAttribute('aria-busy','true');
accountMessage(signUp?'正在提交注册，请稍候…':'正在登录，请稍候…');
try{
const j=await authCall(signUp?'signup':'token?grant_type=password',{email,password});
if(signUp&&!j.access_token){accountMessage('注册已提交。若需要邮箱验证，请查收验证邮件（包括垃圾邮件文件夹），验证后再登录。');return}
if(!j.access_token)throw Error('认证服务未返回登录凭据，请重试。');
storeToken(j);remoteLoaded=false;
accountMessage('登录成功：'+email+'；正在加载云端数据…');
try{await syncDownload(false)}catch(e){status('已登录 · 云端加载失败');accountMessage('已登录，但云端数据加载失败：'+authErrorMessage(e)+'。可稍后在“数据与备份”重试下载。',true);return}
accountMessage((signUp?'注册并登录成功：':'登录成功：')+email+(remoteLoaded?'；已下载云端数据。':'；云端尚无数据，请到“数据与备份”手动上传。'));
if(!signUp){toast(remoteLoaded?'登录成功，已下载云端数据':'登录成功。云端尚无数据，请到“数据与备份”手动上传');$('settingsDialog').close()}
}catch(e){accountMessage((signUp?'注册失败：':'登录失败：')+authErrorMessage(e),true)}finally{
controls.forEach((el,i)=>el.disabled=disabled[i]);button.textContent=label;button.removeAttribute('aria-busy');authPending=false;
}
}
async function ensureToken(){if(!cfg.token)throw Error('请先登录');if(cfg.token.expires_at&&Date.now()/1000<cfg.token.expires_at-60)return cfg.token.access_token;const j=await authCall('token?grant_type=refresh_token',{refresh_token:cfg.token.refresh_token});storeToken(j);return j.access_token}
function storeToken(j){cfg.token={access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Math.floor(Date.now()/1000)+(j.expires_in||3600)};cfg.userId=j.user?.id||cfg.userId;saveCfg()}
async function dbCall(method,body){const token=await ensureToken();const r=await fetch(project()+'/rest/v1/user_dashboards?on_conflict=user_id',{method,headers:{apikey:cfg.anon,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:method==='POST'?'resolution=merge-duplicates,return=minimal':''},body:body?JSON.stringify(body):undefined});if(!r.ok){const t=await r.text();throw Error('数据库请求失败：'+t.slice(0,180))}return r.status===204?null:r.json()}
async function syncDownload(show=true){if(!cfg.userId)throw Error('请先登录');const r=await dbCall('GET');const row=Array.isArray(r)?r[0]:null;if(row?.payload&&Array.isArray(row.payload.stocks)){validateData(row.payload);data=row.payload;localStorage.setItem(KEY,JSON.stringify(data));remoteLoaded=true;render();status('云端已载入 · '+new Date().toLocaleTimeString());if(show)toast('已从云端下载，覆盖本机数据')}else{remoteLoaded=false;status('云端暂无数据 · 请手动上传本机数据');if(show)toast('云端还没有看板数据；请先上传本机数据')}}
async function syncUpload(show=true){if(!cfg.userId)throw Error('请先登录');try{status('正在同步…');await dbCall('POST',{user_id:cfg.userId,payload:data,updated_at:new Date().toISOString()});remoteLoaded=true;status('已同步 · '+new Date().toLocaleTimeString());if(show)toast('已上传云端')}catch(e){status('同步失败 · 本地数据已保存');if(show)toast(e.message)}}
$('signIn').onclick=()=>submitAuth();
$('signUp').onclick=()=>submitAuth(true);
$('disconnect').onclick=async()=>{cfg.token=null;cfg.userId=null;remoteLoaded=false;saveCfg();$('accountStatus').textContent='已退出；本机缓存仍保留';toast('已退出云端账户（本地缓存未清除）')};
$('uploadNow').onclick=()=>{if(!confirm('将本机全部数据覆盖云端同账号的最新记录，确定？'))return;syncUpload(true)};
$('downloadNow').onclick=()=>{if(!confirm('从云端覆盖本机全部数据？建议先导出备份。'))return;syncDownload(true).catch(e=>toast(e.message))};
render();if(cfg.userId){status('已有登录缓存 · 需重新登录确认云端最新数据');}else{status('本地演示模式')}

// The chart iframe only receives a public symbol, interval and theme, never account data.
let chartIdentity='';
function renderStockChart(force=false){
  const stock=data.stocks.find(s=>s.symbol===selected),host=$('chartHost');
  const theme=document.documentElement.dataset.resolvedTheme==='dark'?'dark':'light';
  const interval=$('chartInterval').value;
  const defaults={MU:'NASDAQ:MU',NVDA:'NASDAQ:NVDA',GOOGL:'NASDAQ:GOOGL'};
  const symbol=stock?(stock.chartSymbol||defaults[stock.symbol]||stock.symbol):'';
  const identity=JSON.stringify([symbol,theme,interval]);
  $('chartTitle').textContent=stock?`${stock.symbol} · ${stock.name||'股票走势'}`:'股票走势';
  $('chartSubtitle').textContent=stock?'独立行情图表 · 可缩放查看历史走势':'添加股票后查看走势';
  $('chartExternal').hidden=!stock;
  if(stock)$('chartExternal').href='https://www.tradingview.com/chart/?symbol='+encodeURIComponent(symbol);
  $('reloadChart').disabled=!stock;$('chartInterval').disabled=!stock;
  if(!force&&chartIdentity===identity)return;
  chartIdentity=identity;host.replaceChildren();
  if(!stock){const empty=document.createElement('p');empty.className='empty';empty.textContent='还没有自选股票。点击左侧“新增股票”开始。';host.appendChild(empty);return}
  const frame=document.createElement('iframe');
  frame.title=stock.symbol+' 股票趋势图（TradingView）';
  // Trusted local wrapper embeds provider code only in a separate remote origin.
  frame.referrerPolicy='no-referrer';
  frame.src='chart.html?'+new URLSearchParams({symbol,theme,interval,v:'20261020'});
  host.appendChild(frame);
}
window.addEventListener('tradescope-render',()=>renderStockChart());
$('chartInterval').onchange=()=>renderStockChart();
$('reloadChart').onclick=()=>renderStockChart(true);
new MutationObserver(()=>renderStockChart()).observe(document.documentElement,{attributes:true,attributeFilter:['data-resolved-theme']});
renderStockChart();
