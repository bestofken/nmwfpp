// Pulls live basketball odds from The Odds API and writes data/games.json.
// Runs in GitHub Actions on a daily schedule. Needs env var ODDS_API_KEY.
//
// Cost control: only fetches leagues that are actually in season right now,
// and only h2h + spreads + totals (no player props) to stay on the free tier.
// Free tier = 500 credits/month. Each call below costs (markets x regions),
// so 3 markets x 1 region = 3 credits per league per run.

import { writeFileSync, mkdirSync } from 'fs';

const KEY = process.env.ODDS_API_KEY;
if (!KEY) {
  console.error('Missing ODDS_API_KEY environment variable.');
  process.exit(1);
}

// Basketball leagues The Odds API tracks. Not all are in season year-round;
// a 404 or empty response for an out-of-season league is expected, not an error.
const LEAGUES = [
  { key: 'basketball_nba', label: 'NBA' },
  { key: 'basketball_wnba', label: 'WNBA' },
  { key: 'basketball_euroleague', label: 'EuroLeague' },
  { key: 'basketball_ncaab', label: 'NCAAB' },
];

const BASE = 'https://api.the-odds-api.com/v4/sports';
const MARKETS = 'h2h,spreads,totals';
const REGIONS = 'us,uk,eu';

async function fetchLeague(league) {
  const url = `${BASE}/${league.key}/odds?regions=${REGIONS}&markets=${MARKETS}&oddsFormat=decimal&apiKey=${KEY}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`Network error fetching ${league.label}:`, err.message);
    return { league: league.label, games: [], error: 'network_error' };
  }

  const remaining = res.headers.get('x-requests-remaining');
  const used = res.headers.get('x-requests-used');
  if (remaining !== null) {
    console.log(`[quota] after ${league.label}: used=${used} remaining=${remaining}`);
  }

  if (res.status === 404) {
    // League not currently offered (common in off-season).
    console.log(`${league.label}: not currently available (404) — likely off-season.`);
    return { league: league.label, games: [] };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`${league.label}: HTTP ${res.status} — ${body.slice(0, 300)}`);
    return { league: league.label, games: [], error: `http_${res.status}` };
  }

  const raw = await res.json();
  const games = raw.map(normalizeGame).filter(Boolean);
  console.log(`${league.label}: ${games.length} games`);
  return { league: league.label, games };
}

function normalizeGame(g) {
  if (!g.bookmakers || !g.bookmakers.length) return null;

  // Aggregate best available price per outcome across all returned bookmakers,
  // so the app can show "best odds you could actually get" rather than one book.
  const best = { h2h: {}, spreads: {}, totals: {} };
  for (const bm of g.bookmakers) {
    for (const mkt of bm.markets || []) {
      if (!best[mkt.key]) continue;
      for (const oc of mkt.outcomes || []) {
        const id = mkt.key === 'totals' ? `${oc.name}_${oc.point}` : (oc.point !== undefined ? `${oc.name}_${oc.point}` : oc.name);
        const cur = best[mkt.key][id];
        if (!cur || oc.price > cur.price) {
          best[mkt.key][id] = { name: oc.name, point: oc.point ?? null, price: oc.price, book: bm.title };
        }
      }
    }
  }

  return {
    id: g.id,
    league: g.sport_title,
    commence: g.commence_time,
    home: g.home_team,
    away: g.away_team,
    markets: {
      h2h: Object.values(best.h2h),
      spreads: Object.values(best.spreads),
      totals: Object.values(best.totals),
    },
  };
}

const results = [];
for (const league of LEAGUES) {
  results.push(await fetchLeague(league));
  // Small delay so we don't hammer the API back-to-back.
  await new Promise((r) => setTimeout(r, 300));
}

const out = {
  generatedAt: new Date().toISOString(),
  leagues: results,
};

mkdirSync('data', { recursive: true });
writeFileSync('data/games.json', JSON.stringify(out, null, 2));

const totalGames = results.reduce((n, r) => n + r.games.length, 0);
console.log(`\nWrote data/games.json — ${totalGames} games across ${results.length} leagues.`);

const hadHardError = results.some((r) => r.error && r.error !== 'network_error');
if (hadHardError) {
  console.error('One or more leagues returned an error. Check logs above.');
  process.exit(1);
}
