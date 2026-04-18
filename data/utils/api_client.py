"""Utility functions for making API requests with retry logic."""
import time
import requests
from typing import Any, Dict, Optional


def request_with_retry(
    url: str,
    method: str = "GET",
    max_retries: int = 3,
    timeout: int = 90,
    **kwargs
) -> Dict[str, Any]:
    """Make an HTTP request with automatic retries.

    Args:
        url: Request URL.
        method: HTTP method (GET or POST). Defaults to GET.
        max_retries: Maximum retry attempts. Defaults to 3.
        timeout: Request timeout in seconds. Defaults to 90.
        **kwargs: Additional arguments to pass to requests (data, params, etc.).

    Returns:
        Response JSON as dict.

    Raises:
        Exception: If all retries fail.
    """
    for attempt in range(1, max_retries + 1):
        try:
            if method.upper() == "POST":
                response = requests.post(url, timeout=timeout, **kwargs)
            else:
                response = requests.get(url, timeout=timeout, **kwargs)

            response.raise_for_status()
            return response.json()

        except Exception as e:
            if attempt == max_retries:
                raise

            wait = 10 * attempt
            print(f"  Attempt {attempt} failed ({e}). Retrying in {wait}s...")
            time.sleep(wait)

    return {}


def rate_limited_request(
    url: str,
    method: str = "GET",
    delay: float = 1.0,
    **kwargs
) -> Dict[str, Any]:
    """Make an HTTP request with rate limiting.

    Args:
        url: Request URL.
        method: HTTP method (GET or POST). Defaults to GET.
        delay: Delay in seconds between requests. Defaults to 1.0.
        **kwargs: Additional arguments (timeout, retries, etc.).

    Returns:
        Response JSON as dict.
    """
    response = request_with_retry(url, method, **kwargs)
    time.sleep(delay)
    return response
