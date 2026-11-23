// LaunchLens dashboard: renders window.RADAR (written by main.ts from the sealed snapshot).
// Sortable, filterable board + per-protocol detail view + a live-token comparison strip that
// stays separate from the board. No network: every byte comes from data.js beside this page.
(function () {
  var R = window.RADAR;
  var main = document.getElementById('board');
  if (!R || !main) { main.textContent = 'Radar data missing: run main.ts first.'; return; }

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    conf: params.get('conf') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    detail: params.get('detail') || ''
  };

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'pos' : 'neg') + '">' + s + '</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 30) return Math.round(days / 30) + ' mo';
    return days + ' d';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function uniq(list) { return Array.from(new Set(list)).sort(); }

  var cats = uniq(R.rows.map(function (r) { return r.category || 'Uncategorised'; }));
  var chains = uniq(R.rows.flatMap(function (r) { return r.chains; }));

  function filtered() {
    var rows = R.rows.filter(function (r) {
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q.toLowerCase()) === -1) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.conf && r.confidence !== state.conf) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
    var key = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || -999) - (a.change_7d || -999); },
      age: function (a, b) { return (b.age_days || -1) - (a.age_days || -1); },
      farm: function (a, b) { return b.farm_score - a.farm_score; }
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return rows.sort(key);
  }

  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (state.detail === r.slug ? 'sel' : '') + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? ' <span class="badge watch">WATCHLIST</span>' : '') +
      '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num">' + r.peer_multiple.toFixed(2) + 'x</td>' +
      '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
      '<td class="num"><span class="farmbar"><i style="width:' + r.farm_score + '%"></i></span>' + r.farm_score + '</td>' +
      '<td><span class="badge conf-' + r.confidence + '">' + r.confidence + '</span></td></tr>';
  }

  function detailHtml(r) {
    var peers = R.live.filter(function (l) { return l.category === r.category; }).slice(0, 3);
    var peerLine = r.peer_count > 0
      ? 'Priced from ' + r.peer_count + ' live peer' + (r.peer_count === 1 ? '' : 's') + ' in ' + esc(r.category || 'this category') +
        (peers.length ? ' — among the largest: ' + peers.map(function (l) {
          return esc(l.name) + ' ' + (l.multiple !== null ? l.multiple.toFixed(2) + 'x TVL' : '—');
        }).join(' · ') : '') +
        '. The category median is shrunk toward the global median (' + R.global_multiple.toFixed(2) + 'x) by sample size, giving ' + r.peer_multiple.toFixed(2) + 'x.'
      : 'No live peer in its exact category: this row borrows the global median multiple of ' + R.global_multiple.toFixed(2) + 'x TVL.';
    function factor(label, value, pct) {
      return '<div class="factor"><span>' + label + '</span><span class="bar"><i style="width:' + Math.max(3, Math.min(100, pct)) + '%"></i></span><span class="val">' + value + '</span></div>';
    }
    var steps = r.farm_steps.map(function (s) {
      var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
      if (!m) return '<li>' + esc(s) + '</li>';
      return '<li>' + esc(m[1]) + ' <span class="meta">Cost: ' + esc(m[2]) + ' · Time: ' + esc(m[3]) + '</span></li>';
    }).join('');
    return '<h2>' + esc(r.name) + ' <span class="badge watch">' + (r.watchlist ? 'on the watchlist' : 'early find below the floor') + '</span></h2>' +
      '<p class="sub">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · records no token in DefiLlama as of ' + R.as_of +
      ' · farm archetype: ' + esc(r.archetype) + '</p>' +
      '<div class="grid">' +
      '<div class="cell"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
      '<div class="cell"><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
      '<div class="cell"><span>7d change</span><b>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div class="cell"><span>Age, no token</span><b>' + fmtAge(r.age_days) + '</b></div>' +
      '<div class="cell"><span>Farm score</span><b>' + r.farm_score + ' / 100</b></div>' +
      '<div class="cell"><span>Confidence</span><b>' + r.confidence + '</b></div></div>' +
      '<div class="factors">' +
      factor('Peer multiple (peerMultipleFor)', r.peer_multiple.toFixed(2) + 'x', r.peer_multiple / 2.5 * 100) +
      factor('Momentum (momentumFactor)', r.momentum_factor.toFixed(2) + 'x', (r.momentum_factor - 0.6) / 0.8 * 100) +
      factor('Endurance (enduranceFactor)', r.endurance_factor.toFixed(2) + 'x', (r.endurance_factor - 0.7) / 0.45 * 100) +
      factor('Breadth (breadthFactor)', r.breadth_factor.toFixed(2) + 'x', (r.breadth_factor - 1) / 0.15 * 100) +
      factor('Scale (scaleFactor)', r.scale_factor.toFixed(2) + 'x', r.scale_factor * 100) +
      '</div><p>' + peerLine + '</p>' +
      '<h3>Farm plan — farmPlaybookFor, seven steps</h3><ol class="steps">' + steps + '</ol>';
  }

  function render() {
    var rows = filtered();
    var detail = R.rows.find(function (r) { return r.slug === state.detail; }) || null;
    var catOpts = '<option value="">All categories</option>' + cats.map(function (c) {
      return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var chainOpts = '<option value="">All chains</option>' + chains.map(function (c) {
      return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var confOpts = '<option value="">Any confidence</option>' + ['High', 'Medium', 'Early'].map(function (c) {
      return '<option' + (state.conf === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    var sortOpts = [['rank', 'Rank (implied value)'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['farm', 'Farm score']].map(function (o) {
      return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    var liveRows = R.live.map(function (l) {
      return '<tr><td><span class="pname">' + esc(l.name) + '</span><br><span class="pslug">' + esc(l.slug) + '</span></td>' +
        '<td>' + esc(l.category || 'Uncategorised') + '</td><td class="num">' + fmtUsd(l.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(l.mcap_usd) + '</td><td class="num">' + (l.multiple !== null ? l.multiple.toFixed(2) + 'x' : '—') + '</td>' +
        '<td class="num">' + fmtPct(l.change_7d) + '</td></tr>';
    }).join('');

    main.innerHTML =
      '<header class="top"><div class="brand"><h1>Launch<span class="lens">Lens</span> — Token Launch Radar</h1>' +
      '<p>Pre-token protocols ranked by what their launch would be worth if their record stayed as it is. ' +
      'Every protocol below records no token in DefiLlama (snapshot ' + R.as_of + '); tokens that already trade are kept apart in the live strip at the bottom — they are the yardstick, never the ranked.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + R.board_size + '</b><span>board rows</span></div>' +
      '<div class="stat"><b>' + R.watchlist_size + '/' + R.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + R.early_size + '</b><span>early below $50M floor</span></div>' +
      '<div class="stat"><b>' + R.global_multiple.toFixed(2) + 'x</b><span>global peer multiple</span></div>' +
      '</div></header>' +
      '<section class="model"><h2>How the value is derived — model ' + esc(R.model_version) + ', no hardcoded names</h2>' +
      '<p><code>computeImpliedValue</code> prices each protocol from the snapshot itself. <code>peerMultipleFor</code> reads what the market pays per $1 of TVL for live-token protocols in the same category (median mcap/TVL, shrunk toward the global median by sample size). ' +
      '<code>momentumFactor</code> bends the 7-day TVL change with diminishing returns, <code>enduranceFactor</code> rewards years survived with no token on a log ramp, <code>breadthFactor</code> adds a capped multi-chain premium, and <code>scaleFactor</code> compresses very large TVL. Farm plans come from <code>farmPlaybookFor</code>: a category archetype, a capital tier from TVL, and the gas class of the first chain.</p>' +
      '<div class="formula">implied = TVL x peerMultiple x momentum x endurance x breadth x scale</div></section>' +
      (detail && params.get('detail') ? '<section class="detail" id="detail">' + detailHtml(detail) + '</section>' : '') +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
      '<select id="cat">' + catOpts + '</select><select id="chain">' + chainOpts + '</select><select id="conf">' + confOpts + '</select>' +
      '<label><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<label>Sort <select id="sort">' + sortOpts + '</select></label>' +
      '<span class="count">' + rows.length + ' of ' + R.board_size + ' protocols shown — click a row for its detail and farm plan</span></div>' +
      '<table><thead><tr><th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Peer x</th><th class="num">Implied value</th><th class="num">Farm</th><th>Confidence</th></tr></thead>' +
      '<tbody>' + rows.map(rowHtml).join('') + '</tbody></table>' +
      (detail && !params.get('detail') ? '<section class="detail" id="detail">' + detailHtml(detail) + '</section>' : '') +
      '<section class="live"><h2>Live-token yardstick — already trading, never ranked</h2>' +
      '<p>These protocols already have a token; the board never ranks them. Their market cap per $1 of TVL is the raw material <code>peerMultipleFor</code> medians into the multiples above.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th><th class="num">7d</th></tr></thead><tbody>' + liveRows + '</tbody></table></section>' +
      '<footer>LaunchLens reads only the sealed DefiLlama snapshot (' + esc(R.source) + '). “Records no token” is DefiLlama’s record, not proof a token does not exist. Implied values are this entry’s own model output, not a prediction that a token will launch.</footer>';

    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; rerender(false); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; rerender(true); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; rerender(true); });
    document.getElementById('conf').addEventListener('change', function (e) { state.conf = e.target.value; rerender(true); });
    document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; rerender(true); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; rerender(true); });
    Array.prototype.forEach.call(main.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { state.detail = tr.getAttribute('data-slug'); rerender(true); });
    });
    var d = document.getElementById('detail');
    if (d && params.get('detail')) { document.body.classList.add('detailmode'); window.scrollTo(0, 0); }
  }
  function rerender(refocus) { render(); if (!refocus) { var q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  render();
  window.__shotReady = true;
})();
