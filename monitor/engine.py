"""Pure incremental indicators; state can be persisted without rounding."""
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone


def utc(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timestamp requires timezone')
    return result.astimezone(timezone.utc)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def cross(previous, current, level=0):
    if previous is None or current is None:
        return None
    if previous <= level < current:
        return 'above'
    if previous >= level > current:
        return 'below'
    return None


def ema(state, name, value, period):
    if value is None:
        return None
    item = state.setdefault(name, {'count': 0, 'sum': 0, 'value': None})
    if item['value'] is None:
        item['count'] += 1
        item['sum'] += value
        if item['count'] == period:
            item['value'] = item['sum'] / period
    else:
        item['value'] += 2 / (period + 1) * (value - item['value'])
    return item['value']


def advance(state, close):
    previous = state.get('close')
    fast = ema(state, 'ema12', close, 12)
    slow = ema(state, 'ema26', close, 26)
    short = ema(state, 'ema20', close, 20)
    long = ema(state, 'ema50', close, 50)
    macd = None if slow is None else fast - slow
    signal = ema(state, 'signal9', macd, 9)
    rsi = None
    if previous is not None:
        item = state.setdefault('rsi14', {'count': 0, 'gain': 0, 'loss': 0})
        gain, loss = max(close - previous, 0), max(previous - close, 0)
        if item['count'] < 14:
            item['count'] += 1
            item['gain'] += gain / 14
            item['loss'] += loss / 14
        else:
            item['gain'] = (item['gain'] * 13 + gain) / 14
            item['loss'] = (item['loss'] * 13 + loss) / 14
        if item['count'] == 14:
            rsi = (50 if item['gain'] == 0 else 100) if item['loss'] == 0 else 100 - 100 / (1 + item['gain'] / item['loss'])
    state['close'] = close
    state['count'] = state.get('count', 0) + 1
    result = {'close': close, 'rsi': rsi, 'macd': macd, 'signal': signal,
              'histogram': None if signal is None else macd - signal,
              'ema20': short, 'ema50': long,
              'ema_spread': None if long is None else short - long}
    state['values'] = result
    return result


def signals(previous, current, rules, technical):
    found = []
    for rule in rules:
        direction = cross(previous['close'], current['close'], rule['threshold'])
        if direction == rule['direction']:
            found.append(('price_' + direction, fingerprint(rule), rule['label']))
    if technical:
        for level in (30, 70):
            direction = cross(previous['rsi'], current['rsi'], level)
            if direction:
                found.append((f'rsi_{level}_{direction}', 'rsi14', f'RSI(14) 穿越 {level}'))
        for field, name, label in [('histogram', 'macd', 'MACD(12,26,9) 线穿越信号线'),
                                   ('ema_spread', 'ema', 'EMA(20) 穿越 EMA(50)')]:
            direction = cross(previous[field], current[field])
            if direction:
                found.append((name + '_' + direction, name, label))
    return found


def expected_slots(calendar, now):
    """Calendar supplies DST-aware regular opens/closes, including early closes."""
    slots = []
    for opened, closed in calendar:
        cursor = opened
        while cursor + timedelta(minutes=15) <= closed:
            if cursor + timedelta(minutes=17) <= now:  # 15m bar + 2m settlement grace
                slots.append(cursor)
            cursor += timedelta(minutes=15)
    return sorted(set(slots))


def clean_bars(raw, slots):
    valid_slots = set(slots)
    bars = {}
    for item in raw:
        stamp = utc(item['t'])
        if stamp not in valid_slots:
            continue
        values = [float(item[k]) for k in ('o', 'h', 'l', 'c', 'v')]
        o, h, l, c, v = values
        if not all(math.isfinite(x) for x in values) or min(o, h, l, c) <= 0 or v <= 0 or not l <= min(o, c) <= max(o, c) <= h:
            raise ValueError('invalid OHLCV')
        if stamp in bars and bars[stamp] != c:
            raise ValueError('conflicting duplicate bar')
        bars[stamp] = c
    return bars


def evaluate(raw, calendar, now, saved, config, user_id, symbol):
    """New configuration bootstraps without backfilling historical alerts.

    Missing regular-session bars reset indicators; never forward-fill a price.
    A healthy continuous sequence requires 100 bars before technical signals.
    """
    import copy
    signature = fingerprint(config)
    baseline = not saved or saved['config_hash'] != signature
    state = {} if baseline else copy.deepcopy(saved['state'])
    slots = expected_slots(calendar, now)
    bars = clean_bars(raw, slots)
    last = utc(state['last_bar']) if state.get('last_bar') else None
    if last and slots and last < slots[0]:
        raise ValueError('checkpoint outside recovery window; rebaseline required')
    # Revised/corrected checkpoint: rebuild, suppress retroactive events.
    if last in bars and state.get('close') != bars[last]:
        state, last, baseline = {}, None, True
    events, missing = [], 0
    for stamp in slots:
        if last and stamp <= last:
            continue
        if stamp not in bars:
            missing += 1
            state = {'last_bar': stamp.isoformat()}
            continue
        previous = state.get('values')
        current = advance(state, bars[stamp])
        state['last_bar'] = stamp.isoformat()
        if not baseline and previous:
            for kind, rule, label in signals(previous, current, config['rules'], config['technical'] and state['count'] > 100):
                key = fingerprint([user_id, symbol, signature, stamp.isoformat(), kind, rule])
                events.append({'event_key': key, 'symbol': symbol, 'signal': kind, 'label': label,
                               'bar_at': stamp.isoformat(), 'price': bars[stamp], 'values': current,
                               'source': 'alpaca:iex', 'timeframe': '15Min'})
    return {'config_hash': signature, 'state': state, 'events': events,
            'health': {'missing_bars': missing, 'baseline': baseline, 'warmup_bars': state.get('count', 0),
                       'last_bar': state.get('last_bar'), 'checked_at': now.isoformat()}}
