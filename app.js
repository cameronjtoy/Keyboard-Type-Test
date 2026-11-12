(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SAMPLE = "The quick brown fox jumps over the lazy dog, but the dog, being a patient animal, simply yawned and rolled over. Practice builds rhythm, and rhythm builds speed; accuracy always comes first, because every mistake you fix costs more time than a steady, careful keystroke ever would.";
  const KEY_SETTINGS = 'ggt.settings.v1', KEY_HIST = 'ggt.history.v1';

  const el = {
    setup: $('setup'), test: $('test'), results: $('results'), histCard: $('historyCard'),
    source: $('source'), srcInfo: $('srcInfo'), ghostWpm: $('ghostWpm'), ghostVal: $('ghostVal'),
    optGhost: $('optGhost'), optStop: $('optStop'), optNorm: $('optNorm'), timerSec: $('timerSec'), timerVal: $('timerVal'),
    text: $('text'), textbox: $('textbox'), capture: $('capture'), hint: $('hint'),
    liveWpm: $('liveWpm'), liveAcc: $('liveAcc'), liveTime: $('liveTime'), liveProg: $('liveProg'),
    liveGhost: $('liveGhost'), liveDelta: $('liveDelta'), barYou: $('barYou'), barGhost: $('barGhost'),
  };

  /* ---------- storage ---------- */
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const settings = Object.assign({ text: SAMPLE, wpm: 60, ghost: true, stop: false, norm: true, timer: 0 }, load(KEY_SETTINGS, {}));
  let ghostWpm = settings.wpm;

  function persist() {
    save(KEY_SETTINGS, { text: el.source.value, wpm: ghostWpm, ghost: el.optGhost.checked, stop: el.optStop.checked, norm: el.optNorm.checked, timer: getTimer() });
  }

  /* ---------- text prep ---------- */
  function prepare(raw, norm) {
    let t = raw;
    if (norm) {
      t = t.replace(/[‘’‛]/g, "'").replace(/[“”„]/g, '"')
           .replace(/[–—−]/g, '-').replace(/…/g, '...');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function updateSrcInfo() {
    const t = prepare(el.source.value, el.optNorm.checked);
    const words = t ? t.split(' ').length : 0;
    el.srcInfo.textContent = `${words} words · ${t.length} characters`;
  }

  function getTimer() { const v = Math.floor(+el.timerSec.value); return v > 0 ? Math.min(v, 3600) : 0; }
  function setTimer(v) {
    el.timerSec.value = v > 0 ? v : 0;
    el.timerVal.textContent = v > 0 ? fmtDur(v) : 'off';
    persist();
  }
  function fmtDur(s) { return s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ' ' + (s % 60) + 's' : ''}` : s + 's'; }

  function setGhostWpm(v) {
    ghostWpm = Math.max(5, Math.min(250, Math.round(v)));
    el.ghostWpm.value = ghostWpm;
    el.ghostVal.textContent = ghostWpm;
    el.liveGhost.textContent = ghostWpm;
    persist();
  }

  /* ---------- screens ---------- */
  function show(which) {
    for (const k of ['setup', 'test', 'results']) el[k].classList.toggle('hidden', k !== which);
    el.histCard.classList.toggle('hidden', which === 'test' || load(KEY_HIST, []).length === 0);
  }

  /* ---------- test state ---------- */
  let S = null; // run state
  let raf = 0;

  function startTest() {
    const norm = el.optNorm.checked;
    const text = prepare(el.source.value, norm);
    if (!text) { el.source.focus(); el.srcInfo.textContent = 'Please enter some text first.'; return; }
    persist();
    cancelAnimationFrame(raf); raf = 0; // stop any previous run's loop so the ghost restarts cleanly
    S = {
      text, n: text.length, typed: '',
      started: false, t0: 0, done: false,
      keys: 0, correctKeys: 0, backspaces: 0,
      bucketKeys: [], bucketCorrect: [], bucketGhost: [],
      charTime: new Array(text.length).fill(null),
      miss: {}, ghostPos: 0, lastTick: 0, ghostFinishT: null,
      limit: getTimer() * 1000, ghostOn: el.optGhost.checked, stop: el.optStop.checked,
      peak: 0, hist: [],
    };
    buildText();
    el.capture.value = '';
    el.liveGhost.textContent = ghostWpm;
    el.liveWpm.textContent = '0'; el.liveAcc.textContent = '100%'; el.liveTime.textContent = S.limit ? (S.limit / 1000).toFixed(1) + 's' : '0.0s'; el.liveTime.classList.remove('low');
    el.liveProg.textContent = '0%'; el.liveDelta.textContent = '—'; el.liveDelta.className = '';
    el.barYou.style.width = '0'; el.barGhost.style.width = '0';
    el.hint.textContent = 'Start typing to begin…';
    el.textbox.classList.remove('typing', 'ended');
    el.textbox.scrollTop = 0;
    show('test');
    paintCursors(true);
    el.capture.focus();
  }

  let chars = [], prevCur = -1, prevGhost = -1;
  function buildText() {
    el.text.textContent = '';
    chars = [];
    const frag = document.createDocumentFragment();
    const words = S.text.split(' ');
    words.forEach((w, wi) => {
      const ws = document.createElement('span'); ws.className = 'w';
      for (const ch of w) { const c = mk(ch); ws.appendChild(c); chars.push(c); }
      frag.appendChild(ws);
      if (wi < words.length - 1) { const c = mk(' ', true); frag.appendChild(c); chars.push(c); }
    });
    el.text.appendChild(frag);
    prevCur = prevGhost = -1;
  }
  function mk(ch, space) {
    const c = document.createElement('span'); c.className = 'c' + (space ? ' sp' : '');
    c.textContent = ch; return c;
  }

  function paintRange(from, to) {
    for (let i = Math.max(0, from); i < Math.min(S.n, to); i++) {
      const c = chars[i];
      c.classList.remove('ok', 'bad');
      if (i < S.typed.length) c.classList.add(S.typed[i] === S.text[i] ? 'ok' : 'bad');
    }
  }

  function paintCursors(force) {
    const cur = S.typed.length < S.n ? S.typed.length : -1;
    if (cur !== prevCur || force) {
      if (prevCur >= 0) chars[prevCur]?.classList.remove('cur');
      if (cur >= 0) { chars[cur].classList.add('cur'); keepInView(chars[cur]); }
      prevCur = cur;
    }
    const gi = S.ghostOn && S.ghostPos < S.n ? Math.floor(S.ghostPos) : -1;
    if (gi !== prevGhost || force) {
      if (prevGhost >= 0) chars[prevGhost]?.classList.remove('gh');
      if (gi >= 0) chars[gi].classList.add('gh');
      prevGhost = gi;
    }
  }

  // The text window always follows the user's cursor (never the ghost).
  function keepInView(node) {
    const box = el.textbox, b = box.getBoundingClientRect(), r = node.getBoundingClientRect();
    const lh = r.height || 36;
    const rel = r.top - b.top;
    if (rel > lh * 2.2 || rel < 0) box.scrollTop += rel - lh * 1.5;
  }

  /* ---------- input ---------- */
  el.capture.addEventListener('paste', e => e.preventDefault());
  el.capture.addEventListener('drop', e => e.preventDefault());
  el.capture.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); startTest(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
    if (e.key === 'Enter') e.preventDefault();
  });
  el.capture.addEventListener('input', onInput);
  el.textbox.addEventListener('mousedown', e => { e.preventDefault(); el.capture.focus(); });
  el.capture.addEventListener('blur', () => { if (S && !S.done && !el.test.classList.contains('hidden')) el.hint.textContent = 'Paused — click the text to keep typing.'; });
  el.capture.addEventListener('focus', () => { if (S && !S.done && S.started) el.hint.textContent = 'Esc restarts the test.'; });

  function now() { return performance.now(); }

  function onInput() {
    if (!S || S.done) return;
    let val = el.capture.value.replace(/\n/g, '');
    if (val.length > S.n) val = val.slice(0, S.n);
    const old = S.typed;
    if (val === old) { el.capture.value = old; return; }
    const t = now();
    if (!S.started) {
      if (val.length <= old.length) { el.capture.value = old; return; }
      S.started = true; S.t0 = t; S.lastTick = t;
      el.hint.textContent = 'Esc restarts the test.';
      el.textbox.classList.add('typing');
      raf = requestAnimationFrame(tick);
    }
    const sec = Math.floor((t - S.t0) / 1000);

    // first differing index
    let d = 0; const m = Math.min(old.length, val.length);
    while (d < m && old[d] === val[d]) d++;

    if (val.length > old.length || d < old.length && val.length >= old.length) {
      // chars added (possibly replacing a tail)
      if (S.stop && hasError(old.slice(0, d))) { el.capture.value = old; return; }
      if (d < old.length) S.backspaces += old.length - d;
      let accepted = val;
      for (let i = d; i < val.length; i++) {
        if (S.stop && i > d && accepted[i - 1] !== S.text[i - 1]) { accepted = accepted.slice(0, i); break; }
        const ok = val[i] === S.text[i];
        S.keys++; if (ok) S.correctKeys++; else { S.miss[S.text[i]] = (S.miss[S.text[i]] || 0) + 1; }
        S.bucketKeys[sec] = (S.bucketKeys[sec] || 0) + 1;
        if (ok) S.bucketCorrect[sec] = (S.bucketCorrect[sec] || 0) + 1;
        S.charTime[i] = t - S.t0;
      }
      val = accepted;
    } else {
      S.backspaces += old.length - val.length;
    }
    S.typed = val;
    if (el.capture.value !== val) el.capture.value = val;
    paintRange(d, Math.max(old.length, val.length));
    paintCursors();
    updateLive(t);
    if (val.length === S.n) finish(t);
  }

  function hasError(s) { for (let i = 0; i < s.length; i++) if (s[i] !== S.text[i]) return true; return false; }
  function correctChars() { let c = 0; const s = S.typed; for (let i = 0; i < s.length; i++) if (s[i] === S.text[i]) c++; return c; }

  /* ---------- loop ---------- */
  function tick(t) {
    if (!S || S.done) return;
    const dt = (t - S.lastTick) / 1000; S.lastTick = t;
    S.ghostPos += dt * ghostWpm * 5 / 60;
    const sec = Math.floor((t - S.t0) / 1000);
    S.bucketGhost[sec] = ghostWpm;
    if (S.ghostPos >= S.n && S.ghostFinishT === null) S.ghostFinishT = t - S.t0;
    if (S.limit && t - S.t0 >= S.limit) { updateLive(S.t0 + S.limit); finish(S.t0 + S.limit, true); return; }
    paintCursors();
    updateLive(t);
    raf = requestAnimationFrame(tick);
  }

  function updateLive(t) {
    const el_ = S.started ? Math.max(0, t - S.t0) : 0;
    const mins = el_ / 60000;
    const wpm = mins > 0.0005 ? correctChars() / 5 / mins : 0;
    S.peak = Math.max(S.peak, Math.min(wpm, 400));
    el.liveWpm.textContent = Math.round(wpm);
    el.liveAcc.textContent = (S.keys ? Math.round(S.correctKeys / S.keys * 100) : 100) + '%';
    if (S.limit) { const left = Math.max(0, S.limit - el_) / 1000; el.liveTime.textContent = left.toFixed(1) + 's'; el.liveTime.classList.toggle('low', left <= 5); }
    else el.liveTime.textContent = (el_ / 1000).toFixed(1) + 's';
    el.liveProg.textContent = Math.round(S.typed.length / S.n * 100) + '%';
    el.barYou.style.width = (S.typed.length / S.n * 100) + '%';
    if (S.ghostOn) {
      el.barGhost.style.width = (Math.min(S.ghostPos, S.n) / S.n * 100) + '%';
      const diff = S.typed.length - Math.floor(Math.min(S.ghostPos, S.n));
      el.liveDelta.textContent = diff === 0 ? 'level' : (diff > 0 ? `+${diff} ahead` : `${-diff} behind`);
      el.liveDelta.className = diff > 0 ? 'ahead' : diff < 0 ? 'behind' : '';
    } else { el.liveDelta.textContent = 'off'; el.barGhost.style.width = '0'; }
  }

  /* ---------- finish & results ---------- */
  function finish(t, timeUp) {
    S.done = true; cancelAnimationFrame(raf);
    const T = Math.max(1, t - S.t0);
    const mins = T / 60000;
    const correct = correctChars();
    const wrongLeft = S.n - correct;
    const net = correct / 5 / mins;
    const raw = S.keys / 5 / mins;
    const acc = S.keys ? S.correctKeys / S.keys * 100 : 100;

    // per-second buckets
    const nb = Math.ceil(T / 1000);
    const pts = [];
    let cum = 0;
    for (let s = 0; s < nb; s++) {
      const dur = Math.min(1000, T - s * 1000) / 1000;
      cum += S.bucketCorrect[s] || 0;
      if (dur < 0.3 && s > 0) continue;
      const rawW = (S.bucketKeys[s] || 0) / 5 * 60 / dur;
      pts.push({ x: Math.min(T, (s + 1) * 1000) / 1000, raw: rawW, run: cum / 5 / (Math.min(T, (s + 1) * 1000) / 60000), ghost: S.bucketGhost[s] ?? ghostWpm, full: dur >= 1 });
    }
    const full = pts.filter(p => p.full).map(p => p.raw);
    let cons = 100;
    if (full.length >= 2) {
      const mean = full.reduce((a, b) => a + b, 0) / full.length;
      const sd = Math.sqrt(full.reduce((a, b) => a + (b - mean) ** 2, 0) / full.length);
      const cv = mean ? sd / mean : 0;
      cons = 100 / (1 + cv);
    }
    const peak = pts.length ? Math.max(...pts.filter(p => p.full || pts.length === 1).map(p => p.raw), 0) : raw;

    // words
    const words = []; let idx = 0;
    for (const w of S.text.split(' ')) {
      const end = idx + w.length - 1; // last letter
      const prevEnd = idx - 1;
      const t1 = S.charTime[Math.min(end + 1, S.n - 1)] ?? S.charTime[end];
      const t0 = prevEnd >= 0 ? S.charTime[prevEnd] : 0;
      if (t1 != null && t0 != null) words.push({ w, ms: Math.max(1, t1 - t0), wpm: (w.length + 1) / 5 / (Math.max(1, t1 - t0) / 60000) });
      idx += w.length + 1;
    }
    words.sort((a, b) => b.ms - a.ms);

    // ghost verdict
    let verdict = '', win = null, gres = '—';
    if (S.ghostOn && timeUp) {
      const gp = Math.min(S.ghostPos, S.n), diff = S.typed.length - Math.floor(gp);
      if (diff > 0) { win = true; verdict = `Time's up — you were ${diff} characters ahead of the ghost.`; gres = `Won +${diff} chars`; }
      else if (diff < 0) { win = false; verdict = `Time's up — the ghost was ${-diff} characters ahead.`; gres = `Lost −${-diff} chars`; }
      else { verdict = "Time's up — you tied with the ghost."; gres = 'Tied'; }
    } else if (S.ghostOn) {
      if (S.ghostFinishT === null) {
        win = true;
        const margin = (S.n - S.ghostPos) / (ghostWpm * 5 / 60);
        verdict = `You beat the ghost by ${margin.toFixed(1)}s (${Math.round(S.n - S.ghostPos)} characters ahead).`;
        gres = `Won +${margin.toFixed(1)}s`;
      } else {
        win = false;
        const lag = (T - S.ghostFinishT) / 1000;
        verdict = `The ghost finished ${lag.toFixed(1)}s before you.`;
        gres = `Lost −${lag.toFixed(1)}s`;
      }
    }

    el.textbox.classList.add('ended');
    $('verdict').className = 'verdict' + (win === true ? ' win' : win === false ? ' lose' : '');
    $('verdict').textContent = verdict || (timeUp ? "Time's up." : 'Test complete.');
    $('rWpm').textContent = net.toFixed(1);
    $('rAcc').textContent = acc.toFixed(1) + '%';
    $('rCons').textContent = Math.round(cons) + '%';
    $('rTime').textContent = (T / 1000).toFixed(1) + 's';

    const totalMistakes = S.keys - S.correctKeys;
    const metrics = [
      ['Raw WPM', raw.toFixed(1)],
      ['Peak WPM (1s)', Math.round(peak)],
      ['Ghost WPM', S.ghostOn ? ghostWpm : 'off'],
      ['Correct characters', `${correct} / ${S.n}`],
      ['Uncorrected errors', wrongLeft],
      ['Total mistakes', totalMistakes],
      ['Keystrokes', S.keys],
      ['Backspaces', S.backspaces],
      ['Words', S.text.split(' ').length],
      ['Chars / second', (S.keys / (T / 1000)).toFixed(2)],
    ];
    $('metrics').innerHTML = metrics.map(([k, v]) => `<div><span class="k">${k}</span><b>${v}</b></div>`).join('');

    $('slowWords').innerHTML = words.slice(0, 5).map(x => `<li><b>${esc(x.w)}</b> — ${(x.ms / 1000).toFixed(2)}s (${Math.round(x.wpm)} wpm)</li>`).join('') || '<li>—</li>';
    const miss = Object.entries(S.miss).sort((a, b) => b[1] - a[1]).slice(0, 5);
    $('missKeys').innerHTML = miss.map(([k, v]) => `<li><b>${k === ' ' ? '␣ space' : esc(k)}</b> — ${v}×</li>`).join('') || '<li>No mistakes. Nice.</li>';

    drawChart(pts, S.ghostOn);

    const hist = load(KEY_HIST, []);
    hist.unshift({ ts: Date.now(), wpm: +net.toFixed(1), raw: +raw.toFixed(1), acc: +acc.toFixed(1), cons: Math.round(cons), ghost: S.ghostOn ? ghostWpm : null, res: gres });
    save(KEY_HIST, hist.slice(0, 15));
    renderHistory();
    show('results');
    el.results.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function drawChart(pts, ghost) {
    const W = 800, H = 240, p = { l: 40, r: 14, t: 14, b: 28 };
    if (pts.length < 2) { $('chartWrap').innerHTML = ''; return; }
    const maxX = pts[pts.length - 1].x;
    const maxY = Math.max(10, ...pts.map(q => Math.max(q.raw, q.run, ghost ? q.ghost : 0))) * 1.1;
    const X = v => p.l + v / maxX * (W - p.l - p.r), Y = v => H - p.b - v / maxY * (H - p.t - p.b);
    const line = (key, color, dash) => `<polyline fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="6 4"' : ''} points="${pts.map(q => X(q.x).toFixed(1) + ',' + Y(q[key]).toFixed(1)).join(' ')}"/>`;
    let grid = '';
    const step = niceStep(maxY / 4);
    for (let v = 0; v <= maxY; v += step) grid += `<line class="chart-axis" x1="${p.l}" x2="${W - p.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="chart-txt" x="${p.l - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    const xs = niceStep(maxX / 6);
    for (let v = 0; v <= maxX; v += xs) grid += `<text class="chart-txt" x="${X(v)}" y="${H - 8}" text-anchor="middle">${Math.round(v)}s</text>`;
    const cs = getComputedStyle(document.documentElement);
    const accent = cs.getPropertyValue('--accent'), gh = cs.getPropertyValue('--ghost'), pend = cs.getPropertyValue('--pending');
    $('chartWrap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WPM over time">${grid}
      ${line('raw', pend)}${line('run', accent)}${ghost ? line('ghost', gh, true) : ''}
      <g font-size="12"><circle cx="${p.l + 8}" cy="8" r="4" fill="${pend}"/><text class="chart-txt" x="${p.l + 16}" y="12">per-second</text>
      <circle cx="${p.l + 100}" cy="8" r="4" fill="${accent}"/><text class="chart-txt" x="${p.l + 108}" y="12">your running WPM</text>
      ${ghost ? `<circle cx="${p.l + 240}" cy="8" r="4" fill="${gh}"/><text class="chart-txt" x="${p.l + 248}" y="12">ghost</text>` : ''}</g></svg>`;
  }
  function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }

  function renderHistory() {
    const h = load(KEY_HIST, []);
    document.querySelector('#hist tbody').innerHTML = h.map(r => `<tr><td>${new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${r.wpm}</td><td>${r.raw}</td><td>${r.acc}%</td><td>${r.cons}%</td><td>${r.ghost ?? '—'}</td><td>${r.res}</td></tr>`).join('');
  }

  /* ---------- wiring ---------- */
  el.source.value = settings.text;
  el.optGhost.checked = settings.ghost; el.optStop.checked = settings.stop; el.optNorm.checked = settings.norm;
  setGhostWpm(ghostWpm); setTimer(settings.timer);
  updateSrcInfo(); renderHistory();

  el.source.addEventListener('input', () => { updateSrcInfo(); persist(); });
  el.source.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startTest(); });
  [el.optGhost, el.optStop, el.optNorm].forEach(o => o.addEventListener('change', () => { updateSrcInfo(); persist(); }));
  el.timerSec.addEventListener('input', () => { const v = getTimer(); el.timerVal.textContent = v ? fmtDur(v) : 'off'; persist(); });
  document.querySelectorAll('[data-timer]').forEach(b => b.addEventListener('click', () => setTimer(+b.dataset.timer)));
  el.ghostWpm.addEventListener('input', () => setGhostWpm(+el.ghostWpm.value));
  document.querySelectorAll('[data-wpm]').forEach(b => b.addEventListener('click', () => setGhostWpm(+b.dataset.wpm)));
  $('gMinus').addEventListener('click', () => { setGhostWpm(ghostWpm - 5); el.capture.focus(); });
  $('gPlus').addEventListener('click', () => { setGhostWpm(ghostWpm + 5); el.capture.focus(); });
  $('gMinus').addEventListener('mousedown', e => e.preventDefault());
  $('gPlus').addEventListener('mousedown', e => e.preventDefault());
  $('sampleBtn').addEventListener('click', () => { el.source.value = SAMPLE; updateSrcInfo(); persist(); });
  $('clearBtn').addEventListener('click', () => { el.source.value = ''; updateSrcInfo(); persist(); el.source.focus(); });
  $('startBtn').addEventListener('click', startTest);
  $('restartBtn').addEventListener('click', startTest);
  $('againBtn').addEventListener('click', startTest);
  $('editBtn').addEventListener('click', () => { if (S) { S.done = true; cancelAnimationFrame(raf); } show('setup'); });
  $('clearHist').addEventListener('click', () => { save(KEY_HIST, []); renderHistory(); el.histCard.classList.add('hidden'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.results.classList.contains('hidden')) startTest();
    if (e.key === 'Escape' && !el.test.classList.contains('hidden') && document.activeElement !== el.capture) startTest();
  });
  show('setup');
})();
