# Changelog

All notable changes to the **Chole Bhature** stream meta-sorter and discovery addon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.5.4] - 2026-11-08
### Fixed & Improved
- **Full Nuvio & Android TV Compatibility**: Homogenized manifest resources to standard string array `["stream", "catalog"]` and removed restrictive top-level `idPrefixes` so all media types and numeric TMDB IDs load seamlessly without dropping the addon.
- **Provider Scraping Deadlines**: Extended scrape timeouts from 4.5s/6.0s to 7.5s/8.5s across all 28 providers to consistently yield 30+ playable streams instead of getting aborted early.
- **Empty Result Cache Protection**: Prevented empty `{ streams: [] }` results from ever locking into memory or Redis cache.
- **Disabled Scraper Auto-Quarantine**: Removed automatic 10-minute bans on providers that fail to find streams on niche or untouched media.
- **Playable Stream URL Sanitization**: Automatically removed redundant `externalUrl` attributes from streams that already feature direct playback URLs.

## [4.5.0] - 2026-10-16

### ⚡ Speed, Stream Resilience & Instant Playback Innovations

#### 1. P2P Torrent Magnet Filter & Provider Disabling Robustness (`index.js`, `providerLoader.js`, `streamTester.js`)
* **`hideP2P` / Un-Cached Magnet Block**:
  - Added dedicated toggle to completely filter out un-cached peer-to-peer torrent magnets.
  - Ensures users without Debrid or VPNs only see 100% direct HTTP/HLS or cached streams.
* **Case-Insensitive Provider ID & Name Matching**:
  - Normalized `disabled` and `disabledProviders` lists to lowercase.
  - Compares against both `p.name` and `p.id` (e.g. `Torrentio` / `torrentio`), guaranteeing that disabled sources are strictly blocked across all layers (loader, router, and tester).

#### 2. Smart Mirror Stacking & Semantic Stream Deduplication (`streamTester.js`)
* **Semantic Release Fingerprinting Engine**:
  - Implemented advanced multi-tier release matching in `getStreamFingerprint`:
    - Accurately identifies mirrors of the same release across dozens of scrapers using canonical title normalization, season/episode keys (`s01e01`), resolution tiers (`2160p`, `1080p`, `720p`), release quality (`REMUX`, `BluRay`, `WEB-DL`), video codecs (`HEVC`, `AV1`, `x264`), release groups (e.g., `FLUX`, `QxR`, `YTS`, `Pahe`), and rounded 150MB byte-size buckets.
    - Resolves the issue where 15–20 identical streams were displayed across the screen from different hosters.
* **Fastest Live Route Selection**:
  - When scrapers provide multiple mirrors for a release, the testing engine probes them and automatically assigns the **fastest measured live mirror** (lowest ms ping) as the primary stream URL.
  - Backups are maintained in the stream's fallback mirror stack.
  - Reduces stream list clutter by up to **70%** while ensuring the best possible initial playback speed.

#### 2. Self-Healing Stream Failover Proxy (`routes/streamProxy.js`)
* **Automatic Multi-Mirror Failover**:
  - Upgraded `/proxy/stream` endpoint with multi-mirror failover via `fallbacks` query parameter.
  - If a primary hosting provider drops connection, returns HTTP 403 Forbidden, 404 Not Found, 5xx Gateway errors, or experiences token expiration, the proxy catches the error and **transparently attempts the next healthy mirror in the stack**.
  - Media players (ExoPlayer, VLC, Stremio, Nuvio) continue playback without showing error modals, black screens, or buffering freezes.

#### 3. Multi-Mirror Stream Card Badging (`streamFormatter.js` & `streamIngest.js`)
* **Visual Mirror Badging**:
  - Added `⚡ [N Mirrors]` indicator badge to the stream header line for multi-source releases.
  - Added `⚡ N Live Mirrors` badge to the metadata specifications row.
  - Provider attribution cleanly combines sources (e.g. `HubCloud + Vega (+1 more)`).

---

## [4.4.0] - 2026-10-16

### 🚀 Major Performance & Architecture Overhaul

#### 1. Distributed Cloud KV & Persistent Multi-Device Caching
* **Upstash Redis KV Integration (`@vercel/kv`)**:
  - Integrated `@vercel/kv` client supporting both Vercel KV and direct Upstash Redis REST endpoints (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).
  - Added deterministic cache key generation: `cb:str:${cleanId}:${configHash}` ensuring unique caching per user preference set while sharing common public scrapes.
  - **Cold vs. Warm Benchmarks**:
    - **Cold Scrape**: Resolves 90+ stream links from 120+ providers in **~14.5s** (local server) and **~18s** (Vercel serverless).
    - **Warm Cached Query**: Instant global retrieval in **~300ms–350ms** across all linked client devices (Smart TVs, Mobile, Desktop).
  - Automatic fallback to an internal in-memory LRU cache (10-minute TTL) when Redis credentials are not configured or when network partitions occur.

#### 2. Sub-3s Domain Health Probe Coalescing (`streamTester.js`)
* **Shared-Host Probe Deduplication**:
  - Implemented `domainLatencyCache` mapping unique domain hostnames to in-flight probe promises.
  - When scrapers return dozens of multi-part or multi-quality links hosted on the same server cluster (e.g., HubCloud, Vega, PixelDrain), the engine pings the domain edge once and propagates the live millisecond latency to all sister streams.
  - Prevents TCP/TLS handshake socket exhaustion, eliminates server-side rate limits, and shortens the testing phase from >12s down to **under 2.8s–3.0s**.
* **Stream Latency Tiering**:
  - Streams are classified and badged with live ping metrics:
    - `🟢 FAST`: Latency < 800ms
    - `🟡 SLOW`: Latency ≥ 800ms
    - `🔴 DEAD`: Link failed probe (HTTP 404, 403, 500, socket hangup, or timeout)
* **Elimination of Fallback Ping Bug**:
  - Removed arbitrary `45ms` fallback tags that masked unprobed links during early timeout cutoffs. Every stream now shows verified live ping measurements.

#### 3. Adaptive DNS-over-HTTPS (DoH) & Fast-Edge CDN Routing (`dohResolver.js`)
* **Multi-Provider Encrypted DoH**:
  - Built-in DoH engine querying Cloudflare (`1.1.1.1`), Google (`8.8.8.8`), AdGuard (`94.140.14.14`), and Quad9 (`9.9.9.9`) with zero-latency in-memory DNS caching.
* **Native Fast-Edge Bypass (`FAST_EDGE_DOMAINS`)**:
  - Automated bypass for high-traffic CDN endpoints:
    - `raw.githubusercontent.com`, `github.com`, `api.github.com`
    - `cdn.jsdelivr.net`
    - `codeberg.org`
    - `api.themoviedb.org`
  - **Root Cause Solved**: Indian ISPs (Jio, Airtel) frequently throttle or drop packets to Cloudflare/Google DoH-resolved IP addresses for GitHub. Bypassing DoH for GitHub manifests dropped provider fleet initialization times from **148 seconds down to 800ms**.

#### 4. Smart Cache Invalidation & Force Refresh
* **Wildcard Cache Purging**:
  - The Force Refresh action (via `/stream/:type/:id/refresh.json` or the web dashboard) now performs a pattern scan (`cb:str:*<cleanId>*`) across Redis KV and purges all related quality and audio permutations alongside local LRU memory caches.
  - Allows users to instantly fetch newly released BluRay/REMUX copies or new episode releases without waiting for TTL expiration.

#### 5. Sandboxed VM Scraper Execution (`providerLoader.js`)
* **Full Browser & Node Runtime Emulation**:
  - Injected missing globals into the Node.js `vm.createContext` sandbox:
    - `SCRAPER_SETTINGS` (allowing scrapers to read custom domain overrides and timeouts)
    - `global` and `globalThis` circular references
    - `fetch` with browser User-Agent headers
    - `crypto`, `Buffer`, `btoa`, `atob`, `URL`, `URLSearchParams`
  - Fixed Cheerio v1.0.0+ interoperability by creating a safe export wrapper that does not attempt to mutate frozen `__esModule` descriptors.

#### 6. HubCloud Direct Link Extraction (`hubcloudResolver.js`)
* Built-in on-the-fly resolver for HubCloud intermediate redirect pages, extracting direct CDN video links (`.mkv`, `.mp4`) without requiring browser popups or captcha bypasses.

---

## [4.3.0] - 2026-09-09

### Added
- **Multi-Debrid Provider Expansion**:
  - Added support for **TorBox** (`api.torbox.app`) and **Premiumize** (`www.premiumize.me`) alongside Real-Debrid and AllDebrid.
  - Instant cached torrent unrestrict and health badging: `⚡ [TB+]` and `⚡ [PM+]`.
- **Universal Stream Proxy Endpoint (`/proxy/stream`)**:
  - Server-side streaming proxy supporting custom request headers (`Referer`, `User-Agent`, `Origin`), Range requests, and CORS headers for restricted video hosts.
- **Regional Indian Language Grouping**:
  - Added dedicated audio priority groups for Hindi, Tamil, Telugu, Malayalam, Kannada, Bengali, and Marathi in addition to Dual-Audio, English, and Japanese.

### Changed
- Extended serverless execution thresholds on Vercel deployments (55s) to maximize stream yield when querying large provider fleets.
- Added response compression middleware (`compression`) across all JSON and catalog endpoints.

### Fixed
- Fixed URL state preservation bug where configuration token IDs were lost upon refreshing the browser.
- Fixed stream card title overloading when `cleanTitles` mode was enabled.

---

## [4.2.0] - 2026-09-03

### Added
- **Curated Discovery Feeds**:
  - Native Stremio and Nuvio catalog feeds:
    - *Popular Right Now*
    - *Trending Indian Cinema*
    - *Anime Hub*
    - *Live TV Channels* (News, Sports, Entertainment, Regional)
- **Instant Debrid Pre-Flight Verification**:
  - Added one-click account verification in the web dashboard to check API token validity, subscription expiration date, and cloud storage status.
- **Genre & Discovery Expansion**:
  - 30+ sub-genres and categorization tags across movies and TV series.

### Changed
- Improved catalog metadata response headers with optimized `stale-while-revalidate` caching.
- Enhanced Live TV channel cards with visual category tags.

---

## [4.1.0] - 2026-08-27

### Added
- **Interactive Guided Setup Tour**:
  - Interactive onboarding modal introducing new users to sorting algorithms, provider selection, and Debrid API configuration.
- **Modern Theme Engine**:
  - Introduced Light Theme alongside the signature Dark Glassmorphism interface, powered by modular CSS custom properties.
- **Real-Time Scraper Benchmark Runner**:
  - Diagnostic test bench allowing users to benchmark individual scrapers against live IMDB targets with latency and stream yield readouts.

### Fixed
- Fixed mobile navbar squishing and floating dropdown alignment on small viewport screens.
- Fixed translation modal color contrast in light mode.

---

## [4.0.0] - 2026-08-22

### Added
- **IPTV Playlist Studio**:
  - Native M3U/M3U8 playlist parser and Xtream Codes API v2 client.
  - Categorized Channel Explorer with live stream latency probing before playback.
- **Automated CAM & Screener Filtering**:
  - Heuristic regex engine that identifies and removes low-quality theater rips (`CAM`, `HDCAM`, `TeleSync`, `TC`, `SCR`).
- **Client-Side Configuration Encryption**:
  - AES-based encryption (`enc_` token format) preventing sensitive Debrid API keys from being exposed in plaintext URLs or server logs.

### Changed
- Complete redesign of the configuration interface with glassmorphism, responsive tabbed navigation, and live system telemetry.
- Defaulted Live TV feeds to disabled on fresh installs to prioritize movie/series scraping speed.

---

## [3.4.0] - 2026-08-22

### Added
- **Eco Mode Heuristic Engine**:
  - Low-bandwidth profile that limits simultaneous provider queries and stream resolution tiers for mobile data connections.
- Granular scraper toggle switches in the Sources tab.

### Fixed
- Fixed server port collision errors during daemon startup on local environments.

---

## [3.3.0] - 2026-08-20

### Added
- **Scraper Quarantine Dashboard**:
  - Live inspection panel showing temporarily isolated scrapers with countdown recovery timers.
- Enhanced proxy error logging with HTTP status breakdowns.

---

## [3.2.0] - 2026-08-18

### Added
- **Scraper Auto-Quarantine System**:
  - Automatically isolates scrapers for 10 minutes upon 3 consecutive network failures or timeout errors, preventing broken providers from degrading overall response times.

---

## [3.1.0] - 2026-08-18

### Added
- **Live Latency Engine**:
  - Concurrent HTTP `Range: bytes=0-1024` stream probing to measure millisecond ping times prior to delivering links to the player.
- **Diagnostic Telemetry**:
  - Live server RSS memory gauges, active V8 heap monitoring, and cache hit ratio analytics.

---

## [3.0.0] - 2026-08-14

### Added
- **Dynamic Multi-Provider Architecture**:
  - Support for loading external scraper packages (Eclipsia, Yoruix, D3adlyRocket, and custom URLs) on demand.
- **Promise Concurrency Limiter**:
  - Bounded task runner preventing network socket saturation during mass provider queries.

---

## [2.0.0] - 2026-08-06

### Added
- **P2P Swarm Health Badging**:
  - Real-time torrent tracker seeder scraping mapping swarm health: `🟢 20+ Healthy`, `🟡 5–19 Moderate`, `🔴 1–4 Low`.
- **Strict Resolution Tier Sorting**:
  - Deterministic quality hierarchy (`4K UHD` > `1080p FHD` > `720p HD` > `480p SD`). Lower quality streams are prevented from leapfrogging 4K streams in Quality mode.
- **Regional Audio Priority Engine**:
  - Custom language prioritization floating preferred audio tracks (Hindi, Tamil, Telugu, Dual-Audio, English) to the top of the stream list.

---

## [1.0.0] - 2026-07-18

### Added
- Initial public release of **Chole Bhature** stream meta-sorter for Nuvio and Stremio.
- Concurrent stream scraping across primary community providers.
- Real-Debrid unrestrict engine for cached torrents.
- Stremio Addon Protocol v1 compliance with dynamic manifest generation.
