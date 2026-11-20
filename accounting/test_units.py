"""Regression checks for the quota-unit conversion.

Guards the bug found 19-nov-2026: euro_per_quota_point() divided 18,14 by the
euro budget (255) while the plan's `pts` are PERCENTAGE points (0-100), which
reported every "EUR of subscription per day" figure 2,55x too low.
Run: python3 accounting/test_units.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import data

PRICE = data.SUBSCRIPTION_PRICE_EUR      # 18,14
BUDGET = data.BUDGET_EUR                 # 255.0


def test_point_is_percentage_scale():
    """1 pp must equal 1% of the budget in subscription terms."""
    expected = PRICE * (1.0 / 100.0)     # 18,14 / 100
    actual = data.euro_per_quota_point()
    assert abs(actual - expected) < 1e-9, f"{actual} != {expected} (wrong divisor again?)"
    # and it must NOT be the old, wrong value
    assert abs(actual - PRICE / BUDGET) > 1e-6, "regressed to dividing by the euro budget"


def test_full_cycle_conversion_is_consistent():
    """100 pp of quota must map to exactly the subscription price."""
    assert abs(100 * data.euro_per_quota_point() - PRICE) < 1e-6


def test_plan_fields_use_the_same_scale():
    plan = data.load_plan()
    eur_per_pp = data.euro_per_quota_point()
    for key in ("required_eur_day", "suggested_eur_day", "required_pts_day", "suggested_pts_day"):
        assert key in plan, f"missing {key} in load_plan()"
    # required_eur_day must be required_pts_day * eur_per_pp (same scale end to end)
    assert abs(plan["required_eur_day"] - plan["required_pts_day"] * eur_per_pp) < 1e-6


def test_annotation_is_generated_not_hardcoded():
    """The chart annotation must be built from the value, never a literal 18,14/255."""
    src = (Path(__file__).resolve().parent / "web_dashboard.py").read_text()
    assert "18,14 € / 255 €" not in src, "hardcoded unit text reintroduced"
    assert "EUR_PER_POINT:.4f" in src, "annotation no longer interpolates the computed value"


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
