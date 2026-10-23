import unittest
from decimal import Decimal
from pullback_v1.core import PaperBroker, Signal, risk_reward, floor_step, public_get

class PullbackSafetyTests(unittest.TestCase):
    def test_public_endpoint_allowlist(self):
        with self.assertRaises(ValueError):
            public_get("/fapi/v1/order")
    def test_one_position_only(self):
        broker=PaperBroker()
        s=Signal("BNBUSDT","LONG",1792764000000,748,746,754,"0.10",2.1)
        self.assertTrue(broker.enter(s))
        self.assertFalse(broker.enter(s))
    def test_stop_first_same_bar(self):
        b=PaperBroker()
        b.enter(Signal("BNBUSDT","LONG",1792764000000,748,746,754,"0.10",2.1))
        ev=b.on_bar({"l":745,"h":756})
        self.assertEqual(ev["reason"],"stop")
        self.assertLess(ev["pnl"],0)
    def test_risk_reward_includes_costs(self):
        self.assertLess(risk_reward(100,99,102,"LONG"),2)
    def test_quantity_rounds_down(self):
        self.assertEqual(floor_step(0.12345,Decimal("0.001")),Decimal("0.123"))
    def test_missing_protection_halting(self):
        b=PaperBroker()
        b.enter(Signal("BNBUSDT","LONG",1792764000000,748,746,754,"0.10",2.1))
        b.position["protected"]=False
        with self.assertRaises(RuntimeError):b.assert_protected()
        self.assertTrue(b.halted)

if __name__=="__main__": unittest.main()
