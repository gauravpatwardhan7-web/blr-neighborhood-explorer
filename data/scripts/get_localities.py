#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/localities/fetch.py for backward compatibility."""
import subprocess
import sys

result = subprocess.run(
    [sys.executable, "data/pipelines/localities/fetch.py"],
    cwd=".",
)
sys.exit(result.returncode)
