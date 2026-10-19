# TradeScope V3 · 交易研究与后台监测

保留 V2 全部功能：自选股/持仓、AI 笔记与划线收藏、置顶/筛选、价格观察条件、JSON 备份、Supabase 邮箱登录与跨设备同步、Finnhub 手动报价、浅色/深色/系统主题。

V3 新增：

- GitHub Actions 每 15 分钟计划运行 Python 监测器，使用获授权的 Alpaca 免费 IEX 数据。
- 美股常规时段已收盘 15 分钟 K 线：价格上穿/下穿、RSI(14)、MACD(12,26,9)、EMA(20/50) 穿越。
- Supabase 原子保存事件与指标检查点，唯一键去重，RLS 隔离账号。
- 监测历史页：启用开关、股票/信号筛选、分页、来源/时间与后台健康状态。
- 增量 SQL 迁移、Python/前端/PostgreSQL 测试及无密钥 CI。

## 部署

按 [完整部署与运维指南](DEPLOYMENT.md) 配置 SQL、GitHub Secrets、静态站点和真实运行验收。监测默认关闭；登录、上传工作区并启用后才会处理。静态发布需要 `index.html`、`styles.css`、`app.js`、`monitor.js` 四个文件，无需构建。

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
