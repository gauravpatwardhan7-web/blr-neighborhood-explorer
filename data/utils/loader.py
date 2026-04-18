"""Utility functions for loading locality data."""
import json
from pathlib import Path
from typing import Dict, List, Any


def load_localities() -> List[Dict[str, Any]]:
    """Load locality features from GeoJSON file.

    Returns:
        List of locality feature dictionaries from localities.geojson.
        Each feature has properties: name, lat, lon.
    """
    localities_path = Path("data/raw/localities.geojson")
    with open(localities_path) as f:
        data = json.load(f)
    return data["features"]


def get_locality_names(features: List[Dict[str, Any]]) -> set:
    """Extract all locality names from features.

    Args:
        features: List of GeoJSON feature dicts.

    Returns:
        Set of locality names.
    """
    return {f["properties"]["name"] for f in features}
