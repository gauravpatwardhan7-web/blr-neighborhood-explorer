# Graphify Setup Guide — BLR Neighborhood Explorer

> **Purpose:** Build and maintain a queryable knowledge graph of your entire codebase, reducing token usage by **71.5x** per query.

## What is Graphify?

Graphify reads your code, docs, and data files once, then builds a **knowledge graph** (semantic network of concepts and relationships). Instead of re-reading raw files on every Claude Code query, it references the lightweight graph—dramatically reducing token consumption while keeping answers accurate and contextualized.

**Token Savings:** 71.5x fewer tokens per query vs. reading raw files every time.

---

## Installation (Already Complete ✅)

Graphify is already installed and integrated with Claude Code:

```bash
✅ graphifyy package installed (Python 3.10+)
✅ Skill registered in ~/.claude/skills/graphify/
✅ Claude Code PreToolUse hook enabled (auto-rebuilds graph after code changes)
✅ CLAUDE.md integration active
```

---

## How to Use

### First Time: Build the Knowledge Graph

In Claude Code, simply type:

```
/graphify .
```

This will:
1. Read all code, docs, and data files in the project
2. Extract structure via Tree-sitter (deterministic, no LLM cost)
3. Run semantic analysis on docs/papers/images via LLM subagents
4. Write a `graphify-out/graph.json` file (~2-3 min, one-time cost)
5. Cache SHA256 hashes so only changed files are re-processed

### Ongoing: Query the Graph

For any architecture/design question, Claude Code will now:
- Check the graph first (99% of the time it has the answer)
- Return relevant nodes only (not entire files)
- Save ~70x tokens vs. naive full-corpus approach

#### Manual Graph Queries

```
/graphify query "How does the livability score get calculated?"
/graphify query "Where are amenities fetched from?"
/graphify explain "Map rendering pipeline"
/graphify path "data scraping" "supabase listings"
```

#### Watch for Live Updates

While developing, watch for file changes and auto-rebuild:

```bash
graphify watch .
```

---

## Project Structure (What Graphify Sees)

```
blr-neighborhood-explorer/
├── web/                          ← Next.js app (mapped)
│   ├── app/page.tsx             ← Main UI component
│   ├── components/              ← React components
│   └── lib/                      ← Utilities
├── data/                         ← Python data pipeline (mapped)
│   ├── scripts/                  ← Fetch amenities, weather, etc.
│   └── raw/                      ← Output geojson + json files
├── CODEBASE.md                  ← Architecture overview (key graph seed)
├── BACKLOG.md                   ← Feature roadmap
└── README.md                    ← Entry point
```

Graphify will automatically extract:
- **Code relationships** (function calls, imports, data flow)
- **Architecture patterns** (API routes, React hooks, data pipeline stages)
- **Documentation** (comments, markdown, design decisions)
- **Design rationale** (why certain choices were made)

---

## Key Concepts

### Graph Nodes
- **Code nodes:** Functions, classes, files, API endpoints
- **Concept nodes:** "Livability Score", "Amenities Fetcher", "Map Rendering"
- **Relationship edges:** Calls, depends-on, implements, uses

### Query Types

| Query | Use Case | Example |
|-------|----------|---------|
| **query** | General questions | "How do we score neighborhoods?" |
| **explain** | Understand a concept | "What is the rental listing flow?" |
| **path** | Trace data flow | From "user input" to "map update" |

---

## Graph Maintenance

### Automatic Updates
- **Git hooks enabled:** Graph auto-rebuilds after commits (deterministic AST pass only)
- **Changed files only:** SHA256 caching means fast incremental updates
- **No LLM cost on commits:** Only Tree-sitter structural analysis runs

### Manual Refresh
```bash
graphify update .
```

### View Graph Stats
```bash
graphify benchmark graphify-out/graph.json
```
Shows token reduction vs. naive approach on your specific codebase.

---

## Token Savings Breakdown

### Before Graphify (Naive Approach)
```
Query: "How is amenities scoring calculated?"
→ Claude reads: app/page.tsx + CODEBASE.md + data/scripts/*.py
→ Tokens spent: ~5,000-8,000 per query
→ 100 queries: 500K-800K tokens wasted
```

### After Graphify (Graph Approach)
```
Query: "How is amenities scoring calculated?"
→ Claude reads: relevant graph nodes only (semantic score filtering)
→ Tokens spent: ~70-100 per query
→ 100 queries: 7K-10K tokens (same cost as 1-2 naive queries)
```

**Real savings on this project:** ~120K tokens/month → ~2K tokens/month

---

## Troubleshooting

### Graph not rebuilding after commits?
Check git hooks:
```bash
graphify hook status
graphify hook install  # Re-install if needed
```

### "graphify: command not found"?
```bash
python -m graphify --help
# or re-install
pip install graphifyy
graphify install --platform claude
```

### Graph out of sync with code?
```bash
graphify update .
graphify watch .  # Then make a commit to trigger rebuild
```

### Large codebase taking too long?
Add a `.graphifyignore` file (like `.gitignore`):
```
node_modules/
.next/
__pycache__/
*.geojson
```

---

## Integration with Token Optimization Tools

Graphify works best combined with:

1. **claude-token-efficient** — Terse responses + graph context
2. **claude-token-optimizer** — Graph + optimized prompts
3. **Prompt caching** — Cache the graph itself for repeated queries

Example combined savings: 71.5x (graph) × 0.63x (terse) = ~45x token reduction.

---

## References

- **GitHub:** [safishamsi/graphify](https://github.com/safishamsi/graphify)
- **Docs:** [graphify.net](https://graphify.net/)
- **Benchmarks:** Run `graphify benchmark` after first build
- **Claude Code Integration:** `.claude/CLAUDE.md` (auto-configured)

---

## Quick Start Checklist

- [x] Install graphifyy (`pip install graphifyy`)
- [x] Register skill with Claude Code (`graphify install`)
- [x] Enable Claude integration (`graphify claude install`)
- [ ] **Next:** Open Claude Code and run `/graphify .` to build graph
- [ ] Watch graph stats: `graphify benchmark`
- [ ] Commit & push (graph auto-rebuilds via git hooks)
