# RU Scraper Microservice

Playwright-based scraper with RU proxy rotation. Worker (Cloudflare) calls this
service for sites that block western IPs / require JS rendering.

## Endpoint

`POST /scrape` — headers: `x-token: <SCRAPER_TOKEN>`

Body:
```json
{ "url": "https://...", "waitFor": 4000, "waitForSelector": ".odds-cell" }
```

Response:
```json
{ "ok": true, "markdown": "...", "title": "...", "length": 12345, "ms": 8123 }
```

## Deploy on Render.com (recommended)

1. Push this repo to GitHub.
2. Render → New → Web Service → Connect repo.
3. Settings:
   - **Root Directory:** `scraper-service`
   - **Runtime:** Docker
   - **Instance Type:** Starter ($7/mo) — free tier sleeps and is too slow for cold-start.
4. Environment variables:
   - `SCRAPER_TOKEN` — random 32+ char string (also paste into Lovable as `SCRAPER_TOKEN`)
   - `RU_PROXY_LIST` — `user:pass@ip:port,user:pass@ip:port` (your Russian proxies, comma-separated)
5. Deploy. Copy the URL (e.g. `https://ru-scraper-xyz.onrender.com`).
6. In Lovable, set secret `SCRAPER_URL` = that URL.

## Deploy on Railway

Same steps; choose Dockerfile auto-detect, set the same env vars.

## Local test

```bash
cd scraper-service
docker build -t ru-scraper .
docker run -p 3000:3000 \
  -e SCRAPER_TOKEN=test \
  -e RU_PROXY_LIST="user:pass@1.2.3.4:3550" \
  ru-scraper

curl -X POST http://localhost:3000/scrape \
  -H "x-token: test" -H "content-type: application/json" \
  -d '{"url":"https://www.marathonbet.ru/su/live/popular","waitFor":5000}'
```
