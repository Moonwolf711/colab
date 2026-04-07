"""pytest configuration for cli-anything-max tests."""

from __future__ import annotations

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "e2e: end-to-end test that launches the real Max process "
        "(requires Max 9 to be installed).",
    )
