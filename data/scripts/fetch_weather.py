#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/weather/fetch.py for backward compatibility."""
import subprocess
import sys

result = subprocess.run(
    [sys.executable, "data/pipelines/weather/fetch.py"],
    cwd=".",
)
sys.exit(result.returncode)
