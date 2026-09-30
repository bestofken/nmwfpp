(function () {
  'use strict';

  var Q = 250; // log-odds resolution for the slip builder's DP grid
  var state = { minProb: 60, budget: 2000, safe: 70, bomb: 10, leagues: {} };
  var GAMES = [];
  var built = { safe: [], bomb: [] };

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return n.toFixed(2); }
  function naira(n) { return '\u20A6' + Math.round(n).toLocaleString('en-NG'); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---------- turn one game's bookmaker prices into candidate legs ----------
  // De-vig: for a two-way market, true prob = (1/price_a) / (1/price_a + 1/price_b).
  function devigPair(pA, pB) {
    var ia = 1 / pA, ib = 1 / pB, sum = ia + ib;
    return { a: ia / sum, b: ib / sum };
  }

  function legsForGame(g) {
    var legs = [];
    var h2h = g.markets.h2h || [];
    var homeOc = h2h.find(function (o) { return o.name === g.home; });
    var awayOc = h2h.find(function (o) { return o.name === g.away; });
    if (homeOc && awayOc) {
      var dv = devigPair(homeOc.price, awayOc.price);
      legs.push({ gid: g.id, key: g.id + '_ml_home', label: g.home + ' to win', team: g.home, opp: g.away, p: dv.a, price: homeOc.price, market: 'Moneyline' });
      legs.push({ gid: g.id, key: g.id + '_ml_away', label: g.away + ' to win', team: g.away, opp: g.home, p: dv.b, price: awayOc.price, market: 'Moneyline' });
    }

    var spreads = g.markets.spreads || [];
    var byPoint = {};
    spreads.forEach(function (o) { (byPoint[Math.abs(o.point)] = byPoint[Math.abs(o.point)] || []).push(o); });
    Object.keys(byPoint).forEach(function (pt) {
      var pair = byPoint[pt];
      if (pair.length !== 2) return;
      var dv = devigPair(pair[0].price, pair[1].price);
      var probs = [dv.a, dv.b];
      pair.forEach(function (o, i) {
        var sign = o.point > 0 ? '+' : '';
        legs.push({
          gid: g.id, key: g.id + '_sp_' + o.name + '_' + o.point,
          label: o.name + ' ' + sign + o.point, team: o.name, opp: (o.name === g.home ? g.away : g.home),
          p: probs[i], price: o.price, market: 'Spread'
        });
      });
    });

    var totals = g.markets.totals || [];
    var byPointT = {};
    totals.forEach(function (o) { (byPointT[o.point] = byPointT[o.point] || []).push(o); });
    Object.keys(byPointT).forEach(function (pt) {
      var pair = byPointT[pt];
      if (pair.length !== 2) return;
      var over = pair.find(function (o) { return o.name === 'Over'; });
      var under = pair.find(function (o) { return o.name === 'Under'; });
      if (!over || !under) return;
      var dv = devigPair(over.price, under.price);
      legs.push({ gid: g.id, key: g.id + '_to_over_' + pt, label: 'Over ' + pt + ' total points', team: g.home + '/' + g.away, opp: '', p: dv.a, price: over.price, market: 'Total' });
      legs.push({ gid: g.id, key: g.id + '_to_under_' + pt, label: 'Under ' + pt + ' total points', team: g.home + '/' + g.away, opp: '', p: dv.b, price: under.price, market: 'Total' });
    });

    legs.forEach(function (l) { l.step = Math.round(Math.log(l.price) * Q); l.sub = l.market + ', ' + g.home + ' vs ' + g.away; });
    return legs;
  }

  // ---------- slip builder (same DP approach as the prototype) ----------
  function bestSlip(games, lo, hi, T) {
    var L = 14, W = L + 1, maxB = Math.floor(Math.log(hi) * Q) + 2, size = maxB * W, z;
    var cur = new Array(size);
    for (z = 0; z < size; z++) cur[z] = null;
    cur[0] = { mp: 1, node: null };
    games.forEach(function (gm) {
      var nxt = cur.slice(), b, l, k, st, leg, nb, idx, mp;
      for (b = 0; b < maxB; b++) {
        for (l = 0; l < L; l++) {
          st = cur[b * W + l];
          if (!st) continue;
          for (k = 0; k < gm.opts.length; k++) {
            leg = gm.opts[k]; nb = b + leg.step;
            if (nb >= maxB) break;
            idx = nb * W + l + 1;
            mp = st.mp < leg.p ? st.mp : leg.p;
            if (!nxt[idx] || mp > nxt[idx].mp) nxt[idx] = { mp: mp, node: { leg: leg, prev: st.node } };
          }
        }
      }
      cur = nxt;
    });
    var loB = Math.max(0, Math.floor(Math.log(lo) * Q) - 3), hiB = Math.min(maxB - 1, Math.ceil(Math.log(hi) * Q) + 3);
    var best = null, b2, l2, s, legs, nd, o, p, cand;
    for (b2 = loB; b2 <= hiB; b2++) {
      for (l2 = 1; l2 <= L; l2++) {
        s = cur[b2 * W + l2];
        if (!s) continue;
        legs = []; nd = s.node; o = 1; p = 1;
        while (nd) { legs.push(nd.leg); o *= nd.leg.price; p *= nd.leg.p; nd = nd.prev; }
        if (o < lo || o > hi) continue;
        legs.reverse();
        cand = { o: o, p: p, mp: s.mp, legs: legs, c: Math.round(Math.abs(Math.log(o / T)) * 50) };
        if (!best || cand.c < best.c || (cand.c === best.c && (cand.legs.length < best.legs.length ||
          (cand.legs.length === best.legs.length && cand.mp > best.mp)))) best = cand;
      }
    }
    return best;
  }

  function makeSlips(target, phases, poolGames) {
    var lo = target * 0.92, hi = target * 1.15, used = {}, slips = [];
    phases.forEach(function (ph) {
      var n = 0;
      while (n < ph.max && slips.length < 5) {
        var games = poolGames.filter(function (g) { return !used[g.id]; })
          .map(function (g) { return { id: g.id, opts: legsForGame(g).filter(function (l) { return l.p >= ph.min && l.p <= 0.97; }) }; })
          .filter(function (x) { return x.opts.length; });
        var best = bestSlip(games, lo, hi, target);
        if (!best) break;
        best.legs.forEach(function (l) { used[l.gid] = 1; });
        slips.push(best); n++;
      }
    });
    return slips;
  }

  // ---------- rendering ----------
  function activeGames() {
    var on = Object.keys(state.leagues).filter(function (k) { return state.leagues[k]; });
    return GAMES.filter(function (g) { return on.indexOf(g.league) !== -1; });
  }

  function renderLeagueBar() {
    var leagues = Array.from(new Set(GAMES.map(function (g) { return g.league; })));
    if (!leagues.length) { $('leagueBar').innerHTML = ''; return; }
    leagues.forEach(function (l) { if (!(l in state.leagues)) state.leagues[l] = true; });
    $('leagueBar').innerHTML = leagues.map(function (l) {
      return '<button type="button" data-league="' + esc(l) + '" class="' + (state.leagues[l] ? 'on' : '') + '">' + esc(l) + '</button>';
    }).join('');
  }

  function renderBoard() {
    var games = activeGames();
    if (!games.length) {
      $('board').innerHTML = '<p class="sub">No games loaded for the selected leagues right now.</p>';
      return;
    }
    $('board').innerHTML = games.map(function (g) {
      var h2h = (g.markets.h2h || []);
      var homeOc = h2h.find(function (o) { return o.name === g.home; });
      var awayOc = h2h.find(function (o) { return o.name === g.away; });
      var pctTxt = '';
      if (homeOc && awayOc) {
        var dv = devigPair(homeOc.price, awayOc.price);
        var favIsHome = dv.a >= dv.b;
        pctTxt = (favIsHome ? g.home : g.away) + ' ' + Math.round((favIsHome ? dv.a : dv.b) * 100) + '%';
      }
      var when = new Date(g.commence).toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      var noteHtml = g.note
        ? '<div class="note">' + esc(g.note) + '</div>'
        : '<div class="note loading">No research note loaded for this game yet.</div>';
      return '<div class="game"><div class="hd"><h3>' + esc(g.home) + ' vs ' + esc(g.away) + '</h3>' +
        '<span>' + esc(g.league) + ' &middot; ' + when + (pctTxt ? ' &middot; ' + esc(pctTxt) : '') + '</span></div>' +
        noteHtml + '</div>';
    }).join('');
  }

  function ticketHtml(key, i, s, cls) {
    var legsHtml = s.legs.map(function (l) {
      return '<li><div><strong>' + esc(l.label) + '</strong><span>' + Math.round(l.p * 100) + '% chance, ' + esc(l.sub) + '</span></div>' +
        '<div class="lo">' + fmt(l.price) + '</div></li>';
    }).join('');
    var label = s.p >= 0.5 ? ['Strong', 'strong'] : s.p >= 0.3 ? ['Moderate', 'mod'] : ['Long shot', 'long'];
    var stakeLine = s.stake > 0 ? 'Stake ' + naira(s.stake) + ' returns ' + naira(s.stake * s.o) : '';
    return '<article class="ticket ' + cls + '">' +
      '<div class="stub"><span class="tot">' + fmt(s.o) + '</span><small>total odds</small><small>' + s.legs.length + (s.legs.length === 1 ? ' leg' : ' legs') + '</small></div>' +
      '<div><ul class="legs">' + legsHtml + '</ul>' +
      '<div class="foot"><div><div>Hit chance ' + Math.round(s.p * 100) + '%, about 1 in ' + Math.max(1, Math.round(1 / s.p)) + '</div><div>' + stakeLine + '</div></div>' +
      '<span class="badge ' + label[1] + '">' + label[0] + '</span></div></div>' +
      '</article>';
  }

  function renderGroup(key, target, cls, slips) {
    var box = $('slips' + target), st = $('st' + target);
    $('sub' + target).textContent = 'Total odds between ' + fmt(target * 0.92) + ' and ' + fmt(target * 1.15) +
      (target === 3 ? '. Fewest legs, strongest weakest leg.' : '. Steady legs first, then a couple of stretch legs. Keep stakes small.');
    if (!slips.length) {
      box.innerHTML = '<div class="empty">Today\'s games can\'t make a ' + target + '-odds slip at your safe line without repeating a game. Try a lower safe line, more leagues, or wait for a bigger slate.</div>';
      st.textContent = '0 of 5 slips built.';
      return;
    }
    st.textContent = slips.length < 5
      ? slips.length + ' of 5 slips built. The rest would need a game that is already used.'
      : '5 of 5 slips built.';
    box.innerHTML = slips.map(function (s, i) { return ticketHtml(key, i, s, cls); }).join('');
  }

  function updateStakes() {
    var budget = Math.max(0, parseFloat(state.budget) || 0);
    var safe = Math.max(0, state.safe || 0), bomb = Math.max(0, state.bomb || 0);
    var safeB = budget * safe / 100, bombB = budget * bomb / 100;
    built.safe.forEach(function (s) { s.stake = safeB / built.safe.length; });
    built.bomb.forEach(function (s) { s.stake = bombB / built.bomb.length; });
    var reservePct = Math.max(0, 100 - safe - bomb);
    $('reserve').textContent = reservePct + '%';
    var lines = [];
    lines.push(built.safe.length ? 'Safe slips: ' + naira(safeB) + ' across ' + built.safe.length + (built.safe.length === 1 ? ' slip.' : ' slips.') : 'Safe slips: none today, so ' + naira(safeB) + ' stays in your bankroll.');
    lines.push(built.bomb.length ? '10-odds slips: ' + naira(bombB) + ' across ' + built.bomb.length + (built.bomb.length === 1 ? ' slip.' : ' slips.') : '10-odds slips: none today, so ' + naira(bombB) + ' stays in your bankroll.');
    lines.push('Reserve: ' + naira(budget * reservePct / 100) + '.');
    if (safe + bomb > 100) lines.push('Your safe and 10-odds shares add up to more than 100%.');
    $('stakeNote').innerHTML = lines.map(function (l) { return '<p>' + l + '</p>'; }).join('');
  }

  function renderSlips() {
    var m = state.minProb / 100;
    var pool = activeGames();
    built.safe = makeSlips(3, [{ min: m, max: 5 }], pool);
    built.bomb = makeSlips(10, [{ min: m, max: 3 }, { min: Math.max(0.45, m - 0.12), max: 2 }, { min: m, max: 5 }], pool);
    renderGroup('safe', 3, 'safe', built.safe);
    renderGroup('bomb', 10, 'bomb', built.bomb);
    updateStakes();
  }

  function renderAll() { renderLeagueBar(); renderBoard(); renderSlips(); }

  document.addEventListener('click', function (e) {
    var lg = e.target.getAttribute && e.target.getAttribute('data-league');
    if (!lg) return;
    state.leagues[lg] = !state.leagues[lg];
    renderAll();
  });
  $('line').addEventListener('input', function (e) { state.minProb = +e.target.value; $('lineOut').textContent = state.minProb + '%'; renderBoard(); renderSlips(); });
  $('budget').addEventListener('input', function (e) { state.budget = parseFloat(e.target.value) || 0; updateStakes(); });
  $('safePct').addEventListener('input', function (e) { state.safe = parseFloat(e.target.value) || 0; updateStakes(); });
  $('bombPct').addEventListener('input', function (e) { state.bomb = parseFloat(e.target.value) || 0; updateStakes(); });

  // ---------- load data ----------
  function showError(msg) { $('err-section').hidden = false; $('errBox').textContent = msg; }

  fetch('data/games.json?_=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      var when = new Date(data.generatedAt);
      $('asOf').textContent = 'Odds last refreshed ' + when.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) + '.';
      GAMES = [];
      (data.leagues || []).forEach(function (entry) {
        (entry.games || []).forEach(function (g) { GAMES.push(g); });
      });
      var failed = (data.leagues || []).filter(function (l) { return l.error; }).map(function (l) { return l.league; });
      if (failed.length) showError('Some leagues did not refresh today (' + failed.join(', ') + '). Showing whatever loaded successfully.');
      if (!GAMES.length) showError('No basketball games are currently listed by tracked bookmakers. Check back closer to game time.');
      renderAll();
    })
    .catch(function (err) {
      showError('Could not load today\'s games (' + err.message + '). The daily refresh may not have run yet — try again shortly, or check the Actions tab in the repo.');
      $('asOf').textContent = 'No data loaded.';
    });
})();
