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

import argparse
import html
import json
import re
import time
from pathlib import Path

import requests
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

# Full locality list ordered by Reddit discussion volume (most-discussed first).
# The first 6 are already processed; new batches pick up from where we left off.
NEIGHBOURHOODS_ORDERED = [
    # ── Tier 1: high Reddit discussion ────────────────────────────────────────
    "Koramangala",
    "Indiranagar",
    "Bellandur",
    "Sarjapur",
    "Whitefield",
    "Malleshwaram",
    # ── Tier 2: well-known residential areas ──────────────────────────────────
    "HSR Layout",
    "BTM Layout",
    "JP Nagar",
    "Jayanagar",
    "Hebbal",
    "Electronic City",
    "Marathahalli",
    "Banashankari",
    "Rajajinagar",
    "Basavanagudi",
    # ── Tier 3: growing / actively discussed ──────────────────────────────────
    "KR Puram",
    "Yelahanka",
    "Mahadevapura",
    "Domlur",
    "RT Nagar",
    "Banaswadi",
    "Frazer Town",
    "Ulsoor",
    "Yeshwantpur",
    "Hennur",
    "Brookefield",
    "Bannerghatta Road",
    "Vijayanagar",
    "MG Road",
    # ── Tier 4: established but less Reddit-active ────────────────────────────
    "HAL",
    "CV Raman Nagar",
    "Horamavu",
    "Hoodi",
    "Kadugodi",
    "Nagavara",
    "Thanisandra",
    "Kalyan Nagar",
    "HBR Layout",
    "Ramamurthy Nagar",
    "Peenya",
    "Shivajinagar",
    "Vasanth Nagar",
    "Richmond Town",
    "Langford Town",
    "Cox Town",
    "Sadashivanagar",
    "Cunningham Road",
    "Dollars Colony",
    "Varthur",
    "Panathur",
    "Munnekolala",
    # ── Tier 5: peripheral / niche ────────────────────────────────────────────
    "Nagarbhavi",
    "Kengeri",
    "Uttarahalli",
    "Bommanahalli",
    "Begur",
    "Jakkur",
    "Padmanabhanagar",
    "Old Madras Road",
    "RR Nagar",
    "Jalahalli",
    "Dasarahalli",
    "Mahalakshmi Layout",
    "Nandini Layout",
    "Kamakshipalya",
    "Chord Road",
    "Arekere",
    "Hulimavu",
    "Gottigere",
    "Akshayanagar",
    "Hongasandra",
    "Subramanyapura",
    "Vasanthapura",
    "Konanakunte",
    "Talaghattapura",
    "Sarakki",
    "Puttenahalli",
    "Chikkalasandra",
    "Raghuvanahalli",
    "Singasandra",
    "Chandapura",
    "Kasavanahalli",
    "Girinagar",
    "Chandra Layout",
    "Herohalli",
    "Mathikere",
    "Bhattarahalli",
    "Basaveshwara Nagar",
    "BEL Layout",
    "Hegganahalli",
    "Victoria Layout",
    "Kodigehalli",
    "Kaggadasapura",
    "Nallurhalli",
    "Vibhutipura",
    "Carmelaram",
    "Kundalahalli",
    "Devarabeesanahalli",
    "Garudacharpalya",
    "Thubarahalli",
    "Dommasandra",
    "Hagadur",
]

BATCH_SIZE = 5

# Arctic Shift API — free, no-auth Reddit archive.
# Allows a few requests per second; no 429s in normal usage.
# Docs: https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md
ARCTIC_BASE = "https://arctic-shift.photon-reddit.com"
HEADERS = {"User-Agent": "blr-neighbourhood-explorer/1.0 (non-commercial research)"}

# Subreddits to search.
# - prefix: optional query prefix for India-wide subs so results stay BLR-specific
SUBREDDIT_CONFIG = [
    {"name": "bangalore",  "prefix": ""},
    {"name": "Bengaluru",  "prefix": ""},
    {"name": "india",      "prefix": "Bangalore "},
    {"name": "AskIndia",   "prefix": "Bangalore "},
]

# How many top posts to fetch comments for (can be higher now — no paging cost)
TOP_POSTS_FOR_COMMENTS = 15
# Max comment sentences to score across all posts
MAX_COMMENT_SENTENCES = 300
SLEEP_BETWEEN_REQUESTS = 0.4

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
    # Conditional questions (don't end in ? but are still questions)
    "should i", "should we",
    # Third-party anecdotes — not first-hand resident opinion
    "i have a friend", "i've a friend",
    # Personal-activity anecdotes (not area opinions)
    "i was having", "i was eating", "i was sitting",
    # Community mobilisation / outreach openers
    "i'm reaching out", "i am reaching out", "reaching out to the",
    # Formal request openers
    "kindly recommend", "kindly suggest", "kindly share", "kindly let",
    "anybody know", "anybody have", "anybody here",
    # Date / event anecdotes not about living here
    "i'm on a mission", "i am on a mission",
)

# Words that immediately disqualify a sentence (off-topic content)
EXCLUSION_WORDS = {
    "dog", "cat", "pet", "canine", "puppy", "pup", "kitten", "doggo",
    "parrot", "rabbit", "guinea", "bird", "foster", "adoption",
    "vaccinated", "dewormed", "potty",
    "gaming", "playstation", "xbox", "fifa", "game ",
    # Crime/assault reports — inappropriate as neighbourhood review quotes
    "sexually", "casteist", "molestation",
}

# Phrases that immediately disqualify a sentence even if in the middle
SENTENCE_EXCLUDES = (
    "please share", "please post", "please do share", "please spread",
    "please let us know", "please let me know", "please recommend",
    "hope the driver", "hope he is", "hope she is", "hope they are",
    "hope everyone", "hope everyone is",
    "would love to get suggestions", "love to get suggestions",
    "would love to hear", "would love to know",
    "is planning to take", "is planning to rent", "is planning to move",
    "i am thinking if", "i'm thinking if",
    # Subletting / self-promotion posts
    "posting this on reddit", "posting this here", "posting here since",
    # Embedded questions / checking-in phrases (no trailing ?)
    "wanted to check if", "want to check if", "wanted to know if",
    "wanted to ask",
    # Third-person narratives, not first-hand resident opinions
    "my parents know", "my parents grew", "my parents live",
    "i and my friends", "me and my friends",
    # Crime/case follow-up discussion
    "follow up with the", "current case and",
    # Request embedded after context phrase
    "as the title suggests",
    # Community mobilisation / outreach sentences
    "reaching out to",
    # Greeting-prefixed requests ("Hi everyone, I'm looking for...")
    "hi everyone", "hi all,", "hi folks", "hi there,",
    "hey everyone", "hey all,", "hey folks", "hey there,",
    # Mission / goal statements that are requests in disguise
    "on a mission to find", "on a mission to get", "on a mission to",
    # Food/service recommendation requests (not neighbourhood opinion)
    "best place for a family", "best place to eat", "best bowl",
    "best veg restaurant", "best place for dinner",
    "recommendations for a", "recommendations for the",
    # Job/relocation queries pretending to be area questions
    "looking at a job", "got a job offer", "have a job offer",
    "looking for a flat", "looking for a house", "looking for an apartment",
    "looking for pg", "looking for a pg",
    # Commute time-tables (structured data, not opinions)
    "1 hour 20 mins", "1 hour 30 mins", "2 hours 30 mins",
    "-> 2 hours", "-> 1 hour", "->2 hours", "->1 hour", "-> 1hr", "->1hr",
)

ASPECT_GROUPS: dict[str, dict] = {
    "liveability": {
        "keywords": ["peaceful", "quiet", "noisy", "green", "safe", "unsafe", "crime",
                     "walkable", "charm", "vibe", "culture", "community", "pleasant",
                     "lively", "nice", "terrible", "worst", "best", "horrible",
                     "love", "hate", "avoid", "great"],
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
        "keywords": ["metro", "bus", "connectivity", "transit", "bus stop",
                     "bus stand", "metro station", "railway station",
                     "reach", "accessible", "bmtc", "auto", "cab"],
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
    text = html.unescape(text)
    # Strip any remaining HTML/Reddit entity-like tokens (e.g. &x200B;)
    text = re.sub(r"&[#a-zA-Z][^;]{0,10};", "", text)
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
            r = requests.get(url, params=params, headers=HEADERS, timeout=20)
            # Honour rate-limit headers if present
            remaining = r.headers.get("X-RateLimit-Remaining")
            if remaining is not None and float(remaining) < 2:
                reset = float(r.headers.get("X-RateLimit-Reset", 5))
                print(f"    Rate limit low — waiting {reset:.0f}s…")
                time.sleep(reset)
            if r.status_code == 429:
                wait = 10 * (attempt + 1)
                print(f"    429 — waiting {wait}s…")
                time.sleep(wait)
                continue
            if r.status_code in (404, 403):
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"    WARNING: {url}: {e}")
            if attempt < 2:
                time.sleep(2)
    return None


def search_posts(neighbourhood: str) -> list[dict]:
    """
    Search multiple subreddits for posts about the neighbourhood via Arctic Shift.
    Returns posts deduped and filtered to score > 3, title-relevant posts first.
    """
    seen_ids: set[str] = set()
    posts: list[dict] = []

    for sub_cfg in SUBREDDIT_CONFIG:
        sub = sub_cfg["name"]
        query = f"{sub_cfg['prefix']}{neighbourhood}"

        params = {
            "subreddit": sub,
            "query": query,
            "limit": 100,
            "sort": "desc",
            "fields": "id,title,selftext,score,num_comments",
        }
        data = get_with_retry(f"{ARCTIC_BASE}/api/posts/search", params)
        if data:
            for p in data.get("data", []):
                post_id = p.get("id", "")
                if not post_id or post_id in seen_ids:
                    continue
                combined = (p.get("title", "") + " " + (p.get("selftext") or ""))
                if not is_relevant(combined, neighbourhood):
                    continue
                seen_ids.add(post_id)
                p["_subreddit"] = sub
                posts.append(p)

        time.sleep(SLEEP_BETWEEN_REQUESTS)

    # Keep posts with real signal: score > 3
    posts = [p for p in posts if p.get("score", 0) > 3]

    # Title-relevant posts first (richest source for comments)
    def title_is_relevant(p: dict) -> bool:
        return is_relevant(p.get("title", ""), neighbourhood)

    title_posts = sorted([p for p in posts if title_is_relevant(p)],
                         key=lambda p: p.get("score", 0), reverse=True)
    other_posts  = sorted([p for p in posts if not title_is_relevant(p)],
                          key=lambda p: p.get("score", 0), reverse=True)
    return title_posts + other_posts


def fetch_comments_for_post(subreddit: str, post_id: str, neighbourhood: str) -> list[dict]:
    """
    Fetch all comments for a post via Arctic Shift comments tree.
    Returns comment dicts with keys: body, score.
    """
    params = {
        "link_id": post_id,
        "limit": 9999,
    }
    data = get_with_retry(f"{ARCTIC_BASE}/api/comments/tree", params)
    if not data:
        return []

    comments: list[dict] = []

    def walk(nodes: list) -> None:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            kind = node.get("kind")
            # Skip collapsed "load more" stubs
            if kind == "more":
                continue
            # Arctic Shift wraps each comment as {"kind": "t1", "data": {...}}
            inner = node.get("data") if kind == "t1" else node
            if not isinstance(inner, dict):
                continue
            body = clean_text((inner.get("body") or "").strip())
            score = inner.get("score", 0) or 0
            if body and body not in ("[deleted]", "[removed]") and score >= 0:
                comments.append({"body": body, "score": score})
            # Recurse into replies
            replies = inner.get("replies") or {}
            if isinstance(replies, dict):
                walk(replies.get("data", {}).get("children", []))

    walk(data.get("data", []))
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
        comments = fetch_comments_for_post(p.get("_subreddit", ""), post_id, neighbourhood)
        for c in comments:
            sents = split_sentences(c["body"])
            add_sentences(sents, "comment", require_name=True)
            total_comment_sentences += len(sents)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    print(f"  Sentence pool: {len(pool)} opinion sentences")
    return pool, post_count


# ── analysis ──────────────────────────────────────────────────────────────────

# Short human-readable labels used inside generated summary sentences.
_ASPECT_DISPLAY: dict[str, str] = {
    "liveability": "overall vibe",
    "traffic":     "traffic and commute",
    "cost":        "housing costs",
    "transit":     "public transit",
    "amenities":   "local amenities",
}


def build_summary(neighbourhood: str, compound: float, pool: list[dict]) -> str:
    """
    Build a 1–2 sentence synthesised summary using aspect-level sentiment.
    Never quotes verbatim Reddit text — describes what aspects residents
    appreciate or criticise so the result reads as a real neighbourhood overview.
    """
    # Aggregate compound scores per aspect
    aspect_scores: dict[str, list[float]] = {a: [] for a in ASPECT_GROUPS}
    for s in pool:
        for asp in (s.get("aspects") or []):
            if asp in aspect_scores:
                aspect_scores[asp].append(s["compound"])

    aspect_means: dict[str, float] = {
        a: sum(sc) / len(sc)
        for a, sc in aspect_scores.items()
        if sc
    }

    # Sort aspects by strength of signal
    pos_aspects = [
        _ASPECT_DISPLAY[a]
        for a, m in sorted(aspect_means.items(), key=lambda x: -x[1])
        if m >= 0.05
    ]
    neg_aspects = [
        _ASPECT_DISPLAY[a]
        for a, m in sorted(aspect_means.items(), key=lambda x: x[1])
        if m <= -0.05
    ]

    def _join(labels: list[str]) -> str:
        if len(labels) == 1:
            return labels[0]
        return ", ".join(labels[:-1]) + f" and {labels[-1]}"

    if pos_aspects and neg_aspects:
        return (
            f"Residents appreciate {neighbourhood}'s {_join(pos_aspects[:2])}. "
            f"The main criticisms are around {_join(neg_aspects[:2])}."
        )
    elif pos_aspects:
        return (
            f"Reddit discussions about {neighbourhood} are broadly positive. "
            f"Residents particularly appreciate the {_join(pos_aspects[:2])}."
        )
    elif neg_aspects:
        return (
            f"Reddit sentiment on {neighbourhood} leans negative. "
            f"The main criticisms concern {_join(neg_aspects[:2])}."
        )
    else:
        # No strong aspect signals — fall back to overall tone
        if compound >= 0.05:
            return f"Reddit broadly views {neighbourhood} positively, though opinions are spread across many topics."
        elif compound <= -0.05:
            return f"Reddit broadly views {neighbourhood} negatively, with complaints spread across many topics."
        else:
            return f"Reddit has mixed views on {neighbourhood}, with no single theme dominating the conversation."


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
    parser = argparse.ArgumentParser(description="Fetch Reddit sentiment for Bangalore localities.")
    parser.add_argument(
        "--batch",
        type=int,
        default=None,
        help=(
            "Which batch (1-based) of BATCH_SIZE localities to process. "
            "Omit to auto-detect the next unprocessed batch."
        ),
    )
    parser.add_argument(
        "--names",
        nargs="+",
        help="Process specific locality names instead of a batch.",
    )
    args = parser.parse_args()

    out_raw = Path("data/raw")
    out_raw.mkdir(parents=True, exist_ok=True)
    out_web = Path("web/public")
    out_web.mkdir(parents=True, exist_ok=True)

    raw_path = out_raw / "sentiment.json"
    web_path = out_web / "sentiment.json"

    # Load existing results so we can merge (not overwrite)
    if raw_path.exists():
        existing: list[dict] = json.loads(raw_path.read_text())
    else:
        existing = []
    already_done = {e["name"] for e in existing}

    # Determine which localities to process this run
    if args.names:
        to_process = args.names
    elif args.batch is not None:
        start = (args.batch - 1) * BATCH_SIZE
        to_process = NEIGHBOURHOODS_ORDERED[start : start + BATCH_SIZE]
    else:
        # Auto-detect: next BATCH_SIZE localities not yet in the file
        pending = [n for n in NEIGHBOURHOODS_ORDERED if n not in already_done]
        to_process = pending[:BATCH_SIZE]

    if not to_process:
        print("All localities already processed. Nothing to do.")
        return

    print(f"Processing batch: {to_process}")
    print(f"Already done: {len(already_done)}/{len(NEIGHBOURHOODS_ORDERED)} localities\n")

    new_results: list[dict] = []
    for name in to_process:
        print(f"\nFetching {name}…")
        result = analyse(name)
        new_results.append(result)
        print(f"  → {result['label']} (compound={result['compound']}, n_posts={result['total']})")
        print(f"  Summary: {result['summary']}")
        for q in result["quotes"]:
            print(f"  • {q}")
        time.sleep(2)

    # Merge: update existing entries or append new ones, preserving order
    results_map = {e["name"]: e for e in existing}
    for r in new_results:
        results_map[r["name"]] = r
    # Write back in NEIGHBOURHOODS_ORDERED order, then any extras not in the list
    ordered_names = [n for n in NEIGHBOURHOODS_ORDERED if n in results_map]
    extras = [n for n in results_map if n not in set(NEIGHBOURHOODS_ORDERED)]
    final = [results_map[n] for n in ordered_names + extras]

    for path in (raw_path, web_path):
        path.write_text(json.dumps(final, indent=2))
        print(f"\nWritten {path} ({len(final)} localities total)")


if __name__ == "__main__":
    main()
