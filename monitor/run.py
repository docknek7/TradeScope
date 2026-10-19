"""Standard-library-only runner: python -m monitor.run [--dry-run]."""
import argparse
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from .engine import evaluate


def request(url, headers, method='GET', body=None):
    payload = None if body is None else json.dumps(body, allow_nan=False).encode()
    for attempt in range(4):
        try:
            req = Request(url, data=payload, headers={**headers, 'Content-Type': 'application/json'}, method=method)
            with urlopen(req, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as exc:
            # Never print URL, headers, response bodies, or credentials.
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise RuntimeError(f'HTTP {exc.code}') from None
            delay = min(60, int(exc.headers.get('Retry-After', '0'))) if exc.headers.get('Retry-After', '').isdigit() else 0
        except (URLError, TimeoutError):
            if attempt == 3:
                raise RuntimeError('network request failed') from None
            delay = 0
        time.sleep(max(delay, 2 ** attempt))


class Database:
    def __init__(self):
        url = os.environ['SUPABASE_URL'].rstrip('/')
        if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', url):
            raise ValueError('invalid SUPABASE_URL')
        key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
        self.base = url + '/rest/v1/'
        self.headers = {'apikey': key, 'Authorization': 'Bearer ' + key}

    def call(self, path, method='GET', body=None):
        return request(self.base + path, self.headers, method, body)

    def dashboards(self):
        offset = 0
        while True:
            rows = self.call('user_dashboards?select=user_id,payload&order=user_id&limit=100&offset=' + str(offset))
            yield from rows
            if len(rows) < 100:
                break
            offset += len(rows)

    def state(self, user, symbol):
        rows = self.call('monitor_state?' + urlencode({'user_id': 'eq.' + user, 'symbol': 'eq.' + symbol, 'select': '*'}))
        return rows[0] if rows else None

    def commit(self, user, symbol, saved, result):
        return self.call('rpc/commit_monitor_batch', 'POST', {
            'p_user': user, 'p_symbol': symbol, 'p_expected_revision': saved['revision'] if saved else 0,
            'p_config_hash': result['config_hash'], 'p_state': result['state'],
            'p_health': result['health'], 'p_events': result['events']})


class Alpaca:
    def __init__(self):
        self.headers = {'APCA-API-KEY-ID': os.environ['ALPACA_API_KEY_ID'],
                        'APCA-API-SECRET-KEY': os.environ['ALPACA_API_SECRET_KEY']}

    def calendar(self, start, now):
        query = urlencode({'start': start.date().isoformat(), 'end': now.date().isoformat()})
        rows = request('https://paper-api.alpaca.markets/v2/calendar?' + query, self.headers)
        ny = ZoneInfo('America/New_York')
        return [(datetime.fromisoformat(row['date'] + 'T' + row['open']).replace(tzinfo=ny).astimezone(timezone.utc),
                 datetime.fromisoformat(row['date'] + 'T' + row['close']).replace(tzinfo=ny).astimezone(timezone.utc)) for row in rows]

    def bars(self, symbol, start, now):
        params = {'symbols': symbol, 'timeframe': '15Min', 'start': start.isoformat(), 'end': now.isoformat(),
                  'feed': 'iex', 'adjustment': 'raw', 'sort': 'asc', 'limit': 10000}
        result, seen = [], set()
        while True:
            page = request('https://data.alpaca.markets/v2/stocks/bars?' + urlencode(params), self.headers)
            result.extend((page.get('bars') or {}).get(symbol, []))
            token = page.get('next_page_token')
            if not token:
                return result
            if token in seen:
                raise ValueError('repeated market pagination token')
            seen.add(token)
            params['page_token'] = token


def configurations(payload):
    if not isinstance(payload, dict):
        raise ValueError('invalid dashboard')
    monitor = payload.get('monitor') or {}
    if not isinstance(monitor, dict):
        raise ValueError('invalid monitor configuration')
    if monitor.get('enabled') is not True:
        return []
    stocks = payload.get('stocks', [])
    if not isinstance(stocks, list) or len(stocks) > 100:
        raise ValueError('maximum 100 stocks per dashboard')
    if not all(isinstance(s, dict) and isinstance(s.get('symbol'), str) for s in stocks):
        raise ValueError('invalid stocks')
    alerts = payload.get('alerts', [])
    if not isinstance(alerts, list) or not all(isinstance(a, dict) for a in alerts) or len(alerts) > 1000:
        raise ValueError('invalid alerts; maximum 1000')
    result = []
    for symbol in sorted({s['symbol'] for s in stocks}):
        if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,12}', symbol):
            raise ValueError('invalid symbol')
        rules = []
        for a in alerts:
            if a.get('enabled') is not True or a.get('symbol') != symbol:
                continue
            threshold = float(a['threshold'])
            if not math.isfinite(threshold) or threshold <= 0 or a['direction'] not in ('above', 'below'):
                raise ValueError('invalid price rule')
            rules.append({'id': str(a['id']), 'direction': a['direction'], 'threshold': threshold,
                          'label': str(a.get('label', '价格穿越'))[:300]})
        result.append((symbol, {'version': 1, 'feed': 'iex', 'timeframe': '15Min',
                                'technical': monitor.get('technical', True) is True,
                                'generation': str(monitor.get('generation', 'initial')),
                                'rules': sorted(rules, key=lambda x: (x['id'], x['direction'], x['threshold'], x['label']))}))
    return result


def run(db, market, now, dry_run=False):
    start = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
    calendar = None
    cache = {}
    failures, processed, event_count = 0, 0, 0
    for dashboard in db.dashboards():
        try:
            configs = configurations(dashboard['payload'])
        except (KeyError, TypeError, ValueError):
            failures += 1
            print('Invalid dashboard configuration; skipped')
            continue
        for symbol, config in configs:
            try:
                if calendar is None:
                    fetched_calendar = market.calendar(start, now)
                    if not fetched_calendar:
                        raise ValueError('empty market calendar')
                    calendar = fetched_calendar
                if symbol not in cache:
                    if len(cache) >= 200:
                        raise ValueError('maximum 200 unique symbols per run')
                    fetched_bars = market.bars(symbol, start, now)
                    if not fetched_bars:
                        raise ValueError('empty market data; checkpoint unchanged')
                    cache[symbol] = fetched_bars
                saved = db.state(dashboard['user_id'], symbol)
                result = evaluate(cache[symbol], calendar, now, saved, config, dashboard['user_id'], symbol)
                if not dry_run:
                    db.commit(dashboard['user_id'], symbol, saved, result)
                processed += 1
                event_count += len(result['events'])
                if result['health']['missing_bars']:
                    print('Data gaps detected; indicators reset (see monitor health)')
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                failures += 1
                # Exception type only: never dump user payloads or vendor responses.
                print('Symbol failed: ' + type(exc).__name__)
    print(json.dumps({'dry_run': dry_run, 'processed': processed, 'events': event_count, 'failures': failures}))
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='read live data, write nothing')
    args = parser.parse_args()
    try:
        return run(Database(), Alpaca(), datetime.now(timezone.utc), args.dry_run)
    except Exception as exc:
        print('Monitor failed: ' + type(exc).__name__ + '; check Secrets, migrations and provider access')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
