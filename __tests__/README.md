# Tests Directory

Integration and unit tests for BLR Neighborhood Explorer.

## Structure

```
__tests__/
├── integration/
│   ├── scrapers/          ← Scraper integration tests (NoBroker, Housing.com)
│   └── api/               ← API route tests (placeholder)
└── unit/                  ← Unit tests (placeholder)
```

## Running Tests

### All tests
```bash
npm run test
```

### Specific test file
```bash
node __tests__/integration/scrapers/test-scrapers.mjs
node __tests__/integration/scrapers/test-nobroker.mjs
```

### Probe/debug mode
```bash
node __tests__/integration/scrapers/probe-nobroker.mjs
```

## Test Files

| File | Purpose |
|------|---------|
| `test-scrapers.mjs` | Integration test for both scrapers (3 test localities) |
| `test-nobroker.mjs` | Smoke test for NoBroker scraper (5 localities) |
| `probe-nobroker.mjs` | Debug/probe script for NoBroker (manual inspection) |

## Test Fixtures

Place mock data and fixtures in `__tests__/integration/scrapers/fixtures/` (to be added as tests expand).

## Adding New Tests

1. Create test file in appropriate subdirectory (`integration/` or `unit/`)
2. Follow the naming convention: `*.test.mjs` or `*.spec.mjs`
3. Run with `node` or integrate with a test runner (Jest, Vitest)
