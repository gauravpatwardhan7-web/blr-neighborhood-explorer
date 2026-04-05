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

# Subreddits to search — ordered by relevance
SUBREDDITS = ["bangalore", "indianrealestate"]

HEADERS = {"User-Agent": "blr-explorer/1.0"}
SEARCH_URL = "https://www.reddit.com/r/{subreddit}/search.json"
MAX_POSTS = 60
SLEEP_BETWEEN_QUERIES = 3  # seconds — stay well under Reddit's rate limit

# Two targeted queries per neighbourhood is enough; more causes 429s
QUERY_TEMPLATES = [
    '"{name}"',
    '"{name}" OR "{name} area" OR "{name} traffic"',
]


def fetch_posts(neighbourhood: str) -> list[dict]:
    """Fetch posts from targeted subreddits mentioning the neighbourhood."""
    seen_ids: set[str] = set()
    posts: list[dict] = []

    for subreddit in SUBREDDITS:
        if len(posts) >= MAX_POSTS:
            break
        for template in QUERY_TEMPLATES:
            if len(posts) >= MAX_POSTS:
                break
            query = template.format(name=neighbourhood)
            params = {
                "q": query,
                "sort": "relevance",
                "limit": 25,
                "type": "link",
                "restrict_sr": "true",
            }
            url = SEARCH_URL.format(subreddit=subreddit)
            for attempt in range(3):
                try:
                    r = requests.get(url, params=params, headers=HEADERS, timeout=15)
                    if r.status_code == 429:
                        wait = 30 * (attempt + 1)
                        print(f"  Rate limited — waiting {wait}s…")
                        time.sleep(wait)
                        continue
                    r.raise_for_status()
                    children = r.json()["data"]["children"]
                    for c in children:
                        d = c["data"]
                        post_id = d.get("id", "")
                        text = ((d.get("title") or "") + " " + (d.get("selftext") or "")).lower()
                        if neighbourhood.lower() in text and post_id not in seen_ids:
                            seen_ids.add(post_id)
                            posts.append(d)
                    break
                except Exception as e:
                    print(f"  WARNING: {subreddit} / {query!r}: {e}")
                    break
            time.sleep(SLEEP_BETWEEN_QUERIES)

    return posts[:MAX_POSTS]


def analyse(neighbourhood: str, analyser: SentimentIntensityAnalyzer) -> dict:
    posts = fetch_posts(neighbourhood)
    print(f"  Found {len(posts)} relevant posts")

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

    for name in NEIGHBOURHOODS:
        print(f"Fetching {name}…")
        result = analyse(name, analyser)
        results.append(result)
        print(f"  → {result['label']} (compound={result['compound']}, n={result['total']})")
        time.sleep(2)

    raw_path = out_raw / "sentiment.json"
    web_path = out_web / "sentiment.json"
    for path in (raw_path, web_path):
        path.write_text(json.dumps(results, indent=2))
        print(f"Written {path}")


if __name__ == "__main__":
    main()



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
