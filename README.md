# Basketball slips

Live bookmaker odds, refreshed daily, built into 3-odds and 10-odds parlay
slips with no game repeated in a group. Runs entirely on GitHub Pages —
no server to maintain.

## How it works

- `scripts/fetch-odds.mjs` calls The Odds API for NBA, WNBA, EuroLeague and
  NCAAB, keeps the best price per outcome across tracked bookmakers, and
  writes `data/games.json`.
- `.github/workflows/refresh-odds.yml` runs that script once a day
  (10:00 UTC / 11:00 Lagos) and commits the result automatically. You can
  also trigger it manually from the Actions tab any time.
- `index.html` + `app.js` load `data/games.json`, de-vig the odds into win
  chances, and build the slips client-side. No backend, no database.

## One-time setup

1. In this repo: **Settings → Secrets and variables → Actions → New
   repository secret**. Name it `ODDS_API_KEY`, paste your key from
   the-odds-api.com, save.
2. **Settings → Pages → Source: Deploy from a branch → main / (root)**. Save.
3. **Actions tab → Refresh basketball odds → Run workflow** to populate
   `data/games.json` for the first time.
4. Your site is live at `https://<username>.github.io/<repo-name>/`.

After that, it refreshes itself daily with no further action needed.

## Changing the refresh time

Edit the `cron` line in `.github/workflows/refresh-odds.yml`. It's in UTC.

## Free tier limits

The Odds API free tier gives 500 credits/month. This setup costs about
3-12 credits per day depending on how many leagues are in season, well
within the free tier for daily refreshes. If you add more leagues, more
markets, or refresh more than once a day, watch the Actions log — it
prints remaining credits after each fetch.
