#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/amenities/refetch_metro.py for backward compatibility."""
import subprocess
import sys

result = subprocess.run(
    [sys.executable, "data/pipelines/amenities/refetch_metro.py"],
    cwd=".",
)
sys.exit(result.returncode)
