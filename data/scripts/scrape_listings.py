#!/usr/bin/env python3
"""Wrapper: calls data/pipelines/listings/scrape.py for backward compatibility."""
import subprocess
import sys

# Forward command-line arguments
result = subprocess.run(
    [sys.executable, "data/pipelines/listings/scrape.py"] + sys.argv[1:],
    cwd=".",
)
sys.exit(result.returncode)
