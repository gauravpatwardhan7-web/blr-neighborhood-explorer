# Bengaluru Neighborhood Explorer

A data-driven exploration tool for Bangalore neighborhoods with livability scoring, amenity mapping, and rental listings.

## Quick Links

- **[Architecture](docs/architecture/)** — Understand how the project is structured
- **[Setup Guide](docs/setup/)** — Get started locally, configure environment
- **[Feature Roadmap](docs/backlog.md)** — What's being built next
- **[Guides](docs/guides/)** — How to extend the project

## Project Structure

```
.
├── web/                    ← Next.js frontend (React + MapLibre)
├── data/                   ← Python data pipeline (scraping, scoring)
├── packages/               ← Shared code (types, utilities)
├── __tests__/              ← Integration and unit tests
├── docs/                   ← Documentation and guides
└── .github/workflows/      ← Automated jobs (scraping, updates)
```

## Key Features

- **Livability Scoring** — Amenities, weather, commute time, rental prices
- **Interactive Map** — Explore 100 Bangalore neighborhoods
- **Rental Listings** — Real-time listings from NoBroker
- **Amenity Mapping** — Schools, hospitals, supermarkets per locality

## Tech Stack

- **Frontend:** Next.js, React, MapLibre GL, Tailwind CSS
- **Backend:** Node.js API routes, Supabase (listings storage)
- **Data Pipeline:** Python (Overpass API, OpenWeatherMap, web scraping)
- **Infrastructure:** GitHub Actions (automated scraping)

## Getting Started

See [Local Development Setup](docs/setup/local-dev.md) for detailed instructions.

### Quick Start

```bash
# Install dependencies
cd web && npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev
```

Visit `http://localhost:3000` to see the map.

## Documentation

Full documentation is in the `docs/` directory:

- `docs/architecture/` — System design and data flow
- `docs/setup/` — Environment setup, Graphify integration
- `docs/guides/` — How to add features
- `docs/backlog.md` — Feature roadmap

## Contributing

To extend the project:

1. **Add a new amenity type:** See [docs/guides/adding-amenities.md](docs/guides/adding-amenities.md)
2. **Add an API route:** See [docs/guides/adding-api-routes.md](docs/guides/adding-api-routes.md)
3. **Add data source:** See `data/pipelines/` structure

## Testing

Run tests from project root:

```bash
# All tests
npm run test

# Specific scraper test
node __tests__/integration/scrapers/test-scrapers.mjs
```

See [__tests__/README.md](__tests__/README.md) for details.

---

**Date:** April 18, 2026  
**License:** MIT
