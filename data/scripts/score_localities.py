#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/scoring/score.py for backward compatibility."""
import subprocess
import sys

result = subprocess.run(
    [sys.executable, "data/pipelines/scoring/score.py"],
    cwd=".",
)
sys.exit(result.returncode)
