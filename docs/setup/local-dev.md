# Local Development Setup

Get the BLR Neighborhood Explorer running on your machine.

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.9+ with pip
- **Git**

## Backend Environment Setup

### 1. Create `.env.local` file

Copy the template and fill in your API keys:

```bash
cp .env.example web/.env.local
```

**Required API Keys:**

| Service | Purpose | Get Key |
|---------|---------|---------|
| **NEXT_PUBLIC_SUPABASE_URL** | Database (listings storage) | [Supabase](https://supabase.com) |
| **NEXT_PUBLIC_SUPABASE_ANON_KEY** | Public Supabase client key | Supabase dashboard |
| **NEXT_PUBLIC_MAPTILER_API_KEY** | Map rendering | [MapTiler](https://www.maptiler.com) |
| **SUPABASE_SERVICE_KEY** | Backend admin access (keep secret) | Supabase dashboard |

### 2. Frontend Setup

```bash
cd web
npm install
npm run dev
```

Visit `http://localhost:3000` to see the map.

### 3. Python Data Pipeline Setup

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r data/requirements.txt
```

## Running Components

### Frontend Development Server

```bash
cd web
npm run dev
```

Development server runs on `http://localhost:3000` with hot reload.

### Build for Production

```bash
cd web
npm run build
npm run start  # Start production server
```

### Python Data Scripts

```bash
# Activate virtual environment first
source .venv/bin/activate

# Run specific script
python data/scripts/fetch_weather.py
python data/scripts/scrape_listings.py --test  # Test mode (2 localities)

# Run all pipeline scripts in order
python data/scripts/run_weekly_scrape.sh
```

## Testing

### Frontend Tests

```bash
# All tests
npm run test

# Specific test
node __tests__/integration/scrapers/test-scrapers.mjs
node __tests__/integration/scrapers/test-nobroker.mjs
```

See [__tests__/README.md](../../__tests__/README.md) for details.

### Linting & Type Checking

```bash
cd web

# Type checking
npm run tsc

# ESLint
npx eslint . --ext .ts,.tsx,.mjs
```

## Troubleshooting

### "Cannot find module @/lib/..."

Make sure you're running from the correct directory and Node.js is 18+.

### Supabase connection errors

Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct in `.env.local`.

### Python import errors

Ensure virtual environment is activated:
```bash
source .venv/bin/activate
```

## Project Navigation

- **Frontend code:** `web/app/` (Next.js App Router)
- **API routes:** `web/app/api/`
- **Utilities:** `web/lib/`
- **Shared types:** `packages/types/`
- **Data pipeline:** `data/scripts/`
- **Tests:** `__tests__/`

## Next Steps

- Read [CODEBASE.md](../architecture/codebase.md) for system architecture
- Explore [Adding Features](../guides/) guides
- Review [Graphify Setup](graphify.md) for fast context lookups

---

**Last updated:** April 18, 2026
