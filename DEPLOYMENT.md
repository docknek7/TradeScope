# TradeScope V3 部署与运维

## 1. 架构与免费方案

静态网页继续使用 V2 的自选股、持仓、笔记、划线收藏、条件、导入导出、主题与 Supabase 登录同步。V3 在原 payload 增加可选 `monitor` 字段，不修改 `tradescope.v2.data` / `tradescope.v2.config` 存储键，也不移动旧数据。`version: 2` 是备份格式版本，不是产品版本。

GitHub Actions → Python 标准库监测器 → Alpaca IEX 15 分钟 K 线与交易日历 → Supabase 原子保存事件及计算状态。前端用登录用户 JWT 读取自己的历史。没有下单、短信、邮件或手机推送。

推荐小规模个人使用：公开代码仓库 + GitHub 标准 Ubuntu runner + 静态站点 + Supabase Free + Alpaca paper 账户的免费 IEX 权限。代码可公开，账户数据与密钥不得提交。账户可用地区、身份要求、套餐和行情授权由服务商决定，免费可运行不代表全球无条件可用。

- [GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)：公开仓库标准 runner 免费；私有仓库按套餐有额度。本配置每天计划 96 次，30 天为 2,880 次，私有仓库可能超过免费分钟数。不要启用付费 runner；核对预算和用量。
- [Supabase 套餐](https://supabase.com/pricing)：按当前项目控制台检查免费数据库、带宽及暂停政策；本实现不自动购买或升级。
- [Alpaca 数据权限](https://docs.alpaca.markets/us/docs/market-data-faq)：IEX 是单交易所数据，不是 SIP 全市场行情。使用本人获准的数据权限，不绕过付费/地区限制，不公开再分发行情。401/403 应检查账户与权限，不能更换参数冒充有权访问。

## 2. Supabase 初始化与增量迁移

1. 新项目启用 Email/Password Auth，配置验证邮件与站点 URL。已有 V2 项目无需迁移工作区。
2. **只有从未安装 V2 的新项目**先在 SQL Editor 执行根目录 `schema.sql`。原 V2 脚本的策略创建不是幂等操作，不要重复执行。
3. 执行 `supabase/migrations/202610190001_monitor.sql`。该增量迁移可重跑，不删除或修改 V2 表；包含事务、索引、RLS、权限和 RPC。
4. 确认 `monitor_events` 与 `monitor_state` 均启用 RLS。`authenticated` 只能 SELECT 自己的数据，不能插入、修改或删除事件和检查点；匿名无访问权。RPC 仅授予 `service_role`，并显式撤销默认 PUBLIC 执行权限。
5. 备份现有数据库。生产执行迁移前可先在单独项目验证；本仓库自动测试用嵌入式 PostgreSQL（PGlite）测试迁移，不会连接你的项目。

事件唯一键是 `(user_id,event_key)`，其中哈希覆盖用户、股票、规则配置、K 线时间和信号类型。`commit_monitor_batch` 用 advisory lock + revision 比较，在一个事务内插入事件和更新状态。任何失败都会回滚；重复事件忽略；并发版本冲突保留已提交数据并让本次任务失败，下一次从数据库继续。此机制不依赖 runner 本地磁盘或 Actions cache。

## 3. GitHub Secrets

在仓库 Settings → Secrets and variables → Actions → Repository secrets 添加：

| 名称 | 值 |
| --- | --- |
| `SUPABASE_URL` | `https://项目标识.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 项目服务端 legacy `service_role` JWT key；本实现使用它访问 REST/RPC |
| `ALPACA_API_KEY_ID` | Alpaca paper 账户 API Key ID |
| `ALPACA_API_SECRET_KEY` | 配套 Secret Key |

使用 paper key，因为监测器从 `paper-api.alpaca.markets/v2/calendar` 获取交易日历；行情来自 `data.alpaca.markets`。Python 代码没有任何交易订单接口。不要把 live trading key 放进来。

服务端 key 绕过 RLS，只能保存在 GitHub Secrets 或本地进程环境变量。绝不能填进网页、提交 `.env`、写入截图、日志、issue 或备份。网页只填 Project URL 与 publishable / anon key；V3 会拒绝 `sb_secret_` 与能识别的 `service_role` JWT。V2 可选 Finnhub 手动报价仍保留，浏览器存储密钥的旧限制仍然适用，与后台 Alpaca 密钥互不关联。

工作流只拥有 `contents: read`，checkout 不保留 Git 凭据，只有运行监测的步骤注入 Secrets。不要将不可信 PR 代码用于带 Secrets 的任务。定期轮换密钥；发生泄露时先撤销旧 key，再更新 Secrets。

## 4. 部署前端与启用

1. 将 `index.html`、`styles.css`、`app.js`、**`monitor.js`**、**`chart.html`**、**`quotes.js`** 发布到同一静态目录。现有 GitHub Pages 根目录部署可直接使用新提交；其他静态托管同理，无需 Node 构建。不要把开发依赖和任何本地环境文件上传。
2. 保留原 V2 localStorage；不要清空浏览器数据。先导出 V2 JSON 备份。打开设置，填写 URL / public key，注册/验证/登录。
3. 云端无工作区时，在“数据与备份”手动上传。已有工作区先下载，避免旧设备覆盖新记录。V2 的“最后写入覆盖”同步语义保持不变，仍应避免多设备同时编辑。
4. 检查自选股与“观察条件”：后台只处理当前自选股中的条件，已移除股票的旧条件不会运行。没有价格条件的股票仍可启用技术信号。
5. 打开“监测历史”，勾选后台监测及所需技术信号，确认顶部显示“已同步”。默认关闭，未上传的本机数据不会被后台读取。
6. V2 旧客户端仍可读取同一 payload，但旧版导入/上传可能覆盖新监测字段；所有设备应升级，覆盖后检查开关。

## 5. 第一次运行与验收

工作流文件必须在默认分支。仓库需要启用 Actions；fork 的定时任务可能需要手动启用。

1. Actions → **TradeScope tests**：确认 Python、前端和 SQL 测试全部通过，无需 Secrets。
2. Actions → **TradeScope monitor** → Run workflow，保持 `dry_run=true`。这会读取真实账户和行情，但不写任何事件/状态。日志只含统计和安全错误类型，不输出密钥、用户 payload 或供应商响应。
3. 检查 summary 的 `processed` 应大于 0，`failures` 应为 0。0 个股票通常是未启用或未上传工作区。缺线提示需结合 IEX 覆盖评估，不等同于价格没有变化。
4. 再手动运行并取消 dry_run。首次只建立计算基线，不补发启动以前的信号。刷新历史页，检查每个股票的检查时间、已检查 K 线时间和预热根数。
5. 后续运行在出现真实跨越时入库。没有跨越时历史为空是正常的。可用单元测试的固定数据验证跨越，不需要伪造生产价格。
6. 重跑同一批数据不应增加历史记录。用两个测试账号分别登录，确认互不可见；不要用 service_role 的 SQL Editor 结果代替 RLS 验证。

**代码提交不等于后台已部署成功。** 必须完成 SQL、Secrets、工作区上传和至少一次非 dry-run 的真实运行；没有实际服务凭据时，自动测试只能证明本地逻辑与模拟集成。

## 6. 调度、K 线与信号定义

Cron 为 `7,22,37,52 * * * *`（UTC），每 15 分钟计划一次，避开整点。例：14:00–14:15 UTC 的 K 线最早在 14:17 具备处理资格，通常在 14:22 计划任务处理。页面时间显示浏览器本地时区，数据库用 UTC，交易时段用 America/New_York 并处理夏令时。

[GitHub 定时任务文档](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)说明调度可能延迟，高负载时甚至丢弃，公开仓库长期无活动也可能停用。这里不是实时价格告警服务，也无 15 分钟到达保证。并发组不取消进行中的任务，额外等待会增加延迟。任务整体超时 10 分钟；网络请求超时 30 秒，429/5xx 指数退避最多四次。

- 每次拉取最近 30 天的 15Min raw IEX bars，完整遍历 `next_page_token`，按时间排序并校验 OHLCV、正价格/成交量和冲突重复。每次抓取同股票仅一次，供多个用户复用；每账户最多 100 个股票，每轮最多 200 个不同股票。
- 使用供应商交易日历的开收盘时间，处理周末、节假日、半日市及 DST；只使用完整的常规时段 K 线，过滤盘前盘后和未满 15 分钟的区间，额外等待 2 分钟。2 分钟不是供应商不可修订保证。
- 缺少应有 K 线可能是无 IEX 成交、停牌、权限或供应商故障。**不填充、插值或复用旧价格**。遇到缺线重置连续计算，下一个真实价格仅成为新基线；技术指标重新预热。无任何行情则失败且保留原检查点；部分缺线会记录健康状态，可能漏掉这些时段信号。
- RSI(14) 使用 Wilder 平滑，零波动为 50、只有上涨为 100；记录穿越 30/70 的两个方向。EMA 用首 N 个值的 SMA 初始化，再按 `2/(N+1)` 更新；MACD(12,26,9) 比较 MACD 线与 signal EMA；EMA 信号比较 EMA20/EMA50。技术信号从连续第 101 根才开始，减少启动偏差，不保证与供应商任意图表完全相同。
- 价格上穿：前收盘 `<= threshold` 且本收盘 `> threshold`；下穿：前收盘 `>= threshold` 且本收盘 `< threshold`。持续在阈值同一侧不触发，盘中穿越又返回不触发。前端 V2 手动报价的 `>= / <=` 即时检查原样保留。
- 首次启用、更改配置/规则或暂停后重启会建立新基线。持续运行时补算检查点以后所有可用 K 线，事件保留 `bar_at`（开始时间）与 `detected_at`（入库时间），方便辨识迟到事件。
- 检查点超出 30 天窗口会失败，不静默跳过；关闭再启用开关并上传，会明确重建基线，旧事件保留。被移除又重新添加的股票若配置未变会恢复原检查点，可通过开关重启强制基线。
- 本版持久化增量指标，而不是每轮滚动窗口重算；检测到**检查点那根**收盘修订会重建基线。更早的供应商修订不自动重放。raw 价格遇拆股等公司行为可能产生机械穿越；应重设价格条件、重建基线并核查公司行为。本版不实现公司行为自动调整，不能把这类事件直接视作买卖信号。
- IEX 非完整全市场数据，与 Finnhub 报价、SIP 图表、复权历史或包含盘前盘后的图表可能不同。不自动切换 SIP、抓取 Yahoo 或绕过权限。

## 7. 测试与本地运行

```sh
python -m unittest discover -s tests -v
npm ci
npm test
node --check app.js
node --check monitor.js
```

Python 3.12+（Linux runner 自带 IANA 时区库）、Node 22+。监测器运行无第三方 Python 依赖；Windows 本地运行如缺少 America/New_York，可用 `python -m pip install tzdata` 补充系统未提供的时区数据。Node 依赖只用于测试，不参与监测和前端部署。

在本地安全地设置上面的四个环境变量后：

```sh
python -m monitor.run --dry-run
python -m monitor.run
python -m http.server 8000
```

最后一条用于浏览器访问静态页面。不要把真实凭据写在可分享的命令示例或 shell 历史中。

测试包括参考 RSI、EMA 种子、所有信号方向、重复运行、变更基线、缺线、提前收盘、未完成 K 线、行情校验、分页、限流、dry-run、空响应，及 JSDOM 的 V2 回归、历史分页/XSS/登出竞态。PGlite 真实 PostgreSQL 测试迁移重跑、唯一键、事务回滚、版本冲突、RLS 和 RPC 权限；不代表已通过生产 PostgREST / Auth / Alpaca 联调。

## 8. 排障、备份与回滚

| 现象 | 检查 |
| --- | --- |
| 历史表 404 | 是否对网页连接的同一项目执行 V3 迁移 |
| 任务失败 | Secrets 名称、项目是否暂停、service_role 是否有效、Alpaca paper calendar / IEX 权限；日志不会输出供应商原始内容 |
| processed=0 | 监测开关、云端上传、工作区是否存在 |
| 缺线多、预热经常归零 | IEX 流动性/停牌/数据缺失；不要人为补线，改用本人获授权且已验证的完整行情接入需要修改代码与数据标记 |
| 检查时间很旧 | Actions 是否禁用/延迟、默认分支、额度、Secrets、运行失败；无事件不等于任务健康 |
| 检查时间新但 K 线旧 | 休市或缺线；同时看预热和缺线数量，本字段是最后检查的预期时段，不保证该时段有有效成交 |
| 暂停很久后失败 | 超出 30 天恢复窗口；重启前端监测开关并上传，重建基线 |
| 重复运行显示失败但事件已存在 | 可能是提交成功后网络响应丢失导致 revision 冲突；下一轮会从数据库继续，唯一键避免重复 |

V2 JSON 导出保留全部原工作区和新增开关；**不包含监测历史或服务器计算状态**。需要完整备份时，从 Supabase 导出 `monitor_events`、`monitor_state` 和原工作区。事件不会自动删除；定期检查表大小，保留期由你决定，删除前先备份。清理历史而保留检查点不会重新补发旧事件。

停止监测：关闭开关并上传（单用户），或在 Actions 禁用 TradeScope monitor（全仓库）。代码回滚至 V2 不需要删除新表；保留表避免丢失历史，新字段会被旧界面忽略。不要回滚或删除 `user_dashboards`。若最终决定移除 V3，先导出表，再由数据库管理员移除新增函数与两张表。

## 股票列表与趋势图

行情页采用左侧竖向自选股列表、右侧趋势图与持仓详情的布局。趋势图使用 [TradingView 官方 Advanced Chart Widget](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/)，不需要 API key；可选择 15 分钟、1 小时、日线、周线，支持浅色/深色主题。图表与 Finnhub 记录价格、后台 Alpaca IEX 数据独立，数据覆盖及延迟以 TradingView 标示为准。不会用截图快照生成历史走势。

图表在隔离的 iframe 中运行，仅传入公开股票代码、周期和主题，不传入持仓、笔记或登录凭据。需要访问 TradingView 域名，网络拦截或标的不支持时可使用外部链接。MU/NVDA/GOOGL 默认指定 NASDAQ，其他股票由提供方解析；可编辑股票填写明确的交易所代码（如 NYSE:IBM），避免同名标的歧义。静态发布时必须一并上传 chart.html。


## 左侧自动报价

静态部署需包含 `quotes.js`。在「连接与设置」填写自己的 Finnhub API Key 并保存，即会获取报价；页面可见时每轮完成约 60 秒后再次刷新，切到后台暂停，返回页面恢复。无需为此新增 GitHub Secrets。密钥只存当前浏览器配置，不随工作区备份或云端上传；仅使用适合个人前端调用的低权限行情密钥，生产服务应使用受保护的后端代理。没有密钥时显示配置提示，不伪造价格。

逐只请求间隔至少 1.2 秒，单次请求超时 10 秒；遇到 HTTP 429 停止本轮并退避 2 分钟。多股票、多个标签页及同一密钥的其他应用会增加用量，请以账户配额为准。价格显示 Finnhub 提供的报价时间（不是请求时间），超过 15 分钟会提示可能休市或延迟；这不是交易所实时性保证。失败时保留上次价格并标记过期，不修改成本和股数。不接受早于已保存报价的数据。

自动刷新只保存本机报价缓存，不每分钟上传整份云端工作区。原有手动上传与编辑同步仍可用。自动报价不触发后台监测事件；GitHub Actions 技术信号继续使用 Alpaca IEX。TradingView 图表数据独立，左右价格可能不同。手动「更新报价」只对本轮成功获取且时间未超过 15 分钟的报价检查本地观察条件。

浏览器直接调用 Finnhub 使用 HTTPS `token` 查询参数，避免自定义鉴权头导致跨域预检失败。密钥可在本机开发者工具的请求 URL 中看到；请勿分享含密钥的网络日志。页面不会显示原始网络异常或请求 URL。
