import praw
import json
import time
from pathlib import Path
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

Path("data/raw").mkdir(parents=True, exist_ok=True)

with open("data/raw/localities.geojson") as f:
    localities = json.load(f)["features"]

analyzer = SentimentIntensityAnalyzer()

reddit = praw.Reddit(
    client_id="YOUR_CLIENT_ID",
    client_secret="YOUR_CLIENT_SECRET",
    user_agent="blr_neighborhood_explorer/1.0"
)

def get_sentiment(locality_name):
    texts = []
    search_terms = [
        f"{locality_name} Bangalore living",
        f"{locality_name} Bangalore neighborhood",
        f"{locality_name} Bengaluru"
    ]
    for term in search_terms:
        try:
            results = reddit.subreddit("bangalore").search(term, limit=15)
            for post in results:
                texts.append(post.title)
                if post.selftext:
                    texts.append(post.selftext[:300])
            time.sleep(1)
        except Exception as e:
            print(f"    Search error: {e}")

    if not texts:
        return {"score": 0, "positive": 0, "negative": 0, "neutral": 0, "post_count": 0}

    scores = [analyzer.polarity_scores(t)["compound"] for t in texts]
    avg = sum(scores) / len(scores)
    positive = sum(1 for s in scores if s > 0.05)
    negative = sum(1 for s in scores if s < -0.05)
    neutral  = len(scores) - positive - negative

    return {
        "score": round(avg, 3),
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
        "post_count": len(texts)
    }

results = []
for feature in localities:
    name = feature["properties"]["name"]
    print(f"Fetching sentiment for {name}...")
    sentiment = get_sentiment(name)
    row = {"name": name, **sentiment}
    results.append(row)
    print(f"  ✓ {name}: score={sentiment['score']}, posts={sentiment['post_count']}, +{sentiment['positive']} -{sentiment['negative']}")
    time.sleep(2)

output_path = "data/raw/sentiment.json"
with open(output_path, "w") as f:
    json.dump(results, f, indent=2)

print(f"\nDone! Saved sentiment data for {len(results)} localities to {output_path}")