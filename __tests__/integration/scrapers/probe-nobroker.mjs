// probe-nobroker.mjs — discover current NoBroker API
const html = await fetch("https://www.nobroker.in/flats-for-rent-in-koramangala-bangalore/", {
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html",
    "Accept-Language": "en-IN,en;q=0.9",
  },
  signal: AbortSignal.timeout(12000),
}).then(r => r.text());

console.log("Page length:", html.length);

// 1. API endpoints
const apiMatches = [...html.matchAll(/https?:\\?\/\\?\/www\.nobroker\.in\\?\/api\\?\/[^\\s'"<>]+/g)];
const apis = [...new Set(apiMatches.map(m => m[0].replace(/\\+/g, "")))].slice(0, 20);
console.log("\nAPI endpoints found:", apis.length ? apis : "(none)");

// 2. locality ID
const locIds = [...html.matchAll(/localityId[\\s'"=:]+(\d+)/g)].map(m => m[1]);
console.log("locality IDs:", [...new Set(locIds)].slice(0, 10));

// 3. Data bootstrapping
console.log("has __NEXT_DATA__:", html.includes("__NEXT_DATA__"));
console.log("has __INITIAL_STATE__:", html.includes("__INITIAL_STATE__"));
console.log("has REDUX_STATE:", html.includes("REDUX_STATE"));

// 4. Property IDs in page (nobroker format is numeric)
const propIds = [...html.matchAll(/"postId"\s*:\s*(\d+)/g)].map(m => m[1]);
console.log("postId values:", [...new Set(propIds)].slice(0, 5));

// 5. Any snippet around "api" references
const apiSnippets = [...html.matchAll(/(\/api\/v\d[^\s'"<]{3,60})/g)].map(m => m[1]);
console.log("Relative API paths:", [...new Set(apiSnippets)].slice(0, 20));
