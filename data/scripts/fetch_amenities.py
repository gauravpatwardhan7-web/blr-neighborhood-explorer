#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/amenities/fetch.py for backward compatibility."""
import subprocess
import sys

result = subprocess.run(
    [sys.executable, "data/pipelines/amenities/fetch.py"],
    cwd=".",
)
sys.exit(result.returncode)
