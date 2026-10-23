"""Pullback V1: PAPER ONLY. No signed endpoints, API keys or live orders."""
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN
from urllib.request import urlopen, Request
from urllib.parse import urlencode
import json, math, os, time, uuid

BASE = "https://fapi.binance.com"
SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT")
MAX_RISK = 1.0
DAILY_LIMIT = 3.0
LEVERAGE_CAP = 3.0
FEE = 0.0005           # estimated taker fee EACH side
SLIPPAGE = 0.0005      # estimated adverse execution EACH side
MIN_NET_RR = 2.0

def public_get(path, params=None):
    if not path.startswith("/fapi/v1/") or path not in ("/fapi/v1/klines", "/fapi/v1/exchangeInfo", "/fapi/v1/time"):
        raise ValueError("Public endpoint allowlist only")
    url = BASE + path + ("?" + urlencode(params) if params else "")
    req = Request(url, headers={"User-Agent": "TradeScope-PullbackV1-paper/1.0"})
    with urlopen(req, timeout=12) as response:
        return json.load(response)

def bars(symbol, interval, limit=500):
    if symbol not in SYMBOLS or interval not in ("5m", "15m", "1h"):
        raise ValueError("Unapproved symbol or interval")
    raw = public_get("/fapi/v1/klines", {"symbol": symbol, "interval": interval, "limit": limit})
    # Only COMPLETED bars, evaluated against Binance server time (not local wall clock).
    now = int(public_get("/fapi/v1/time")["serverTime"])
    return [dict(t=int(x[0]), end=int(x[6]), o=float(x[1]), h=float(x[2]),
                 l=float(x[3]), c=float(x[4]), v=float(x[5]))
            for x in raw if int(x[6]) < now]

def ema(values, n):
    out = []; k = 2 / (n + 1)
    for value in values:
        out.append(value if not out else out[-1] + k * (value - out[-1]))
    return out

def atr(data, n=14):
    if len(data) < n + 2:
        raise ValueError("Insufficient ATR history")
    tr = [max(data[i]["h"]-data[i]["l"], abs(data[i]["h"]-data[i-1]["c"]),
              abs(data[i]["l"]-data[i-1]["c"])) for i in range(1, len(data))]
    return sum(tr[-n:]) / n

def filters(info, symbol):
    row = next((r for r in info["symbols"] if r["symbol"] == symbol
                and r["status"] == "TRADING" and r["contractType"] == "PERPETUAL"), None)
    if not row:
        raise ValueError("Symbol not tradable")
    fs = {f["filterType"]: f for f in row["filters"]}
    lot = fs.get("MARKET_LOT_SIZE") or fs["LOT_SIZE"]
    step = Decimal(lot["stepSize"])
    minqty = Decimal(lot["minQty"])
    minnotional = Decimal(str(fs.get("MIN_NOTIONAL", {}).get("notional",
                    fs.get("NOTIONAL", {}).get("minNotional", "5"))))
    return step, minqty, minnotional

def floor_step(value, step):
    return (Decimal(str(value)) / step).to_integral_value(rounding=ROUND_DOWN) * step

def risk_reward(entry, stop, target, side):
    sign = 1 if side == "LONG" else -1
    cost = (entry + target) * (FEE + SLIPPAGE)
    loss_cost = (entry + stop) * (FEE + SLIPPAGE)
    reward = sign * (target - entry) - cost
    risk = sign * (entry - stop) + loss_cost
    return reward / risk if risk > 0 else -1

@dataclass
class Signal:
    symbol: str
    side: str
    timestamp: int
    entry: float
    stop: float
    target: float
    qty: str
    rr: float
    status: str = "PROPOSED"

def signal(symbol, b5, b15, b1, info, equity=50.0):
    """Last closed bar only; no look-ahead. Return None if constraints fail."""
    if min(map(len, (b5, b15, b1))) < 55:
        return None
    p1 = [b["c"] for b in b1]
    e21, e50 = ema(p1, 21)[-1], ema(p1, 50)[-1]
    side = "LONG" if p1[-1] > e21 > e50 else "SHORT" if p1[-1] < e21 < e50 else None
    if not side:
        return None
    p15 = [b["c"] for b in b15]; support = ema(p15, 21)[-1]
    p5 = [b["c"] for b in b5]; fast = ema(p5, 9)
    a = atr(b15); candle = b5[-1]; prior = b5[-2]
    # Recent completed 15m candle must touch EMA21 zone (within 0.3 ATR).
    touched = any(x["l"] <= support + .3*a and x["h"] >= support - .3*a for x in b15[-3:])
    if not touched:
        return None
    if side == "LONG":
        confirm = candle["c"] > candle["o"] and candle["c"] > fast[-1] and prior["c"] <= fast[-2]
        stop = min(x["l"] for x in b15[-4:]) - .15*a
    else:
        confirm = candle["c"] < candle["o"] and candle["c"] < fast[-1] and prior["c"] >= fast[-2]
        stop = max(x["h"] for x in b15[-4:]) + .15*a
    if not confirm:
        return None
    entry = candle["c"]
    distance = (entry-stop) if side == "LONG" else (stop-entry)
    if distance <= 0 or distance < .3*a or distance > 2.5*a:
        return None
    # Historical swing extreme beyond entry must sustain the estimated 2:1 net opportunity.
    highs = [x["h"] for x in b15[-30:-3]]; lows = [x["l"] for x in b15[-30:-3]]
    target = max(highs) if side == "LONG" else min(lows)
    if (target <= entry if side == "LONG" else target >= entry):
        return None
    rr = risk_reward(entry, stop, target, side)
    if rr < MIN_NET_RR:
        return None
    # Conservative capacity: per-order max risk <=1 USDT inclusive of costs.
    unitrisk = distance + (entry + stop) * (FEE + SLIPPAGE)
    capacity = min(MAX_RISK / unitrisk, equity * LEVERAGE_CAP / entry)
    step, minqty, minnotional = filters(info, symbol)
    qty = floor_step(capacity, step)
    if qty < minqty or qty * Decimal(str(entry)) < minnotional:
        return None
    if float(qty) * unitrisk > MAX_RISK + 1e-9:
        return None
    return Signal(symbol, side, candle["end"], entry, stop, target, str(qty), rr)

class PaperBroker:
    """One position globally, worst-case ambiguous bars, no pyramiding."""
    def __init__(self, equity=50.0):
        self.equity = equity
        self.position = None
        self.realized = 0.0
        self.daily_loss = 0.0
        self.day = None
        self.events = []
        self.halted = False

    def emit(self, kind, **data):
        event = {"id": str(uuid.uuid4()), "at": datetime.now(timezone.utc).isoformat(), "kind": kind, **data}
        self.events.append(event)
        return event

    def rollover(self, stamp):
        day = datetime.fromtimestamp(stamp / 1000, timezone.utc).date().isoformat()
        if day != self.day:
            self.day = day
            self.daily_loss = 0.0

    def enter(self, s):
        self.rollover(s.timestamp)
        if self.halted or self.position or self.daily_loss >= DAILY_LIMIT:
            return False
        if s.rr < MIN_NET_RR or float(s.qty) <= 0:
            return False
        self.position = asdict(s)
        self.position["protected"] = True  # simulated OCO state only
        self.emit("paper_entry", **self.position)
        return True

    def on_bar(self, bar):
        if not self.position:
            return None
        s = self.position; side = s["side"]; qty = float(s["qty"])
        stop_hit = (bar["l"] <= s["stop"]) if side == "LONG" else (bar["h"] >= s["stop"])
        target_hit = (bar["h"] >= s["target"]) if side == "LONG" else (bar["l"] <= s["target"])
        if not (stop_hit or target_hit):
            return None
        # Stop-first if both touched in the same bar. Adverse slippage on fills.
        exit_price = s["stop"] if stop_hit else s["target"]
        sign = 1 if side == "LONG" else -1
        executed_entry = s["entry"] * (1 + sign*SLIPPAGE)
        executed_exit = exit_price * (1 - sign*SLIPPAGE)
        pnl = sign * (executed_exit-executed_entry)*qty - (executed_entry+executed_exit)*qty*FEE
        self.realized += pnl
        self.equity += pnl
        self.daily_loss += max(0, -pnl)
        event = self.emit("paper_exit", symbol=s["symbol"], side=side, qty=s["qty"],
                          reason="stop" if stop_hit else "target", pnl=round(pnl, 8),
                          exit=executed_exit, equity=self.equity)
        self.position = None
        if self.daily_loss >= DAILY_LIMIT:
            self.halted = True
            self.emit("risk_halt", reason="daily_loss_limit")
        return event

    def assert_protected(self):
        if self.position and not self.position.get("protected"):
            self.halted = True
            self.emit("risk_halt", reason="paper_protection_missing")
            raise RuntimeError("Missing simulated protective orders")

def backtest(symbol, b5, b15, b1, info, equity=50.0):
    """Walk forward on COMPLETED bars; signal at 5m CLOSE, fill at NEXT bar OPEN."""
    broker = PaperBroker(equity)
    j = k = 0
    for i in range(160, len(b5)-1):
        current = b5[i]
        while j+1 < len(b15) and b15[j+1]["end"] <= current["end"]: j += 1
        while k+1 < len(b1) and b1[k+1]["end"] <= current["end"]: k += 1
        broker.rollover(current["end"])
        if broker.position:
            broker.assert_protected()
            broker.on_bar(current)
            continue
        if j < 54 or k < 54 or broker.halted:
            continue
        s = signal(symbol,b5[:i+1],b15[:j+1],b1[:k+1],info,broker.equity)
        if s:
            # Recalculate entry and geometry to avoid silently filling at signal close.
            next_open=b5[i+1]["o"]
            if abs(next_open-s.entry)/s.entry > .001:
                continue
            s.entry=next_open
            s.rr=risk_reward(s.entry,s.stop,s.target,s.side)
            if s.rr >= MIN_NET_RR: broker.enter(s)
    return broker
