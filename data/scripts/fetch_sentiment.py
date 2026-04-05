import json
import re
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

SUBREDDITS = ["bangalore", "indianrealestate", "india", "personalfinanceindia"]

HEADERS = {"User-Agent": "blr-explorer/1.0"}
SEARCH_URL = "https://www.reddit.com/r/{subreddit}/search.json"
MAX_POSTS = 60
SLEEP_BETWEEN_QUERIES = 3

# Queries force neighbourhood-context keywords so Reddit pre-filters relevance
QUERY_TEMPLATES = [
    '"{name}" living OR rent OR commute OR area OR residents',
    '"{name}" traffic OR buy OR flat OR apartment OR neighbourhood',
]

# Post must contain the neighbourhood name AND at least one living-context keyword
CONTEXT_KEYWORDS = {
    "living", "live", "rent", "renting", "commute", "traffic", "area",
    "neighbourhood", "neighborhood", "residents", "locality", "buy",
    "flat", "apartment", "1bhk", "2bhk", "3bhk", "moving", "relocating",
    "infrastructure", "safety", "safe", "road", "metro", "bus",
    "expensive", "affordable", "noisy", "quiet", "walkable", "congestion",
}


def is_relevant(text: str, neighbourhood: str) -> bool:
    """True only if neighbourhood name + at least one context keyword are present."""
    lower = text.lower()
    if neighbourhood.lower() not in lower:
        return False
    return any(kw in lower for kw in CONTEXT_KEYWORDS)


def clean_text(text: str) -> str:
    """Strip basic Reddit markdown so snippets read cleanly."""
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\*+([^*]+)\*+", r"\1", text)
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"^\s*>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[\*\-]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_snippets(
    posts: list[dict], neighbourhood: str, analyser
) -> list[str]:
    """Extract the most opinionated sentences from post bodies and titles."""
    seen_keys: set[str] = set()
    candidates: list[dict] = []

    for p in posts:
        title = clean_text(p.get("title") or "")
        body = clean_text(p.get("selftext") or "")

        # Prefer body sentences; fall back to the title as a single sentence
        sources = re.split(r"(?<=[.!?])\s+", body) if body else []
        if title:
            sources.append(title)

        post_best: list[dict] = []
        for sent in sources:
            sent = sent.strip()
            if len(sent) < 35 or len(sent) > 280:
                continue
            if not is_relevant(sent, neighbourhood):
                continue
            key = sent.lower()[:60]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            vs = analyser.polarity_scores(sent)
            if abs(vs["compound"]) > 0.05:
                post_best.append({"text": sent, "compound": vs["compound"]})

        post_best.sort(key=lambda x: abs(x["compound"]), reverse=True)
        candidates.extend(post_best[:2])  # at most 2 sentences per post

    candidates.sort(key=lambda x: abs(x["compound"]), reverse=True)
    result = []
    for c in candidates[:4]:
        text = c["text"]
        if len(text) > 160:
            text = text[:157] + "\u2026"
        result.append(text)
    return result


def fetch_posts(neighbourhood: str) -> list[dict]:
    """Fetch subreddit posts relevant to living in the neighbourhood."""
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
                        text = (d.get("title") or "") + " " + (d.get("selftext") or "")
                        if is_relevant(text, neighbourhood) and post_id not in seen_ids:
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
            "snippets": [],
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

    snippets = extract_snippets(posts, neighbourhood, analyser)

    return {
        "name": neighbourhood,
        "compound": compound,
        "label": label,
        **labelled,
        "total": len(posts),
        "snippets": snippets,
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
