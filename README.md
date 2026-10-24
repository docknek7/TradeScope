# TradeScope V3 · 交易研究与后台监测

保留 V2 全部功能：自选股/持仓、AI 笔记与划线收藏、置顶/筛选、价格观察条件、JSON 备份、Supabase 邮箱登录与跨设备同步、Finnhub 手动报价、浅色/深色/系统主题。

V3 新增：

- GitHub Actions 每 15 分钟计划运行 Python 监测器，使用获授权的 Alpaca 免费 IEX 数据。
- 美股常规时段已收盘 15 分钟 K 线：价格上穿/下穿、RSI(14)、MACD(12,26,9)、EMA(20/50) 穿越。
- Supabase 原子保存事件与指标检查点，唯一键去重，RLS 隔离账号。
- 监测历史页：启用开关、股票/信号筛选、分页、来源/时间与后台健康状态。
- 增量 SQL 迁移、Python/前端/PostgreSQL 测试及无密钥 CI。

## 部署

按 [完整部署与运维指南](DEPLOYMENT.md) 配置 SQL、GitHub Secrets、静态站点和真实运行验收。监测默认关闭；登录、上传工作区并启用后才会处理。静态发布需要 `index.html`、`styles.css`、`app.js`、`monitor.js`、`chart.html`、`quotes.js` 六个文件，无需构建。

现有 V2 项目只需执行 [V3 增量迁移](supabase/migrations/202610190001_monitor.sql)；新项目先执行 [V2 schema](schema.sql)。[V2 原始说明](docs/V2.md) 保留作历史参考，其中“无后台监测”描述仅适用于 V2。

## 验证

```sh
python -m unittest discover -s tests -v
npm ci
npm test
```

监测 Python 无第三方运行时依赖（需要系统 IANA 时区库）；Node 依赖仅用于测试。真实行情联调需要自己的 Supabase 与 Alpaca 凭据。

## 边界

IEX 是单交易所，不是全市场实时行情；不支持 A 股/港股或未经授权的数据。仅收盘跨越，缺线不填充，首次建立基线不补发历史告警。GitHub 定时任务可能延迟或遗漏，不能保证准时通知；历史不是交易指令，不自动下单。详细的免费额度、授权、K 线完整性、公司行为、调度和恢复限制见部署指南。

## 股票列表与趋势图

行情页采用左侧竖向自选股列表、右侧趋势图与持仓详情的布局。趋势图使用 [TradingView 官方 Advanced Chart Widget](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/)，不需要 API key；可选择 15 分钟、1 小时、日线、周线，支持浅色/深色主题。图表与 Finnhub 记录价格、后台 Alpaca IEX 数据独立，数据覆盖及延迟以 TradingView 标示为准。不会用截图快照生成历史走势。

图表在隔离的 iframe 中运行，仅传入公开股票代码、周期和主题，不传入持仓、笔记或登录凭据。需要访问 TradingView 域名，网络拦截或标的不支持时可使用外部链接。MU/NVDA/GOOGL 默认指定 NASDAQ，其他股票由提供方解析；可编辑股票填写明确的交易所代码（如 NYSE:IBM），避免同名标的歧义。静态发布时必须一并上传 chart.html。


## 左侧自动报价

静态部署需包含 `quotes.js`。在「连接与设置」填写自己的 Finnhub API Key 并保存，即会获取报价；页面可见时每轮完成约 60 秒后再次刷新，切到后台暂停，返回页面恢复。无需为此新增 GitHub Secrets。密钥只存当前浏览器配置，不随工作区备份或云端上传；仅使用适合个人前端调用的低权限行情密钥，生产服务应使用受保护的后端代理。没有密钥时显示配置提示，不伪造价格。

逐只请求间隔至少 1.2 秒，单次请求超时 10 秒；遇到 HTTP 429 停止本轮并退避 2 分钟。多股票、多个标签页及同一密钥的其他应用会增加用量，请以账户配额为准。价格显示 Finnhub 提供的报价时间（不是请求时间），超过 15 分钟会提示可能休市或延迟；这不是交易所实时性保证。失败时保留上次价格并标记过期，不修改成本和股数。不接受早于已保存报价的数据。

自动刷新只保存本机报价缓存，不每分钟上传整份云端工作区。原有手动上传与编辑同步仍可用。自动报价不触发后台监测事件；GitHub Actions 技术信号继续使用 Alpaca IEX。TradingView 图表数据独立，左右价格可能不同。手动「更新报价」只对本轮成功获取且时间未超过 15 分钟的报价检查本地观察条件。
