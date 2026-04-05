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

# Focus on r/bangalore only — broad enough to cover all topics
SUBREDDITS = ["bangalore"]

HEADERS = {"User-Agent": "blr-explorer/1.0"}
SEARCH_URL = "https://www.reddit.com/r/{subreddit}/search.json"
MAX_POSTS = 150          # more posts = better summary
SLEEP_BETWEEN_QUERIES = 4

QUERY_TEMPLATES = [
    '"{name}" living OR rent OR commute OR residents OR review',
    '"{name}" flat OR apartment OR buy OR property OR neighbourhood',
    '"{name}" traffic OR infrastructure OR metro OR safe OR vibe',
]

# Post must mention the neighbourhood AND at least one living-context keyword
CONTEXT_KEYWORDS = {
    "living", "live", "rent", "renting", "commute", "traffic", "area",
    "neighbourhood", "neighborhood", "residents", "locality", "buy",
    "flat", "apartment", "1bhk", "2bhk", "3bhk", "moving", "relocating",
    "infrastructure", "safety", "safe", "road", "metro", "bus",
    "expensive", "affordable", "noisy", "quiet", "walkable", "congestion",
    "review", "experience", "vibe", "culture", "community", "property",
}

# Aspects used to build the summary
ASPECT_GROUPS: dict[str, dict] = {
    "liveability": {
        "keywords": ["peaceful", "quiet", "noisy", "green", "safe", "unsafe", "crime",
                     "walkable", "charm", "vibe", "culture", "community", "pleasant", "lively"],
        "label": "overall vibe and liveability",
    },
    "traffic": {
        "keywords": ["traffic", "commute", "congestion", "jam", "road", "signal",
                     "commuting", "gridlock"],
        "label": "traffic and commute",
    },
    "cost": {
        "keywords": ["rent", "expensive", "affordable", "cost", "price", "resale",
                     "budget", "bhk", "flat", "apartment", "buy", "property"],
        "label": "housing costs",
    },
    "transit": {
        "keywords": ["metro", "bus", "connectivity", "transit", "station", "reach",
                     "accessible", "bmtc"],
        "label": "transit connectivity",
    },
    "amenities": {
        "keywords": ["restaurant", "cafe", "mall", "hospital", "school", "park",
                     "market", "supermarket", "shop"],
        "label": "local amenities",
    },
}


def is_relevant(text: str, neighbourhood: str) -> bool:
    """True only if neighbourhood name + at least one living-context keyword present."""
    lower = text.lower()
    if neighbourhood.lower() not in lower:
        return False
    return any(kw in lower for kw in CONTEXT_KEYWORDS)


def clean_text(text: str) -> str:
    """Strip Reddit markdown so text reads cleanly."""
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\*+([^*]+)\*+", r"\1", text)
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"^\s*>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[\*\-]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def generate_summary(
    neighbourhood: str,
    label: str,
    compound: float,
    posts: list[dict],
    analyser,
) -> str:
    """Build a 2-3 sentence aspect-based summary from scored sentences."""
    # Collect all scored sentences that are relevant
    all_sents: list[dict] = []
    for p in posts:
        body = clean_text(p.get("selftext") or "")
        title = clean_text(p.get("title") or "")
        sources = re.split(r"(?<=[.!?])\s+", body) if body else []
        if title:
            sources.append(title)
        for s in sources:
            s = s.strip()
            if 40 <= len(s) <= 220 and is_relevant(s, neighbourhood):
                vs = analyser.polarity_scores(s)
                all_sents.append({"text": s, "compound": vs["compound"]})

    if not all_sents:
        tone = ("positively" if label == "Positive"
                else "negatively" if label == "Negative"
                else "with mixed views")
        return f"Reddit users in r/bangalore discuss {neighbourhood} {tone}."

    # Map sentences to aspects and compute avg sentiment per aspect
    aspect_scores: dict[str, list[float]] = {k: [] for k in ASPECT_GROUPS}
    for sent in all_sents:
        lower = sent["text"].lower()
        for aspect, info in ASPECT_GROUPS.items():
            if any(kw in lower for kw in info["keywords"]):
                aspect_scores[aspect].append(sent["compound"])

    positives: list[str] = []
    negatives: list[str] = []
    for aspect, scores in aspect_scores.items():
        if not scores:
            continue
        avg = sum(scores) / len(scores)
        if avg >= 0.1:
            positives.append(ASPECT_GROUPS[aspect]["label"])
        elif avg <= -0.1:
            negatives.append(ASPECT_GROUPS[aspect]["label"])

    # Build a natural intro sentence
    if compound >= 0.25:
        intro = f"{neighbourhood} is viewed positively on Reddit."
    elif compound <= -0.1:
        intro = f"Reddit reflects some concerns about {neighbourhood}."
    else:
        intro = f"Reddit shows mixed opinions on {neighbourhood}."

    parts = [intro]

    if positives:
        pos_str = " and ".join(positives[:2])
        parts.append(f"Residents speak well of {pos_str}.")

    if negatives:
        neg_str = " and ".join(negatives[:2])
        parts.append(f"Common concerns include {neg_str}.")

    # If we couldn't extract aspect-level opinions, fall back to best sentence
    if len(parts) == 1:
        best = max(all_sents, key=lambda x: abs(x["compound"]))
        if abs(best["compound"]) > 0.1:
            text = best["text"]
            if len(text) > 180:
                text = text[:177] + "\u2026"
            parts.append(text)

    return " ".join(parts)


def pick_quotes(
    neighbourhood: str,
    posts: list[dict],
    analyser,
    n: int = 3,
) -> list[str]:
    """Pick 2-3 distinct, opinionated sentences that cover different aspects.

    Strategy:
    - Only sentences from post body (selftext), not just titles — so they read
      like real user comments.
    - Must be relevant (neighbourhood + context keyword).
    - Must carry actual opinion (|compound| > 0.15).
    - Prefer sentences that each cover a *different* aspect so the quotes
      illustrate variety (traffic, cost, vibe, etc.).
    - Cap at 180 chars so they're readable as inline quotes.
    """
    # Build scored sentence pool from post bodies
    candidates: list[dict] = []
    seen_keys: set[str] = set()

    for p in posts:
        body = clean_text(p.get("selftext") or "")
        if not body:
            continue  # skip title-only posts for quotes
        sentences = re.split(r"(?<=[.!?])\s+", body)
        for s in sentences:
            s = s.strip()
            if not (50 <= len(s) <= 180):
                continue
            if not is_relevant(s, neighbourhood):
                continue
            key = s.lower()[:60]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            vs = analyser.polarity_scores(s)
            if abs(vs["compound"]) < 0.15:
                continue  # not opinionated enough
            # Tag which aspects this sentence covers
            lower = s.lower()
            aspects = [
                asp for asp, info in ASPECT_GROUPS.items()
                if any(kw in lower for kw in info["keywords"])
            ]
            candidates.append({
                "text": s,
                "compound": vs["compound"],
                "aspects": aspects,
            })

    if not candidates:
        return []

    # Sort by opinion strength
    candidates.sort(key=lambda x: abs(x["compound"]), reverse=True)

    # Greedily pick quotes that cover distinct aspects
    chosen: list[dict] = []
    covered_aspects: set[str] = set()

    # First pass: pick sentences that introduce a new aspect
    for c in candidates:
        if len(chosen) >= n:
            break
        new_aspects = set(c["aspects"]) - covered_aspects
        if new_aspects or not c["aspects"]:
            chosen.append(c)
            covered_aspects.update(c["aspects"])

    # Second pass: fill remaining slots with strongest remaining sentences
    if len(chosen) < n:
        for c in candidates:
            if len(chosen) >= n:
                break
            if c not in chosen:
                chosen.append(c)

    return [c["text"] for c in chosen[:n]]


def fetch_posts(neighbourhood: str) -> list[dict]:
    """Fetch and deduplicate posts from Bangalore subreddits, all time, paginated."""
    seen_ids: set[str] = set()
    posts: list[dict] = []

    for subreddit in SUBREDDITS:
        if len(posts) >= MAX_POSTS:
            break
        for template in QUERY_TEMPLATES:
            if len(posts) >= MAX_POSTS:
                break
            query = template.format(name=neighbourhood)
            after: str | None = None

            for page in range(2):  # up to 2 pages of 100 each
                if len(posts) >= MAX_POSTS:
                    break
                params: dict = {
                    "q": query,
                    "sort": "relevance",
                    "t": "all",        # all time
                    "limit": 100,      # max per page
                    "type": "link",
                    "restrict_sr": "true",
                }
                if after:
                    params["after"] = after

                url = SEARCH_URL.format(subreddit=subreddit)
                fetched = False
                for attempt in range(3):
                    try:
                        r = requests.get(url, params=params, headers=HEADERS, timeout=15)
                        if r.status_code == 429:
                            wait = 30 * (attempt + 1)
                            print(f"  Rate limited — waiting {wait}s…")
                            time.sleep(wait)
                            continue
                        if r.status_code == 404:
                            print(f"  r/{subreddit} not found — skipping")
                            break
                        r.raise_for_status()
                        data = r.json()["data"]
                        children = data["children"]
                        after = data.get("after")  # pagination token
                        for c in children:
                            d = c["data"]
                            post_id = d.get("id", "")
                            text = (d.get("title") or "") + " " + (d.get("selftext") or "")
                            if is_relevant(text, neighbourhood) and post_id not in seen_ids:
                                seen_ids.add(post_id)
                                posts.append(d)
                        fetched = True
                        break
                    except Exception as e:
                        print(f"  WARNING: {subreddit} / {query!r}: {e}")
                        break

                if not fetched or not after:
                    break  # no more pages or fetch failed
                time.sleep(SLEEP_BETWEEN_QUERIES)

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
            "summary": f"Not enough Reddit data found for {neighbourhood} yet.",
            "quotes": [],
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

    summary = generate_summary(neighbourhood, label, compound, posts, analyser)
    quotes = pick_quotes(neighbourhood, posts, analyser)

    return {
        "name": neighbourhood,
        "compound": compound,
        "label": label,
        **labelled,
        "total": len(posts),
        "summary": summary,
        "quotes": quotes,
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
        print(f"     {result['summary']}")
        for q in result["quotes"]:
            print(f"     • {q}")
        time.sleep(2)

    raw_path = out_raw / "sentiment.json"
    web_path = out_web / "sentiment.json"
    for path in (raw_path, web_path):
        path.write_text(json.dumps(results, indent=2))
        print(f"Written {path}")


if __name__ == "__main__":
    main()
