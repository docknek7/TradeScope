"""CLI entrypoint. Explicitly refuses live trading and signed exchange access."""
import argparse, json, os, sys
from pathlib import Path
from .core import SYMBOLS, bars, backtest, public_get, signal, PaperBroker

def append_jsonl(path, events):
    p=Path(path); p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("a",encoding="utf-8") as f:
        for event in events: f.write(json.dumps(event,ensure_ascii=False)+"\n")

def supabase_log(events):
    """Optional append-only events. Failure is fatal; never silently lose logs."""
    url=os.getenv("SUPABASE_URL","").rstrip("/")
    key=os.getenv("SUPABASE_SERVICE_ROLE_KEY","")
    if not url and not key: return
    if not url or not key: raise RuntimeError("Incomplete Supabase environment")
    import urllib.request
    payload=[{"event_id":e["id"],"kind":e["kind"],"payload":e} for e in events]
    if not payload:return
    request=urllib.request.Request(url+"/rest/v1/pullback_paper_events",
         data=json.dumps(payload).encode(),method="POST",
         headers={"apikey":key,"Authorization":"Bearer "+key,
                  "Content-Type":"application/json","Prefer":"return=minimal"})
    with urllib.request.urlopen(request,timeout=15) as r:
        if r.status not in (200,201,204):raise RuntimeError("Supabase write failed")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--symbol",choices=SYMBOLS,default="BNBUSDT")
    parser.add_argument("--mode",choices=["scan","backtest"],default="scan")
    parser.add_argument("--equity",type=float,default=50)
    parser.add_argument("--log",default="data/pullback-paper.jsonl")
    args=parser.parse_args()
    if args.equity<=0:parser.error("equity must be positive")
    if os.getenv("PULLBACK_LIVE_TRADING","").lower() in ("true","1","yes"):
        raise SystemExit("REFUSED: Pullback V1 is paper-only")
    try:
        info=public_get("/fapi/v1/exchangeInfo")
        rows={tf:bars(args.symbol,tf,500) for tf in ("5m","15m","1h")}
        if args.mode=="backtest":
            result=backtest(args.symbol,rows["5m"],rows["15m"],rows["1h"],info,args.equity)
            events=result.events
            print(json.dumps({"mode":"paper_backtest","trades":sum(x["kind"]=="paper_exit" for x in events),
                 "equity":result.equity,"realized":result.realized,"open_position":result.position},indent=2))
        else:
            s=signal(args.symbol,rows["5m"],rows["15m"],rows["1h"],info,args.equity)
            events=[{"id":args.symbol+"-"+str(rows["5m"][-1]["end"]),"kind":"paper_signal",
                     "symbol":args.symbol,"signal":vars(s) if s else None}]
            print(json.dumps(events[0],indent=2))
        append_jsonl(args.log,events)
        supabase_log(events)
    except Exception as exc:
        print("FAIL-CLOSED: "+str(exc),file=sys.stderr)
        raise SystemExit(2)

if __name__=="__main__": main()
