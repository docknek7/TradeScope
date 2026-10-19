import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError

from monitor.engine import advance, clean_bars, cross, evaluate, expected_slots, fingerprint, signals
from monitor.run import Alpaca, configurations, request, run

BASE = datetime(2026, 10, 1, 13, 30, tzinfo=timezone.utc)
CONFIG = {'rules': [{'id': 'a', 'threshold': 100, 'direction': 'above', 'label': 'test'}], 'technical': True}


def fixture(count):
    calendar, bars = [], []
    for i in range(count):
        day, slot = divmod(i, 26)
        start = BASE + timedelta(days=day)
        if slot == 0:
            calendar.append((start, start + timedelta(hours=6, minutes=30)))
        stamp = start + timedelta(minutes=slot * 15)
        bars.append({'t': stamp.isoformat(), 'o': 99, 'h': 101, 'l': 98, 'c': 99, 'v': 10})
    now = datetime.fromisoformat(bars[-1]['t']) + timedelta(minutes=17)
    return bars, calendar, now


def saved(result):
    return {**result, 'revision': 1}


class EngineTests(unittest.TestCase):
    def test_cross_is_transition_not_level(self):
        self.assertEqual(cross(99, 101, 100), 'above')
        self.assertEqual(cross(100, 99, 100), 'below')
        self.assertIsNone(cross(101, 102, 100))
        self.assertIsNone(cross(99, 100, 100))
        self.assertIsNone(cross(None, 101, 100))

    def test_indicator_seeds_and_flat_rsi(self):
        state = {}
        for _ in range(100):
            result = advance(state, 100)
        self.assertEqual(result['rsi'], 50)
        self.assertEqual(result['ema20'], 100)
        self.assertEqual(result['ema50'], 100)
        self.assertEqual(result['histogram'], 0)
        self.assertEqual(advance(state, 110)['rsi'], 100)

    def test_rsi_wilder_reference(self):
        # Wilder example, first 14 gains/losses => RSI ~70.464.
        closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28]
        state = {}
        for close in closes:
            result = advance(state, close)
        self.assertAlmostEqual(result['rsi'], 70.464135, places=5)

    def test_ema_seed_and_recurrence(self):
        state = {}
        for x in range(1, 21):
            result = advance(state, x)
        self.assertEqual(result['ema20'], 10.5)
        self.assertAlmostEqual(advance(state, 21)['ema20'], 11.5)

    def test_all_signal_directions(self):
        low = {'close': 99, 'rsi': 20, 'histogram': -1, 'ema_spread': -1}
        high = {'close': 101, 'rsi': 80, 'histogram': 1, 'ema_spread': 1}
        kinds = [s[0] for s in signals(low, high, CONFIG['rules'], True)]
        self.assertEqual(set(kinds), {'price_above','rsi_30_above','rsi_70_above','macd_above','ema_above'})
        kinds = [s[0] for s in signals(high, low, [], True)]
        self.assertEqual(set(kinds), {'rsi_30_below','rsi_70_below','macd_below','ema_below'})

    def test_bootstrap_replay_and_incremental_events(self):
        bars, calendar, now = fixture(105)
        baseline = evaluate(bars, calendar, now, None, CONFIG, 'user', 'MU')
        self.assertEqual(baseline['events'], [])
        bars2, calendar2, now2 = fixture(107)
        bars2[-2]['c'] = 101
        bars2[-1]['c'] = 101
        result = evaluate(bars2, calendar2, now2, saved(baseline), CONFIG, 'user', 'MU')
        prices = [e for e in result['events'] if e['signal'] == 'price_above']
        self.assertEqual(len(prices), 1)
        self.assertEqual(evaluate(bars2, calendar2, now2, saved(result), CONFIG, 'user', 'MU')['events'], [])
        self.assertEqual(evaluate(bars2, calendar2, now2, saved(baseline), CONFIG, 'user', 'MU')['events'], result['events'])
        self.assertEqual(baseline['state']['close'], 99)  # no mutation

    def test_new_rules_rebaseline(self):
        bars, calendar, now = fixture(105)
        baseline = evaluate(bars, calendar, now, None, CONFIG, 'u', 'MU')
        config = {**CONFIG, 'generation': 'changed'}
        result = evaluate(bars, calendar, now, saved(baseline), config, 'u', 'MU')
        self.assertTrue(result['health']['baseline'])
        self.assertFalse(result['events'])

    def test_missing_bar_never_fabricates_crossing(self):
        bars, calendar, now = fixture(105)
        baseline = evaluate(bars, calendar, now, None, CONFIG, 'u', 'MU')
        bars, calendar, now = fixture(108)
        bars[-1]['c'] = 101
        del bars[-2]
        result = evaluate(bars, calendar, now, saved(baseline), CONFIG, 'u', 'MU')
        self.assertFalse(result['events'])
        self.assertEqual(result['health']['missing_bars'], 1)
        self.assertEqual(result['health']['warmup_bars'], 1)

    def test_unclosed_bar_grace_and_early_close(self):
        calendar = [(BASE, BASE + timedelta(hours=3, minutes=30))]
        self.assertEqual(len(expected_slots(calendar, BASE + timedelta(minutes=16))), 0)
        self.assertEqual(len(expected_slots(calendar, BASE + timedelta(minutes=17))), 1)
        self.assertEqual(len(expected_slots(calendar, BASE + timedelta(days=1))), 14)

    def test_bad_ohlc_and_duplicate(self):
        bars, calendar, now = fixture(1)
        slots = expected_slots(calendar, now)
        with self.assertRaises(ValueError):
            clean_bars([{**bars[0], 'c': float('nan')}], slots)
        with self.assertRaises(ValueError):
            clean_bars([bars[0], {**bars[0], 'c': 100}], slots)
        self.assertEqual(len(clean_bars([bars[0], bars[0]], slots)), 1)

    def test_out_of_order_sorted_and_extended_ignored(self):
        bars, calendar, now = fixture(3)
        bars.append({**bars[0], 't': (BASE-timedelta(minutes=15)).isoformat()})
        a = evaluate(bars, calendar, now, None, CONFIG, 'u', 'MU')
        b = evaluate(list(reversed(bars)), calendar, now, None, CONFIG, 'u', 'MU')
        self.assertEqual(a, b)
        self.assertEqual(a['health']['warmup_bars'], 3)

    def test_correction_rebaselines(self):
        bars, calendar, now = fixture(105)
        baseline = evaluate(bars, calendar, now, None, CONFIG, 'u', 'MU')
        bars[-1]['c'] = 101
        result = evaluate(bars, calendar, now, saved(baseline), CONFIG, 'u', 'MU')
        self.assertTrue(result['health']['baseline'])
        self.assertFalse(result['events'])

    def test_expired_cursor_fails_without_silent_loss(self):
        bars, calendar, now = fixture(2)
        old = {'config_hash': fingerprint(CONFIG), 'state': {'last_bar': (BASE-timedelta(days=40)).isoformat()}}
        with self.assertRaises(ValueError):
            evaluate(bars, calendar, now, old, CONFIG, 'u', 'MU')


class RunnerTests(unittest.TestCase):
    def test_invalid_payloads_are_rejected(self):
        for payload in ([], {'monitor': [1]}, {'monitor': {'enabled': True}, 'stocks': [None]},
                        {'monitor': {'enabled': True}, 'alerts': [None]}):
            with self.assertRaises(ValueError):
                configurations(payload)

    @patch('monitor.run.request')
    def test_calendar_handles_dst(self, call):
        call.return_value = [{'date':'2026-03-06','open':'09:30','close':'16:00'},
                             {'date':'2026-03-09','open':'09:30','close':'16:00'}]
        with patch.dict('os.environ', {'ALPACA_API_KEY_ID':'fake','ALPACA_API_SECRET_KEY':'fake'}):
            calendar = Alpaca().calendar(BASE, BASE)
        self.assertEqual(calendar[0][0].hour, 14)
        self.assertEqual(calendar[1][0].hour, 13)

    def test_opt_in_v2_and_removed_stocks(self):
        payload = {'stocks': [{'symbol': 'MU'}], 'alerts': [{'symbol':'NVDA','enabled':True}]}
        self.assertEqual(configurations(payload), [])
        payload['monitor'] = {'enabled': True}
        self.assertEqual(configurations(payload)[0][1]['rules'], [])

    @patch('monitor.run.request')
    def test_provider_paginates_and_explicit_feed(self, call):
        call.side_effect = [{'bars': {'MU': [{'t': 'a'}]}, 'next_page_token': 'next'}, {'bars': {'MU': [{'t': 'b'}]}}]
        with patch.dict('os.environ', {'ALPACA_API_KEY_ID':'fake','ALPACA_API_SECRET_KEY':'fake'}):
            rows = Alpaca().bars('MU', BASE, BASE)
        self.assertEqual(len(rows), 2)
        self.assertIn('feed=iex', call.call_args_list[0].args[0])
        self.assertIn('page_token=next', call.call_args_list[1].args[0])

    @patch('monitor.run.time.sleep')
    @patch('monitor.run.urlopen')
    def test_retry_rate_limit_and_redact_failure(self, opened, sleep):
        opened.side_effect = HTTPError('https://secret', 429, 'secret', {}, None)
        with self.assertRaisesRegex(RuntimeError, '^HTTP 429$'):
            request('https://test', {})
        self.assertEqual(opened.call_count, 4)
        self.assertEqual(sleep.call_count, 3)

    def test_dry_run_does_not_commit(self):
        from unittest.mock import Mock
        bars, calendar, now = fixture(110)
        db, market = Mock(), Mock()
        db.dashboards.return_value = [{'user_id':'u', 'payload': {'stocks':[{'symbol':'MU'}], 'monitor':{'enabled':True}}}]
        db.state.return_value = None
        market.calendar.return_value = calendar
        market.bars.return_value = bars
        self.assertEqual(run(db, market, now, dry_run=True), 0)
        db.commit.assert_not_called()

    def test_empty_data_fails_without_commit(self):
        from unittest.mock import Mock
        db, market = Mock(), Mock()
        db.dashboards.return_value = [{'user_id':'u', 'payload': {'stocks':[{'symbol':'MU'}], 'monitor':{'enabled':True}}}]
        market.calendar.return_value = [(BASE, BASE+timedelta(hours=6))]
        market.bars.return_value = []
        self.assertEqual(run(db, market, BASE), 1)
        db.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
