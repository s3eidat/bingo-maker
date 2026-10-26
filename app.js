/* Bingo Maker — unique cards from crypto randomness (or a seeded PRNG for reproducible sets) and a caller. All local. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "bingo.v1", CKEY = "bingo.caller";

  // ---------- randomness ----------
  function cryptoRng() {
    var buf = new Uint32Array(1);
    return function (n) { var lim = Math.floor(0x100000000 / n) * n; do { crypto.getRandomValues(buf); } while (buf[0] >= lim); return buf[0] % n; };
  }
  // Seeded: cyrb128 string hash → sfc32 generator. Same seed, same sequence, on every browser.
  function seededRng(str) {
    var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (var i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    var a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
    function sfc() { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; var t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return (t >>> 0) / 4294967296; }
    for (var j = 0; j < 12; j++) sfc();
    return function (n) { return Math.floor(sfc() * n); };
  }
  function shuffle(a, rnd) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function range(from, to) { var a = []; for (var i = from; i <= to; i++) a.push(i); return a; }

  // ---------- card generators (tested) ----------
  // 75-ball: 5 columns B I N G O from 1–15, 16–30, … 61–75. grid[row][col]; null = free space.
  function card75(rnd, free) {
    var cols = [0, 1, 2, 3, 4].map(function (c) { return shuffle(range(c * 15 + 1, c * 15 + 15), rnd).slice(0, 5); });
    var g = [];
    for (var r = 0; r < 5; r++) g.push(cols.map(function (col, c) { return free && r === 2 && c === 2 ? null : col[r]; }));
    return g;
  }
  // 90-ball ticket: 3 rows × 9 columns, 5 numbers per row, every column 1–3 numbers (1–9, 10–19 … 80–90), sorted downwards.
  function card90(rnd) {
    var counts = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    for (var extra = 6; extra > 0;) { var c = rnd(9); if (counts[c] < 3) { counts[c]++; extra--; } }
    var rows = null;
    for (var attempt = 0; attempt < 200 && !rows; attempt++) {
      var load = [0, 0, 0], pick = [], ok = true;
      var order = shuffle(range(0, 8), rnd).sort(function (x, y) { return counts[y] - counts[x]; });
      order.forEach(function (c) {
        if (!ok) return;
        var free = [0, 1, 2].filter(function (r) { return load[r] < 5; });
        if (free.length < counts[c]) { ok = false; return; }
        // Prefer the emptiest rows so the 5-per-row rule can still be met.
        free = shuffle(free, rnd).sort(function (x, y) { return load[x] - load[y]; });
        var chosen = free.slice(0, counts[c]).sort();
        chosen.forEach(function (r) { load[r]++; });
        pick[c] = chosen;
      });
      if (ok && load[0] === 5 && load[1] === 5 && load[2] === 5) rows = pick;
    }
    var g = [[], [], []];
    for (var col = 0; col < 9; col++) {
      var lo = col === 0 ? 1 : col * 10, hi = col === 8 ? 90 : col * 10 + 9;
      var nums = shuffle(range(lo, hi), rnd).slice(0, counts[col]).sort(function (a, b) { return a - b; });
      for (var r = 0; r < 3; r++) { var at = rows[col].indexOf(r); g[r][col] = at >= 0 ? nums[at] : null; }
    }
    return g;
  }
  function cardWords(rnd, words, free) {
    var need = free ? 24 : 25, pick = shuffle(words.slice(), rnd).slice(0, need), g = [], k = 0;
    for (var r = 0; r < 5; r++) { g.push([]); for (var c = 0; c < 5; c++) g[r].push(free && r === 2 && c === 2 ? null : pick[k++]); }
    return g;
  }
  function makeSet(kind, n, opts) {
    var rnd = opts.seed ? seededRng(kind + "|" + (opts.free ? 1 : 0) + "|" + opts.seed + (kind === "words" ? "|" + opts.words.join("\n") : "")) : cryptoRng();
    var seen = {}, cards = [], tries = 0;
    while (cards.length < n && tries < n * 50) {
      tries++;
      var g = kind === "75" ? card75(rnd, opts.free) : kind === "90" ? card90(rnd) : cardWords(rnd, opts.words, opts.free);
      var key = JSON.stringify(g);
      if (seen[key]) continue;
      seen[key] = 1; cards.push(g);
    }
    return cards;
  }
  function parseWords(text) {
    var seen = {}, out = [];
    text.split(/\r?\n/).forEach(function (w) { w = w.trim().slice(0, 40); var k = w.toLowerCase(); if (w && !seen[k]) { seen[k] = 1; out.push(w); } });
    return out.slice(0, 500);
  }

  // ---------- state ----------
  var SAMPLE_WORDS = "Coffee\nDeadline\nZoom call\nSomeone's on mute\nCan you see my screen?\nLet's circle back\nAction item\nSynergy\nQuick question\nYou're frozen\nDog barking\nLet's take this offline\nI'll share my screen\nSorry, go ahead\nWe're out of time\nThumbs up\nBandwidth\nNext steps\nTouch base\nReply all\nLaptop dies\nCamera off\nBrainstorm\nWin-win\nLow-hanging fruit\nPing me\nMoving forward";
  var sv = S3.store(KEY) || {};
  var st = {
    kind: ["75", "90", "words"].indexOf(sv.kind) >= 0 ? sv.kind : "75",
    title: typeof sv.title === "string" ? sv.title.slice(0, 40) : "BINGO",
    words: typeof sv.words === "string" ? sv.words.slice(0, 20000) : SAMPLE_WORDS,
    free: sv.free !== false, count: sv.count >= 1 && sv.count <= 300 ? Math.round(sv.count) : 8,
    per: [1, 2, 4].indexOf(sv.per) >= 0 ? sv.per : 4, tab: "cards"
  };
  function save() { S3.store(KEY, { kind: st.kind, title: st.title, words: st.words, free: st.free, count: st.count, per: st.per }); }
  var cards = [], madeWith = null;

  function status() {
    var el = $("#status"), msg = "", bad = false;
    if (st.kind === "words") {
      var w = parseWords(st.words), need = st.free ? 24 : 25;
      $("#wordCount").textContent = "(" + w.length + " unique)";
      if (w.length < need) { bad = true; msg = "Add at least " + need + " different words (you have " + w.length + ")."; }
      else msg = w.length === need ? "Every card uses all " + need + " words in a different order. Add more words for more variety." : "Each card picks " + need + " of your " + w.length + " words.";
    } else msg = st.kind === "75" ? "Columns B 1–15, I 16–30, N 31–45, G 46–60, O 61–75." : "UK-style tickets: 3 rows of 5 numbers across 9 columns (1–90).";
    el.className = "bm-status" + (bad ? " bad" : ""); el.textContent = msg;
    $("#make").disabled = bad;
  }

  // ---------- render cards ----------
  function cardEl(g, i) {
    var kind = madeWith.kind, t = madeWith.title || "BINGO";
    var head = kind === "75" ? h("div", { "class": "bm-head five" }, "BINGO".split("").map(function (l) { return h("span", { text: l }); })) :
      h("div", { "class": "bm-head", dir: "auto", text: t });
    var grid = h("div", { "class": "bm-grid" + (kind === "90" ? " t90" : "") + (kind === "words" ? " words" : "") });
    g.forEach(function (row) {
      row.forEach(function (v) {
        if (v === null) grid.appendChild(h("span", { "class": kind === "90" ? "bm-blank" : "bm-free" }, kind === "90" ? [] : [h("b", { text: "★" }), h("small", { text: "FREE" })]));
        else grid.appendChild(h("span", { dir: kind === "words" ? "auto" : null, "class": kind === "words" && String(v).length > 12 ? "long" : null, text: String(v) }));
      });
    });
    var foot = h("div", { "class": "bm-foot" }, [h("span", { text: kind === "75" && t !== "BINGO" ? t : "" }), h("span", { text: "Card " + (i + 1) + (madeWith.seed ? " · seed " + madeWith.seed : "") })]);
    return h("div", { "class": "bm-card k" + kind }, [head, grid, foot]);
  }
  function renderCards() {
    var box = $("#preview"); box.textContent = "";
    if (!cards.length) { box.appendChild(h("div", { "class": "empty card" }, [h("b", { text: "No cards yet" }), "Pick a type and press \"Make cards\"."])); return; }
    var per = madeWith.per;
    for (var p = 0; p < cards.length; p += per) {
      var page = h("div", { "class": "bm-page per" + per + " k" + madeWith.kind });
      cards.slice(p, p + per).forEach(function (g, j) { page.appendChild(cardEl(g, p + j)); });
      box.appendChild(page);
    }
  }
  function make() {
    var opts = { free: st.free, seed: $("#seed").value.trim().slice(0, 32), words: parseWords(st.words) };
    if (st.kind === "words" && opts.words.length < (st.free ? 24 : 25)) { status(); return; }
    var n = Math.max(1, Math.min(300, parseInt($("#count").value, 10) || 1)); st.count = n; $("#count").value = n; save();
    cards = makeSet(st.kind, n, opts);
    madeWith = { kind: st.kind, title: st.title.trim(), seed: opts.seed, per: st.per };
    renderCards();
    $("#print").disabled = !cards.length;
    if (cards.length < n) S3.toast("Only " + cards.length + " different cards are possible with these words", "error");
    else S3.toast(n + " unique card" + (n === 1 ? "" : "s") + " ready");
    S3.done();
  }

  // ---------- caller ----------
  function pool() {
    if (st.kind === "75") return range(1, 75).map(String);
    if (st.kind === "90") return range(1, 90).map(String);
    return parseWords(st.words);
  }
  function label(v) { if (st.kind !== "75") return v; var n = +v; return "BINGO"[Math.floor((n - 1) / 15)] + " " + n; }
  var caller = { kind: "", called: [] };
  function loadCaller() {
    var c = S3.store(CKEY), p = pool(), set = {};
    p.forEach(function (x) { set[x] = 1; });
    caller = { kind: st.kind, called: [] };
    if (c && c.kind === st.kind && Array.isArray(c.called)) c.called.forEach(function (x) { if (typeof x === "string" && set[x] && caller.called.indexOf(x) < 0) caller.called.push(x); });
  }
  function saveCaller() { S3.store(CKEY, caller); }
  var crnd = cryptoRng();
  function callNext() {
    var p = pool().filter(function (x) { return caller.called.indexOf(x) < 0; });
    if (!p.length) { S3.toast("Everything has been called"); return; }
    caller.called.push(p[crnd(p.length)]); saveCaller(); renderCaller(true);
  }
  function undo() { if (caller.called.length) { caller.called.pop(); saveCaller(); renderCaller(); } }
  function renderCaller(fresh) {
    var cur = caller.called[caller.called.length - 1], ball = $("#ball"), p = pool();
    ball.textContent = "";
    if (cur) {
      if (st.kind === "75") { ball.appendChild(h("small", { text: label(cur).split(" ")[0] })); ball.appendChild(h("b", { text: cur })); }
      else ball.appendChild(h("b", { "class": st.kind === "words" ? "w" : "", dir: "auto", text: cur }));
      if (fresh) { ball.classList.remove("pop"); void ball.offsetWidth; ball.classList.add("pop"); }
    } else ball.appendChild(h("span", { text: "Press “Call next”" }));
    var last = $("#last"); last.textContent = "";
    caller.called.slice(-6, -1).reverse().forEach(function (x) { last.appendChild(h("span", { "class": "chip", dir: "auto", text: label(x) })); });
    $("#undo").disabled = !caller.called.length;
    $("#progress").textContent = caller.called.length + " of " + p.length + " called";
    var board = $("#board"); board.textContent = ""; board.className = "bm-board b" + st.kind;
    if (st.kind === "75") {
      for (var r = 0; r < 5; r++) {
        board.appendChild(h("span", { "class": "bm-bl", text: "BINGO"[r] }));
        for (var n = r * 15 + 1; n <= r * 15 + 15; n++) board.appendChild(h("span", { "class": caller.called.indexOf(String(n)) >= 0 ? "on" + (String(n) === cur ? " cur" : "") : "", text: String(n) }));
      }
    } else p.forEach(function (x) { board.appendChild(h("span", { dir: "auto", "class": caller.called.indexOf(x) >= 0 ? "on" + (x === cur ? " cur" : "") : "", text: x })); });
    $("#boardNote").textContent = st.kind === "words" ? "your word list" : st.kind === "75" ? "1–75" : "1–90";
  }

  // ---------- wiring ----------
  function seg(el, value, onPick) {
    $$("button", el).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === String(value)));
      b.addEventListener("click", function () { $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); onPick(b.dataset.v); });
    });
  }
  function syncKind() {
    $("#wordsWrap").hidden = st.kind !== "words";
    $("#freeWrap").hidden = st.kind === "90";
    status(); save();
    if (st.tab === "caller") { loadCaller(); renderCaller(); }
  }
  seg($("#tab"), "cards", function (v) {
    st.tab = v; $("#cardsTab").hidden = v !== "cards"; $("#callerTab").hidden = v !== "caller";
    if (v === "caller") { loadCaller(); renderCaller(); }
  });
  seg($("#kind"), st.kind, function (v) { st.kind = v; syncKind(); });
  seg($("#per"), st.per, function (v) { st.per = +v; save(); if (madeWith) { madeWith.per = st.per; renderCards(); } });
  $("#title").value = st.title; $("#title").addEventListener("input", function (e) { st.title = e.target.value; save(); });
  $("#words").value = st.words; $("#words").addEventListener("input", S3.debounce(function (e) { st.words = e.target.value.slice(0, 20000); save(); status(); }, 200));
  $("#free").checked = st.free; $("#free").addEventListener("change", function (e) { st.free = e.target.checked; save(); status(); });
  $("#count").value = st.count;
  $("#newSeed").addEventListener("click", function () {
    var a = "abcdefghjkmnpqrstuvwxyz23456789", r = cryptoRng(), s = "";
    for (var i = 0; i < 8; i++) s += a[r(a.length)];
    $("#seed").value = s;
  });
  $("#make").addEventListener("click", make);
  $("#print").addEventListener("click", function () { if (cards.length) { window.print(); S3.done(); } });
  $("#next").addEventListener("click", callNext);
  $("#undo").addEventListener("click", undo);
  $("#reset").addEventListener("click", function () {
    if (caller.called.length && !window.confirm("Start a new game? The called list will be cleared.")) return;
    caller.called = []; saveCaller(); renderCaller();
  });
  document.addEventListener("keydown", function (e) {
    if (st.tab !== "caller" || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); callNext(); }
    if (e.key === "Backspace" || e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  });
  syncKind();

  window.S3_DEMO = function () {
    $("#kind button[data-v='75']").click(); $("#per button[data-v='4']").click();
    $("#seed").value = "party26"; $("#count").value = 8; make();
  };

  window.S3_SELFTEST = function () {
    var r = seededRng("t1"), ok75 = true, ok90 = true;
    for (var t = 0; t < 300; t++) {
      var c = card75(r, true), all = [];
      for (var row = 0; row < 5; row++) for (var col = 0; col < 5; col++) {
        var v = c[row][col];
        if (row === 2 && col === 2) { if (v !== null) ok75 = false; continue; }
        if (!(v >= col * 15 + 1 && v <= col * 15 + 15)) ok75 = false;
        all.push(v);
      }
      if (new Set(all).size !== 24) ok75 = false;
      var k = card90(r), nums = [];
      for (var rr = 0; rr < 3; rr++) if (k[rr].filter(function (x) { return x !== null; }).length !== 5) ok90 = false;
      for (var cc = 0; cc < 9; cc++) {
        var colv = [k[0][cc], k[1][cc], k[2][cc]].filter(function (x) { return x !== null; }), lo = cc === 0 ? 1 : cc * 10, hi = cc === 8 ? 90 : cc * 10 + 9;
        if (colv.length < 1 || colv.length > 3) ok90 = false;
        colv.forEach(function (x, i) { if (x < lo || x > hi || (i && x <= colv[i - 1])) ok90 = false; nums.push(x); });
      }
      if (new Set(nums).size !== 15) ok90 = false;
    }
    var words = parseWords(SAMPLE_WORDS), w = cardWords(seededRng("w"), words, true), flat = [].concat.apply([], w).filter(function (x) { return x !== null; });
    var okW = flat.length === 24 && new Set(flat).size === 24 && flat.every(function (x) { return words.indexOf(x) >= 0; }) && w[2][2] === null;
    var set = makeSet("75", 200, { free: true, seed: "", words: [] }), keys = new Set(set.map(function (g) { return JSON.stringify(g); }));
    var a = JSON.stringify(makeSet("90", 12, { seed: "abc", free: true })), b = JSON.stringify(makeSet("90", 12, { seed: "abc", free: true })), d = JSON.stringify(makeSet("90", 12, { seed: "abd", free: true }));
    var tiny = makeSet("words", 5, { seed: "", free: false, words: range(1, 25).map(String) });
    var pw = parseWords(" a \nA\n\nb\n" + "x".repeat(60));
    return ok75 && ok90 && okW && set.length === 200 && keys.size === 200 && a === b && a !== d && tiny.length === 5 &&
      pw.length === 3 && pw[0] === "a" && pw[2].length === 40;
  };
})();
