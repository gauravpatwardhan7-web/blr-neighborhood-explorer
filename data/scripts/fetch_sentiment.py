import json
import time
from pathlib import Path

import requests
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

NEIGHBOURHOODS = [
    "Koramangala",
    "Indiranagar",
    "Bellandur",
    "Sarjapur",
    "Whitefield",
    "Malleshwaram",
]

HEADERS = {"User-Agent": "blr-explorer/1.0"}
SEARCH_URL = "https://www.reddit.com/search.json"
MAX_POSTS = 100


def fetch_posts(neighbourhood: str) -> list[dict]:
    params = {
        "q": f"{neighbourhood} bangalore",
        "sort": "new",
        "limit": MAX_POSTS,
        "type": "link",
    }
    try:
        r = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=15)
        r.raise_for_status()
        children = r.json()["data"]["children"]
        return [c["data"] for c in children]
    except Exception as e:
        print(f"  WARNING: fetch failed for {neighbourhood}: {e}")
        return []


def analyse(neighbourhood: str, analyser: SentimentIntensityAnalyzer) -> dict:
    posts = fetch_posts(neighbourhood)
    if not posts:
        return {
            "name": neighbourhood,
            "compound": 0.0,
            "label": "Neutral",
            "positive": 0,
            "neutral": 0,
            "negative": 0,
            "total": 0,
            "top_posts": [],
        }

    scores = []
    labelled = {"positive": 0, "neutral": 0, "negative": 0}
    for p in posts:
        text = (p.get("title") or "") + " " + (p.get("selftext") or "")
        vs = analyser.polarity_scores(text.strip())
        scores.append(vs["compound"])
        if vs["compound"] >= 0.05:
            labelled["positive"] += 1
        elif vs["compound"] <= -0.05:
            labelled["negative"] += 1
        else:
            labelled["neutral"] += 1

    compound = round(sum(scores) / len(scores), 3)
    label = "Positive" if compound >= 0.05 else ("Negative" if compound <= -0.05 else "Neutral")

    # Top 5 posts ranked by absolute compound score (most opinionated)
    ranked = sorted(
        posts,
        key=lambda p: abs(
            analyser.polarity_scores(
                (p.get("title") or "") + " " + (p.get("selftext") or "")
            )["compound"]
        ),
        reverse=True,
    )
    top_posts = [p["title"] for p in ranked[:5] if p.get("title")]

    return {
        "name": neighbourhood,
        "compound": compound,
        "label": label,
        **labelled,
        "total": len(posts),
        "top_posts": top_posts,
    }


def main():
    out_raw = Path("data/raw")
    out_raw.mkdir(parents=True, exist_ok=True)
    out_web = Path("web/public")
    out_web.mkdir(parents=True, exist_ok=True)

    analyser = SentimentIntensityAnalyzer()
    results = []

    for i, name in enumerate(NEIGHBOURHOODS):
        print(f"Fetching {name}…")
        result = analyse(name, analyser)
        results.append(result)
        print(f"  {result['label']} (compound={result['compound']}, n={result['total']})")
        if i < len(NEIGHBOURHOODS) - 1:
            time.sleep(2)

    raw_path = out_raw / "sentiment.json"
    web_path = out_web / "sentiment.json"
    for path in (raw_path, web_path):
        path.write_text(json.dumps(results, indent=2))
        print(f"Written {path}")


if __name__ == "__main__":
    main()
