# Backlog — Bengaluru Neighborhood Explorer

## ✅ Completed Features

### Core
- [x] Map visualization of 100 Bengaluru localities
- [x] GeoJSON layer with interactive polygons
- [x] Scoring system with 4 weighted factors (air quality, amenities, metro access, restaurants)
- [x] Custom weight sliders — adjust factors real-time
- [x] Filter chips — show Great (6+), Good (4-6), Low (<4), All
- [x] Search bar — find localities by name
- [x] Locality details sheet — shows factors, raw data, position map
- [x] Real-time score recalculation based on weights
- [x] Shareable URLs — encode weights & selected locality in URL params
- [x] Geolocation button — find nearest locality
- [x] Email gate — require email before first use
- [x] Mobile responsive UI — collapsible sheet, vertical filter stack
- [x] MapLibre GL rendering with Carto Positron basemap
- [x] iOS safe-area inset padding
- [x] Mobile filter positioning improvements

---

## 🎯 Suggested Features (Priority: High → Low)

### 1. **Favorites / History** (High Priority)
- Save favorite localities to browser localStorage
- View recently viewed localities
- Pin/bookmark localities for later
- Sync favorites across sessions
- Clear history option

### 2. **Locality Comparison** (High Priority)
- Select 2-3 localities to compare side-by-side
- Overlay factor bars, raw data, scoring
- Comparison table view
- Show deltas (differences) between selected areas
- Export comparison to PNG/PDF

### 3. **Commute Time Matrix** (High Priority)
- Add "Commute to" feature — select a destination (e.g., Whitefield, Koramangala)
- Calculate travel time from each locality using OSRM or Google Maps API
- Display commute time as heatmap overlay or data layer
- Add commute time as optional scoring factor (weight slider)

### 4. **Property Price/Rent Data** (Medium Priority)
- Integrate rent prices (1BHK, 2BHK, 3BHK averages)
- Integrate property prices per sq.ft
- Show price trends over time if available
- Filter by price range
- Add as optional factor for scoring

### 5. **Enhanced Amenities & Walkability** (Medium Priority)
- Add more granular amenity types: gyms, parks, nightlife venues, pharmacies, banks
- Calculate walkability score (proximity to mixed-use areas, pedestrian infrastructure)
- Add "Entertainment score" (restaurants, bars, malls, cinemas)
- Visualize amenity density as heatmap layer

### 6. **Safety & Crime Metrics** (Medium Priority)
- Integrate crime statistics by locality (if available via public APIs)
- Display safety rating based on incident frequency
- Show common crime types per area
- Add safety as optional scoring factor

---

## 📊 Data Enhancement Opportunities

- **Traffic congestion** — Real-time traffic data from Google Maps API
- **Air quality trends** — Time-series graph of AQI changes
- **Job density** — Proxy using corporate office locations, tech parks
- **Public transport frequency** — Bus route coverage, metro connectivity details
- **Noise levels** — Ambient noise measurements per locality

---

## 🎨 UX/UI Improvements

- [ ] Dark mode toggle
- [ ] Custom color scheme for score ranges
- [ ] Info tooltips for scoring factors
- [ ] Undo/Reset weights button (one-click)
- [ ] Print-friendly locality details view
- [ ] Accessibility audit (WCAG 2.1 AA compliance)

---

## 🔧 Technical Debt & Optimization

- [ ] **Live on-demand listing fetch** — When a user clicks a locality and Supabase has no rows for it (or rows are older than N days), call the NoBroker TypeScript scraper (`lib/scrapers/nobroker.ts`) directly from the API route, save results to Supabase, then return them. Shows a loading state (~5-10s first load, instant after). Needs: scraper call wired into `app/api/listings/route.ts`, freshness timestamp check, and a UI loading skeleton. Note: Housing.com requires Playwright so can't run serverless — NoBroker HTML scraper works fine without a browser.
- [ ] Code cleanup — refactor page.tsx (already has prepared rewrite)
- [ ] Memoize expensive components
- [ ] Implement virtual scrolling for locality lists
- [ ] Add service worker for offline mode
- [ ] Image optimization for map tiles
- [ ] Database migration from JSON files to PostgreSQL (if needed for scale)

---

## 📱 Mobile-Specific Enhancements

- [ ] Native app versions (React Native / Flutter)
- [ ] Offline maps support
- [ ] Background geolocation tracking
- [ ] Home screen shortcuts for saved localities

---

## 🔐 Data & Privacy

- [ ] GDPR compliance audit
- [ ] Anonymous analytics (Plausible/Fathom instead of Google Analytics)
- [ ] User data deletion mechanism
- [ ] Privacy policy documentation

