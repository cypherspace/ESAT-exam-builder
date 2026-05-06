"""Unit tests for the marker section-detection regexes.

We can't unit-test the bbox/font filters without a real PDF; those land
once fixtures arrive. The section detector is pure-text and high-leverage
so we lock its behaviour in here.
"""

from __future__ import annotations

from pipeline.markers import _detect_section


def test_detects_basic_sections() -> None:
    assert _detect_section("Section: Physics") == "PHYSICS"
    assert _detect_section("CHEMISTRY") == "CHEMISTRY"
    assert _detect_section("Biology paper") == "BIOLOGY"


def test_advanced_maths_wins_over_maths1() -> None:
    # "Advanced Mathematics" must not be eaten by the "Mathematics 1" rule.
    assert _detect_section("Advanced Mathematics") == "ADV_MATHS"


def test_maths1_vs_maths2() -> None:
    assert _detect_section("Mathematics 1") == "MATHS1"
    assert _detect_section("Section: Mathematics 2") == "MATHS2"
    assert _detect_section("Maths Paper 2") == "MATHS2"


def test_no_match_returns_none() -> None:
    assert _detect_section("Time allowed: 80 minutes") is None
    assert _detect_section("") is None
