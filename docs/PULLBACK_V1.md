# Pullback V1 — paper-only, isolated from TradeScope V3

## Safety
This is research software, not a profitable-strategy claim. There is **no authenticated Binance API**, no live broker, no API-key handling, and no order-placement route. Setting `PULLBACK_LIVE_TRADING=true` terminates execution. Simulated protective stop/target state is **not** an exchange order. Thus exchange-side stop/target reconciliation is *not implemented* and must not be misrepresented as verified.

## Setup
Python 3.12+; no extra packages. From repository root:

```bash
python -m unittest discover -s tests -v
python -m pullback_v1.run --mode scan --symbol BNBUSDT
python -m pullback_v1.run --mode backtest --symbol SOLUSDT
```

The scanner uses only *completed* 1h/15m/5m USDⓈ-M perpetual bars and Binance `exchangeInfo` filters. Signals are conservative and often absent. Allowed pairs: BTC, ETH, BNB, SOL USDT perpetual. The strategy: 1h EMA21/50 trend; 15m EMA21 touch within 0.3 ATR; 5m EMA9 recross confirmation; ATR-buffered structural stop; historic swing target; modeled taker fees 0.05% per side and adverse slippage 0.05% each side. Requires net estimated 2:1, max 1 USDT planned trade loss, notional <=3x available paper equity, no averaging/grid, one open position.

## Backtest limitations
Bar-level simulation cannot determine intrabar event order: both target and stop within a bar count as stop. Uses next bar open for entry, 5m bar high/low for fills, finite history from 500 bars per interval. Fees/slippage are assumptions; outages and gaps can exceed planned risk. Current backtest is a *small smoke-testing research harness*, not robust walk-forward evidence or proof of live viability. Verify exchange filters, candle alignment, duration, look-ahead, overnight exposure and multi-symbol portfolio limits before further development.

## Supabase logging
Run migration `supabase/migrations/202610230001_pullback_paper.sql` manually in Supabase. Optional `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` enable append-only server-side logs; do not set them in browser/CI logs or commit them. If backend logging is configured but fails, process exits nonzero. Local JSONL is always written first. The table grants no user-facing read rights. No integration with existing TradeScope frontend yet.

## Deployment
Use a local terminal or isolated scheduled paper job. **Do not run as real-money order executor** or share trading credentials. Existing TradeScope monitor and GitHub Actions are unchanged. This module does not operate continuously and does not place or check actual exchange protective orders. Exchange-stop reconciliation belongs to a separately reviewed future testnet implementation.
