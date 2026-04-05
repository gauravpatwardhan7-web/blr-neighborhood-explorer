"""
fetch_sentiment.py
------------------
Collects real Reddit comment opinions about Bangalore neighbourhoods.

Strategy:
- Search r/bangalore for posts mentioning the neighbourhood
- Filter to posts with score > 3 (upvoted, non-spam)
- For each top post, fetch comment thread and pull top-level comments
- Score everything with VADER
- Build an honest quote-driven summary from actual sentences
- Pick 2-3 quotes that cover distinct aspects (traffic, cost, vibe ...)
"""

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

SUBREDDITS = ["bangalore"]

HEADERS = {"User-Agent": "blr-explorer/1.0"}
SEARCH_URL = "https://www.reddit.com/r/{subreddit}/search.json"
COMMENTS_URL = "https://www.reddit.com/r/{subreddit}/comments/{post_id}.json"

# How many top posts to fetch comments for
TOP_POSTS_FOR_COMMENTS = 8
# Max comments to score across all posts
MAX_COMMENT_SENTENCES = 200
SLEEP_BETWEEN_REQUESTS = 2

QUERY_TEMPLATES = [
    '"{name}" living OR rent OR commute OR residents OR review',
    '"{name}" flat OR apartment OR buy OR property OR neighbourhood',
    '"{name}" traffic OR infrastructure OR metro OR safe OR vibe',
]

# Post/comment must mention neighbourhood AND at least one of these
CONTEXT_KEYWORDS = {
    "living", "live", "rent", "renting", "commute", "traffic", "area",
    "neighbourhood", "neighborhood", "residents", "locality", "buy",
    "flat", "apartment", "1bhk", "2bhk", "3bhk", "moving", "relocating",
    "infrastructure", "safety", "safe", "road", "metro", "bus",
    "expensive", "affordable", "noisy", "quiet", "walkable", "congestion",
    "review", "experience", "vibe", "culture", "community", "property",
    "place", "nice", "terrible", "worst", "best", "horrible", "love",
    "hate", "avoid", "recommend", "would not", "wouldn't", "great",
}

# Phrases that mark a sentence as a request/question rather than an opinion
REQUEST_STARTERS = (
    "looking for", "seeking", "anyone know", "can anyone", "does anyone",
    "where can", "where do", "how do", "how can", "please suggest",
    "suggest me", "wanted to know", "want to know", "need help",
    "need suggestions", "need recommendation", "any suggestions",
    "any recommendations", "any idea", "any good", "is there any",
    "are there any", "could you", "can you", "help me",
    # Information-seeking / hedging starters
    "curious to know", "curious about", "i'm curious", "i am curious",
    "wondering if", "wondering about", "i wonder",
    "now that i've", "now that i have", "i keep hearing",
    "hope to visit", "planning to visit", "would love to visit",
    "i feel like having", "i feel like getting",
    "me and my friend", "me and a friend",
    "so me and", "few days back", "a few days back",
    # First-person request with "I am / I'm" prefix
    "i am looking for", "i'm looking for", "i am seeking", "i'm seeking",
    "i am thinking", "i'm thinking",
    # Third-party housing searches (not resident opinion)
    "my friend is", "my female friend", "my male friend", "my colleague",
    "a friend of mine", "a colleague of mine",
)

# Words that immediately disqualify a sentence (off-topic content)
EXCLUSION_WORDS = {
    "dog", "cat", "pet", "canine", "puppy", "pup", "kitten", "doggo",
    "parrot", "rabbit", "guinea", "bird", "foster", "adoption",
    "vaccinated", "dewormed", "potty",
    "gaming", "playstation", "xbox", "fifa", "game ",
}

# Phrases that immediately disqualify a sentence even if in the middle
SENTENCE_EXCLUDES = (
    "please share", "please post", "please do share", "please spread",
    "please let us know", "please let me know", "please recommend",
    "hope the driver", "hope he is", "hope she is", "hope they are",
    "hope everyone", "hope everyone is",
    "would love to get suggestions", "love to get suggestions",
    "is planning to take", "is planning to rent", "is planning to move",
    "i am thinking if", "i'm thinking if",
)

ASPECT_GROUPS: dict[str, dict] = {
    "liveability": {
        "keywords": ["peaceful", "quiet", "noisy", "green", "safe", "unsafe", "crime",
                     "walkable", "charm", "vibe", "culture", "community", "pleasant",
                     "lively", "nice", "terrible", "worst", "best", "horrible",
                     "love", "hate", "avoid", "recommend", "great"],
        "label": "overall vibe and liveability",
    },
    "traffic": {
        "keywords": ["traffic", "commute", "congestion", "jam", "signal",
                     "commuting", "gridlock", "stuck", "bumper"],
        "label": "traffic and commute",
    },
    "cost": {
        "keywords": ["rent", "expensive", "affordable", "cost", "price", "resale",
                     "budget", "bhk", "flat", "apartment", "buy", "property", "rents",
                     "increased", "rising", "hike"],
        "label": "housing costs",
    },
    "transit": {
        "keywords": ["metro", "bus", "connectivity", "transit", "station", "reach",
                     "accessible", "bmtc", "auto", "cab"],
        "label": "transit connectivity",
    },
    "amenities": {
        "keywords": ["restaurant", "cafe", "mall", "hospital", "school", "park",
                     "market", "supermarket", "shop", "food", "water", "power",
                     "electricity", "garbage", "sewage"],
        "label": "local amenities and infrastructure",
    },
}


# ── helpers ────────────────────────────────────────────────────────────────────

def is_relevant(text: str, neighbourhood: str) -> bool:
    lower = text.lower()
    if neighbourhood.lower() not in lower:
        return False
    return any(kw in lower for kw in CONTEXT_KEYWORDS)


def is_opinion_sentence(text: str) -> bool:
    """Return True if the sentence looks like an opinion rather than a question/request."""
    stripped = text.strip()
    if stripped.endswith("?"):
        return False
    lower = stripped.lower()
    if any(lower.startswith(s) for s in REQUEST_STARTERS):
        return False
    if any(pat in lower for pat in SENTENCE_EXCLUDES):
        return False
    # Must be a statement long enough to carry meaning
    if len(stripped) < 65:
        return False
    return True


def clean_text(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\*+([^*]+)\*+", r"\1", text)
    text = re.sub(r"#+\s*", "", text)
    text = re.sub(r"^\s*>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[\*\-]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


# ── data fetching ──────────────────────────────────────────────────────────────

def get_with_retry(url: str, params: dict) -> dict | None:
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=15)
            if r.status_code == 429:
                wait = 30 * (attempt + 1)
                print(f"    Rate limited — waiting {wait}s…")
                time.sleep(wait)
                continue
            if r.status_code in (404, 403):
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"    WARNING: {url}: {e}")
            return None
    return None


def search_posts(neighbourhood: str) -> list[dict]:
    """
    Search r/bangalore for posts about the neighbourhood.
    Returns all results deduped, then filtered to score > 3.
    """
    seen_ids: set[str] = set()
    posts: list[dict] = []

    for template in QUERY_TEMPLATES:
        query = template.format(name=neighbourhood)
        after: str | None = None

        for _page in range(1):
            params: dict = {
                "q": query,
                "sort": "relevance",
                "t": "all",
                "limit": 100,
                "type": "link",
                "restrict_sr": "true",
            }
            if after:
                params["after"] = after

            data = get_with_retry(SEARCH_URL.format(subreddit="bangalore"), params)
            if not data:
                break

            children = data["data"]["children"]
            after = data["data"].get("after")

            for c in children:
                d = c["data"]
                post_id = d.get("id", "")
                if post_id in seen_ids:
                    continue
                title = d.get("title", "")
                body = d.get("selftext", "")
                combined = title + " " + body
                if not is_relevant(combined, neighbourhood):
                    continue
                seen_ids.add(post_id)
                posts.append(d)

            if not after:
                break
            time.sleep(SLEEP_BETWEEN_REQUESTS)

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    # Keep posts with real signal: score > 3 (upvoted, not noise)
    posts = [p for p in posts if p.get("score", 0) > 3]

    # Partition: posts whose TITLE itself is about the neighbourhood (most relevant
    # for comment-fetching) vs posts where name only appears in the body
    def title_is_relevant(p: dict) -> bool:
        return is_relevant(p.get("title", ""), neighbourhood)

    title_posts = [p for p in posts if title_is_relevant(p)]
    other_posts = [p for p in posts if not title_is_relevant(p)]

    # Sort each group by score, then merge — title-relevant posts first
    title_posts.sort(key=lambda p: p.get("score", 0), reverse=True)
    other_posts.sort(key=lambda p: p.get("score", 0), reverse=True)
    return title_posts + other_posts


def fetch_comments_for_post(subreddit: str, post_id: str, neighbourhood: str) -> list[dict]:
    """
    Fetch top-level comments for a post.
    Returns comment dicts with keys: body, score.
    """
    url = COMMENTS_URL.format(subreddit=subreddit, post_id=post_id)
    data = get_with_retry(url, {"limit": 100, "depth": 1})
    if not data or not isinstance(data, list) or len(data) < 2:
        return []

    comments = []
    try:
        for c in data[1]["data"]["children"]:
            if c.get("kind") != "t1":
                continue
            d = c["data"]
            body = clean_text(d.get("body", "") or "")
            score = d.get("score", 0)
            if not body or body == "[deleted]" or body == "[removed]":
                continue
            if score < 0:
                continue
            comments.append({"body": body, "score": score})
    except (KeyError, TypeError):
        pass

    return comments


def collect_sentence_pool(neighbourhood: str) -> tuple[list[dict], int]:
    """
    Fetch posts + comments, return a pool of scored opinion sentences
    plus the raw post count for the n= display.
    Each item: {text, compound, aspects, source}
    source is 'comment' or 'post_body'
    """
    print(f"  Searching posts…")
    all_posts = search_posts(neighbourhood)
    post_count = len(all_posts)
    print(f"  Found {post_count} relevant posts (score>3)")

    top_posts = all_posts[:TOP_POSTS_FOR_COMMENTS]
    analyser = SentimentIntensityAnalyzer()
    pool: list[dict] = []
    seen_keys: set[str] = set()

    def add_sentences(sentences: list[str], source: str, require_name: bool = True):
        for s in sentences:
            s = s.strip()
            if not (65 <= len(s) <= 240):
                continue
            if not is_opinion_sentence(s):
                continue
            lower = s.lower()
            # All sentences must name the neighbourhood — ensures every sentence
            # is directly about this area, not a general Bangalore opinion or
            # an off-topic comment from a loosely-related post
            if require_name and neighbourhood.lower() not in lower:
                continue
            # Sentence must relate to at least one aspect (traffic/cost/vibe/transit/amenities)
            # This filters out personal stories, pet posts, event announcements, etc.
            aspects = [
                asp for asp, info in ASPECT_GROUPS.items()
                if any(kw in lower for kw in info["keywords"])
            ]
            if not aspects:
                continue
            # Reject sentences containing off-topic subject matter
            if any(excl in lower for excl in EXCLUSION_WORDS):
                continue
            # Must also have at least one general context keyword
            has_context = any(kw in lower for kw in CONTEXT_KEYWORDS)
            if not has_context:
                continue
            key = s.lower()[:70]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            vs = analyser.polarity_scores(s)
            pool.append({
                "text": s,
                "compound": vs["compound"],
                "aspects": aspects,
                "source": source,
            })

    # Post bodies (text posts — link posts have empty selftext)
    # require_name=True: every sentence must itself mention the neighbourhood
    for p in all_posts:
        body = clean_text(p.get("selftext") or "")
        if body:
            add_sentences(split_sentences(body), "post_body", require_name=True)

    # Comments from top posts — must also contain neighbourhood name
    # (require_name=True is the default)
    total_comment_sentences = 0
    for i, p in enumerate(top_posts):
        if total_comment_sentences >= MAX_COMMENT_SENTENCES:
            break
        post_id = p.get("id", "")
        if not post_id:
            continue
        print(f"  Fetching comments [{i+1}/{len(top_posts)}]: {p.get('title','')[:60]}…")
        comments = fetch_comments_for_post("bangalore", post_id, neighbourhood)
        for c in comments:
            sents = split_sentences(c["body"])
            add_sentences(sents, "comment", require_name=True)
            total_comment_sentences += len(sents)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    print(f"  Sentence pool: {len(pool)} opinion sentences")
    return pool, post_count


# ── analysis ──────────────────────────────────────────────────────────────────

def build_summary(neighbourhood: str, compound: float, pool: list[dict]) -> str:
    """
    Build a 2-sentence summary from real sentences in the pool.
    Sentence 1: strongest positive. Sentence 2: strongest critical.
    Both read as standalone statements — no template labels.
    """
    positives = sorted(
        [s for s in pool if s["compound"] >= 0.30],
        key=lambda x: x["compound"], reverse=True
    )
    negatives = sorted(
        [s for s in pool if s["compound"] <= -0.20],
        key=lambda x: x["compound"]
    )

    def trim(text: str, limit: int = 150) -> str:
        if len(text) <= limit:
            return text
        cut = text[:limit].rsplit(" ", 1)[0]
        return cut.rstrip(".,;:—") + "…"

    pos_sent = trim(positives[0]["text"]) if positives else None
    neg_sent = trim(negatives[0]["text"]) if negatives else None

    if pos_sent and neg_sent:
        # Lowercase the start of neg_sent to flow naturally after "On the other hand, "
        neg_lower = neg_sent[0].lower() + neg_sent[1:]
        return f"{pos_sent} On the other hand, {neg_lower}"
    elif pos_sent:
        second = next(
            (s for s in positives[1:]
             if not set(s["aspects"]) & set(positives[0]["aspects"])),
            positives[1] if len(positives) > 1 else None,
        )
        if second:
            return f"{pos_sent} {trim(second['text'])}"
        return pos_sent
    elif neg_sent:
        second_neg = next(
            (s for s in negatives[1:]
             if not set(s["aspects"]) & set(negatives[0]["aspects"])),
            negatives[1] if len(negatives) > 1 else None,
        )
        if second_neg:
            return f"{neg_sent} {trim(second_neg['text'])}"
        return neg_sent
    else:
        if pool:
            best = max(pool, key=lambda x: abs(x["compound"]))
            return trim(best["text"])
        tone = "positively" if compound >= 0.05 else ("negatively" if compound <= -0.05 else "with mixed views")
        return f"Reddit in r/bangalore discusses {neighbourhood} {tone}."


def pick_quotes(pool: list[dict], n: int = 3) -> list[str]:
    """
    Pick n quotes from the pool that:
    - Are from comments (preferred) or post bodies
    - Have strong opinion (|compound| > 0.20)
    - Cover distinct aspects
    - Are not duplicates of what went into the summary
    """
    # Prefer comments > post bodies, then stronger compound
    strong = [
        s for s in pool
        if abs(s["compound"]) > 0.20 and s["source"] == "comment"
    ]
    strong.sort(key=lambda x: abs(x["compound"]), reverse=True)

    # Fallback to post_body sentences if comments are sparse
    if len(strong) < n:
        fallback = [
            s for s in pool
            if abs(s["compound"]) > 0.20 and s["source"] == "post_body"
        ]
        fallback.sort(key=lambda x: abs(x["compound"]), reverse=True)
        strong = strong + fallback

    chosen: list[dict] = []
    covered_aspects: set[str] = set()

    for c in strong:
        if len(chosen) >= n:
            break
        new_aspects = set(c["aspects"]) - covered_aspects
        # Take it if it brings a new aspect, or if we haven't filled slots yet
        if new_aspects or (len(chosen) < n and not chosen):
            chosen.append(c)
            covered_aspects.update(c["aspects"])

    # Fill remaining with strongest unselected
    if len(chosen) < n:
        for c in strong:
            if len(chosen) >= n:
                break
            if c not in chosen:
                chosen.append(c)

    def trim(text: str, limit: int = 180) -> str:
        if len(text) <= limit:
            return text
        cut = text[:limit].rsplit(" ", 1)[0]
        return cut.rstrip(".,;") + "…"

    return [trim(c["text"]) for c in chosen[:n]]


def analyse(neighbourhood: str) -> dict:
    analyser = SentimentIntensityAnalyzer()
    pool, post_count = collect_sentence_pool(neighbourhood)

    if not pool:
        return {
            "name": neighbourhood,
            "compound": 0.0,
            "label": "Neutral",
            "positive": 0,
            "neutral": 0,
            "negative": 0,
            "total": post_count,
            "summary": f"Not enough Reddit discussion found for {neighbourhood} yet.",
            "quotes": [],
        }

    # VADER score on the full pool (comment sentences carry real opinions)
    scores = [s["compound"] for s in pool]
    compound = round(sum(scores) / len(scores), 3)
    labelled = {"positive": 0, "neutral": 0, "negative": 0}
    for s in scores:
        if s >= 0.05:
            labelled["positive"] += 1
        elif s <= -0.05:
            labelled["negative"] += 1
        else:
            labelled["neutral"] += 1

    label = "Positive" if compound >= 0.05 else ("Negative" if compound <= -0.05 else "Neutral")
    summary = build_summary(neighbourhood, compound, pool)
    quotes = pick_quotes(pool)

    return {
        "name": neighbourhood,
        "compound": compound,
        "label": label,
        **labelled,
        "total": post_count,
        "summary": summary,
        "quotes": quotes,
    }


def main():
    out_raw = Path("data/raw")
    out_raw.mkdir(parents=True, exist_ok=True)
    out_web = Path("web/public")
    out_web.mkdir(parents=True, exist_ok=True)

    results = []
    for name in NEIGHBOURHOODS:
        print(f"\nFetching {name}…")
        result = analyse(name)
        results.append(result)
        print(f"  → {result['label']} (compound={result['compound']}, n_posts={result['total']})")
        print(f"  Summary: {result['summary']}")
        for q in result["quotes"]:
            print(f"  • {q}")
        time.sleep(2)

    raw_path = out_raw / "sentiment.json"
    web_path = out_web / "sentiment.json"
    for path in (raw_path, web_path):
        path.write_text(json.dumps(results, indent=2))
        print(f"\nWritten {path}")


if __name__ == "__main__":
    main()
