"""Utility functions for file I/O operations."""
import json
from pathlib import Path
from typing import Any, Dict, List


def ensure_output_dir(path: str = "data/raw") -> Path:
    """Ensure output directory exists.

    Args:
        path: Directory path. Defaults to data/raw.

    Returns:
        Path object for the directory.
    """
    output_dir = Path(path)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def load_json(path: str) -> Any:
    """Load JSON file.

    Args:
        path: File path.

    Returns:
        Parsed JSON data (dict, list, etc.).
    """
    with open(path) as f:
        return json.load(f)


def save_json(data: Any, path: str, indent: int = 2) -> None:
    """Save data to JSON file.

    Args:
        data: Data to save (dict, list, etc.).
        path: Output file path.
        indent: JSON indentation. Defaults to 2.
    """
    with open(path, "w") as f:
        json.dump(data, f, indent=indent)
    print(f"Saved to {path}")


def append_to_json(item: Dict, path: str) -> List[Dict]:
    """Append item to JSON file and save.

    Args:
        item: Dictionary to append.
        path: JSON file path.

    Returns:
        Updated list of items.
    """
    if Path(path).exists():
        items = load_json(path)
    else:
        items = []

    items.append(item)
    save_json(items, path)
    return items


def load_json_resumable(path: str) -> tuple[List[Dict], set]:
    """Load JSON file for resumable operations (skipping already-fetched items).

    Args:
        path: JSON file path.

    Returns:
        Tuple of (loaded items list, set of item names to skip).
    """
    if Path(path).exists():
        items = load_json(path)
        fetched_names = {item["name"] for item in items if "name" in item}
    else:
        items = []
        fetched_names = set()

    return items, fetched_names
