"""Unit tests for the MS row regex.

We don't ship a sample MS PDF, so the test exercises the regex directly
via a stub iterator. The full PDF round-trip is covered by integration
tests in the API once we have a sample paper checked into a private
fixtures bucket.
"""

from __future__ import annotations

from pipeline.ms_parser import _ROW_RE


def _scan(lines: list[str]) -> dict[int, str]:
    out: dict[int, str] = {}
    for line in lines:
        m = _ROW_RE.match(line)
        if m:
            out[int(m.group(1))] = m.group(2).upper()
    return out


def test_simple_table_rows() -> None:
    lines = [
        "Question  Answer",
        "1   A",
        "2   B",
        "3   c",
        "4   E",
    ]
    assert _scan(lines) == {1: "A", 2: "B", 3: "C", 4: "E"}


def test_q_prefix_and_separators() -> None:
    lines = [
        "Q1.  D",
        "Q. 2 ) C",
        "3 |  B",
        "4: A",
    ]
    assert _scan(lines) == {1: "D", 2: "C", 3: "B", 4: "A"}


def test_ignores_chatter_and_double_letters() -> None:
    lines = [
        "Total marks: 40",
        "1 AB  (rejected: not a single letter)",
        "12 D some justification",
        "Section 1 ends",
    ]
    assert _scan(lines) == {12: "D"}
