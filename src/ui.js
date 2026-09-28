// ===== Tenebrae UI =====
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]); }
    for (const c of kids) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };
  const KEY = 'tenebrae.design.v1', OLD_KEY = 'umbra.design.v1';
  let S = defaultState();
  try { const j = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY); if (j) S = loadDesign(JSON.parse(j)); } catch (e) { }
  const UIKEY = 'tenebrae.ui.v1', OLD_UIKEY = 'umbra.ui.v1';
  const UI = { locks: [], level: 'basic', open: { lamp: true, target: true, light: true, shells: false, pattern: false, link: false, motion: false, make: false, view: false }, playing: false, animA: 0, animB: 0, view: 'room', sums: [] };
  try { const j = JSON.parse(localStorage.getItem(UIKEY) || localStorage.getItem(OLD_UIKEY) || 'null'); if (j) { UI.level = j.level === 'advanced' ? 'advanced' : 'basic'; Object.assign(UI.open, j.open || {}); if (Array.isArray(j.locks)) UI.locks = j.locks; } } catch (e) { }
  let G = [null, null], notes = [];
  const downloads = (window.claude && window.claude.use) ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  // ---------- controls ----------
  let uid = 0;
  function num(v, step) { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2; return (+v).toFixed(d); }
  function slider(parent, label, obj, key, min, max, step, kind, opts = {}) {
    const id = 'c' + (uid++);
    const rng = el('input', { type: 'range', id, min, max, step, value: obj[key], 'aria-label': label });
    const box = el('input', { type: 'number', min, max, step, value: num(obj[key], step), 'aria-label': label + ' value' });
    const set = (v, commit) => {
      v = Math.min(max, Math.max(min, +v)); if (!isFinite(v)) return;
      if (opts.snap) v = opts.snap(v);
      obj[key] = v; rng.value = v; box.value = num(v, step);
      if (opts.after) opts.after(v);
      changed(kind, !commit);
    };
    rng.addEventListener('input', () => set(rng.value, false));
    rng.addEventListener('change', () => set(rng.value, true));
    box.addEventListener('change', () => set(box.value, true));
    const row = el('div', { class: 'ctl' + (opts.lock ? ' lk' : '') }, el('label', { for: id }, label), box);
    if (opts.lock) {
      const on = () => UI.locks.includes(opts.lock);
      const lb = el('button', { class: 'lock', type: 'button', 'aria-pressed': on() ? 'true' : 'false', 'aria-label': 'Lock ' + label + ' against randomize', title: 'Lock against randomize' });
      lb.innerHTML = LOCK_SVG;
      lb.addEventListener('click', () => { if (on()) UI.locks = UI.locks.filter(x => x !== opts.lock); else UI.locks.push(opts.lock); lb.setAttribute('aria-pressed', on() ? 'true' : 'false'); saveUI(); });
      row.append(lb);
    }
    row.append(rng); parent.append(row);
    return { set };
  }
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  function select(parent, label, obj, key, options, kind, rerender, after) {
    const id = 'c' + (uid++);
    const s = el('select', { id }, ...options.map(([v, t]) => el('option', { value: v, selected: obj[key] === v ? '' : false }, t)));
    s.addEventListener('change', () => { obj[key] = s.value; if (after) after(s.value); changed(kind, false); if (rerender) renderSidebar(); });
    parent.append(el('div', { class: 'ctl sel' }, el('label', { for: id }, label), s));
  }
  function check(parent, label, obj, key, kind, rerender, after) {
    const id = 'c' + (uid++);
    const c = el('input', { type: 'checkbox', id, checked: obj[key] ? '' : false });
    c.addEventListener('change', () => { obj[key] = c.checked; if (after) after(c.checked); changed(kind, false); if (rerender) renderSidebar(); });
    parent.append(el('div', { class: 'ctl chk' }, c, el('label', { for: id }, label)));
  }
  function note(parent, text, cls = '') { const n = el('p', { class: 'hint ' + cls }, text); parent.append(n); return n; }
  const ADV = () => UI.level === 'advanced';
  function section(key, n, title, sum, build) {
    const d = el('details', { open: UI.open[key] ? '' : false });
    d.addEventListener('toggle', () => { UI.open[key] = d.open; saveUI(); });
    const s = el('span', { class: 'sum' });
    UI.sums.push(() => { s.textContent = sum(); });
    const body = el('div', { class: 'sec' });
    d.append(el('summary', {}, el('span', { class: 'step' }, n ? el('i', { 'aria-hidden': 'true' }, String(n)) : null, title), s), body);
    build(body); $('#side').append(d);
  }
  function refreshSummaries() { (UI.sums || []).forEach(f => f()); }
  function saveUI() { try { localStorage.setItem(UIKEY, JSON.stringify({ level: UI.level, open: UI.open, locks: UI.locks })); } catch (e) { } }

  // ---------- decisions and their knock-on settings ----------
  const TARGETS = {
    ceiling: { label: 'Ceiling and upper walls', apply: () => { setDie('up'); setCaps(true); return 'Emitter set to an upward LED die; top caps on.'; },
      why: 'An upward die gives the crispest shadows. Top caps pattern the ceiling instead of throwing a bright disc.' },
    walls: { label: 'Walls at lamp height', apply: () => { S.source.type = 'line'; S.source.emit = 'omni'; setCaps(false); return 'Emitter set to a vertical filament; caps off.'; },
      why: 'A vertical filament lights all round. Vertical slots stay sharp; horizontal features blur along its length.' },
    floor: { label: 'Floor and lower walls', apply: () => { setDie('down'); setCaps(false); return 'Emitter set to a downward LED die; caps off.'; },
      why: 'A downward die. Bottom caps are not built yet, so the open bottom throws a bright disc on the floor.' },
    everywhere: { label: 'Everywhere', apply: () => { setDie('omni'); setCaps(true); return 'Emitter set to all directions (two dies back to back); top caps on.'; },
      why: 'Two dies back to back approximate all-round light, with a dim band at lamp height.' },
  };
  function setDie(emit) { if (S.source.type !== 'disc' && S.source.type !== 'point') { S.source.type = 'disc'; S.source.size = 1.4; } S.source.emit = emit; R && R.setEmitter(S.source); }
  function setCaps(on) { S.shells.forEach(sh => { sh.cap.on = on; }); }
  const MOUNT_Z = { table: 900, pendant: 1900 };
  const EMIT = { point: 'Point', disc: 'LED die', line: 'Filament', sphere: 'Frosted bulb' };
  const FACING = { up: 'facing up', down: 'facing down', omni: 'all round' };
  function lightSummary() {
    const s = S.source;
    return s.type === 'line' ? `Filament, ${s.length} mm` : s.type === 'point' ? `Point, ${FACING[s.emit]}` : `${EMIT[s.type]} ${num(s.size, 0.1)} mm, ${FACING[s.emit]}`;
  }

  // ---------- sidebar ----------
  function renderSidebar() {
    const side = $('#side'), top = side.scrollTop; side.innerHTML = ''; uid = 0; UI.sums = [];
    const lv = (v, t) => el('button', { 'aria-pressed': UI.level === v ? 'true' : 'false', onclick: () => { UI.level = v; saveUI(); renderSidebar(); } }, t);
    side.append(el('div', { class: 'level' }, el('div', { class: 'seg', role: 'group', 'aria-label': 'Detail level' }, lv('basic', 'Basic'), lv('advanced', 'Advanced')),
      el('p', { class: 'hint' }, ADV() ? 'Every parameter is shown.' : 'Work down the steps. Each shows only the settings that shape the look.')));

    section('lamp', 1, 'Lamp', () => `${S.lamp.mount === 'pendant' ? 'Pendant' : 'Table lamp'}, light at ${Math.round(S.room.lampZ)} mm`, b => {
      select(b, 'Mount', S.lamp, 'mount', [['table', 'Table lamp'], ['pendant', 'Pendant']], 'room', true, v => { S.room.lampZ = MOUNT_Z[v]; toast(`Light height set to ${MOUNT_Z[v]} mm above the floor.`); });
      if (ADV()) slider(b, 'Light height above floor (mm)', S.room, 'lampZ', 150, 4800, 10, 'room');
    });

    section('target', 2, 'Target', () => TARGETS[S.plan.target].label, b => {
      select(b, 'Lands on', S.plan, 'target', Object.entries(TARGETS).map(([k, v]) => [k, v.label]), 'geom', true, v => { toast(TARGETS[v].apply()); R && R.setEmitter(S.source); });
      note(b, TARGETS[S.plan.target].why);
    });

    section('light', 3, 'Light', lightSummary, b => {
      select(b, 'Emitter', S.source, 'type', [['point', 'Point (ideal)'], ['disc', 'LED die or COB'], ['line', 'Filament'], ['sphere', 'Frosted bulb']], 'light', true);
      if (S.source.type === 'disc' || S.source.type === 'sphere') slider(b, S.source.type === 'disc' ? 'Emitter diameter (mm)' : 'Bulb diameter (mm)', S.source, 'size', 0.5, 80, 0.1, 'light', { after: sharpHint });
      if (S.source.type === 'line') slider(b, 'Filament length (mm)', S.source, 'length', 4, 80, 1, 'light');
      UI.sharp = note(b, ''); sharpHint();
      if (ADV()) {
        select(b, 'Emission', S.source, 'emit', [['omni', 'All directions'], ['up', 'Upward half'], ['down', 'Downward half']], 'light');
        slider(b, 'Height above shell centre (mm)', S.source, 'z', -40, 40, 0.5, 'light');
        select(b, 'Colour temperature', S.source, 'color', [['warm', '2700 K'], ['neutral', '4000 K'], ['cool', '6500 K']], 'light');
      }
    });

    section('shells', 4, 'Shells', () => { const [A, B] = S.shells; return `${A.shape === 'sphere' ? 'Spheres' : 'Cylinders'}, ${+A.R.toFixed(1)} and ${+B.R.toFixed(1)} mm${A.cap.on || B.cap.on ? ', capped' : ''}`; }, shellsSection);
    section('pattern', 5, 'Pattern', () => patSummary(S.shells[0].pattern), b => {
      const A = S.shells[0];
      b.append(el('div', { class: 'btnrow' },
        el('button', { class: 'btn', id: 'rand', type: 'button', onclick: randomize, title: 'Randomize unlocked pattern settings (R)' }, 'Randomize'),
        el('button', { class: 'btn ghost', id: 'undo', type: 'button', onclick: undoRandom, disabled: UI.undo ? false : '' }, 'Undo')));
      patternControls(b, A.pattern, 'Generator', 'A');
      if (A.cap.on) {
        check(b, 'Cap follows wall pattern', A.cap, 'follow', 'geom', true);
        if (!A.cap.follow) patternControls(b, A.cap.pattern, 'Cap generator', 'Acap');
      }
      note(b, 'Randomize changes the visible, unlocked sliders here and in the moiré step, and keeps the first result that passes the print checks.');
    });
    section('link', 6, 'Moiré', () => S.link.mode === 'linked' ? `Linked, detune ${S.link.detune > 0 ? '+' : ''}${S.link.detune}${S.link.mirror ? ', mirrored' : ''}` : 'Independent', linkSection);
    section('motion', 7, 'Motion', () => ({ static: 'Static', manual: 'Manual twist', motor: 'Motor' })[S.motion.mode], motionSection);
    section('make', 8, 'Make', () => `${S.process.profile}, ${G[0] && G[1] && G[0].ok && G[1].ok && !notes.some(x => x.bad) ? 'ready to export' : 'needs attention'}`, makeSection);
    section('view', 0, 'Preview', () => `Exposure ${num(S.room.exposure, 0.05)}`, b => {
      slider(b, 'Exposure', S.room, 'exposure', 0.05, 6, 0.05, 'light');
      if (ADV()) {
        slider(b, 'Ambient fill', S.room, 'ambient', 0, 0.3, 0.005, 'light');
        slider(b, 'Room width (mm)', S.room, 'W', 1500, 9000, 50, 'room');
        slider(b, 'Room depth (mm)', S.room, 'D', 1500, 9000, 50, 'room');
        slider(b, 'Ceiling height (mm)', S.room, 'H', 2000, 5000, 50, 'room');
        note(b, 'Direct light only. A real room adds bounce light, which lowers contrast; raise ambient fill to approximate it.');
      }
    });
    refreshSummaries();
    side.scrollTop = top;
  }
  function patSummary(p) {
    const g = GENS[p.gen], v = p.params[p.gen][g.count];
    return `${g.label}, ${Math.round(v)}`;
  }

  function shellsSection(b) {
    const [A, B] = S.shells;
    select(b, 'Shape', A, 'shape', [['cylinder', 'Cylinder'], ['sphere', 'Sphere']], 'geom', true, v => { B.shape = v; });
    slider(b, 'Radius (mm)', A, 'R', 15, 250, 0.5, 'geom');
    slider(b, 'Top, above the light (mm)', A, 'zTop', 0, 300, 0.5, 'geom');
    slider(b, 'Bottom, below the light (mm)', A, 'zBot', -300, 0, 0.5, 'geom');
    check(b, 'Top caps', A.cap, 'on', 'geom', true, v => { B.cap.on = v; });
    check(b, 'Fit outer shell automatically', S.fit, 'auto', 'geom', true, v => { if (v) S.fit.gap = Math.max(2, +(B.R - A.R - A.t).toFixed(1)); });
    if (S.fit.auto) slider(b, 'Gap between shells (mm)', S.fit, 'gap', 2, 40, 0.5, 'geom');
    else {
      slider(b, 'Outer radius (mm)', B, 'R', 15, 260, 0.5, 'geom');
      slider(b, 'Outer top, above the light (mm)', B, 'zTop', 0, 320, 0.5, 'geom');
    }
    if (!ADV()) return;
    for (const k of [0, 1]) {
      const sh = S.shells[k];
      b.append(el('h3', { class: 'sub' }, k ? 'Outer shell' : 'Inner shell'));
      if (k === 1 && S.fit.auto) { note(b, 'Fitted from the inner shell and the gap. Untick “Fit outer shell automatically” to edit it.'); continue; }
      slider(b, 'Wall (mm)', sh, 't', 1, 8, 0.1, 'geom');
      if (k === 1) { slider(b, 'Outer bottom, below the light (mm)', sh, 'zBot', -320, 0, 0.5, 'geom'); }
      slider(b, 'Bottom rim (mm)', sh, 'rimBot', 1, 60, 0.5, 'geom');
      slider(b, sh.cap.on ? 'Corner band, wall to cap (mm)' : 'Top rim (mm)', sh, 'rimTop', 1, 60, 0.5, 'geom');
      if (k === 1) check(b, 'Top cap', sh.cap, 'on', 'geom', true);
      if (sh.cap.on) slider(b, 'Cap hub radius (mm)', sh.cap, 'hub', 2, 60, 0.5, 'geom');
    }
  }

  function patternControls(b, pat, title, who) {
    select(b, title, pat, 'gen', Object.keys(GENS).map(g => [g, GENS[g].label]), 'geom', true);
    const P = pat.params[pat.gen];
    for (const q of GENS[pat.gen].params) {
      if (!ADV() && !q.basic) continue;
      if (q.type === 'bool') check(b, q.label, P, q.k, 'geom');
      else slider(b, q.label, P, q.k, q.min, q.max, q.step, 'geom', { lock: `${who}.${pat.gen}.${q.k}` });
    }
    if (ADV()) {
      slider(b, 'Phase (°)', pat, 'phase', -180, 180, 0.5, 'geom');
      check(b, 'Invert (open becomes solid)', pat, 'invert', 'geom');
    }
  }

  function linkSection(b) {
    const B = S.shells[1];
    select(b, 'Outer pattern', S.link, 'mode', [['linked', 'Same as inner, detuned'], ['independent', 'Independent']], 'geom', true);
    if (S.link.mode === 'linked') {
      const key = GENS[S.shells[0].pattern.gen].count;
      slider(b, `Detune (${key} + n)`, S.link, 'detune', -48, 48, 1, 'geom', { lock: 'link.detune' });
      check(b, 'Mirror', S.link, 'mirror', 'geom');
    } else {
      patternControls(b, B.pattern, 'Outer generator', 'B');
      if (B.cap.on) {
        check(b, 'Outer cap follows its wall pattern', B.cap, 'follow', 'geom', true);
        if (!B.cap.follow) patternControls(b, B.cap.pattern, 'Outer cap generator', 'Bcap');
      }
      if (ADV()) check(b, 'Mirror', S.link, 'mirror', 'geom');
    }
    UI.lobes = note(b, ''); lobeHint();
  }

  function motionSection(b) {
    select(b, 'Mode', S.motion, 'mode', [['static', 'Static'], ['manual', 'Manual twist'], ['motor', 'Motor']], 'motion', true, v => {
      if (v !== 'motor') { UI.playing = false; UI.animA = UI.animB = 0; }
    });
    UI.period = UI.beat = null;
    if (S.motion.mode === 'static') { note(b, 'The shells stay as assembled. Choose manual twist or motor to explore how they move.'); return; }
    if (S.motion.mode === 'manual') {
      const snap = v => S.motion.snap > 0 ? Math.round(v / S.motion.snap) * S.motion.snap : v;
      const off = slider(b, 'Outer shell twist (°)', S.motion, 'offset', -180, 180, 0.1, 'motion', { snap });
      const bm = el('div', { class: 'marks' });
      const drawMarks = () => {
        bm.innerHTML = '';
        S.motion.bookmarks.forEach((v, i) => bm.append(el('span', { class: 'mark' },
          el('button', { class: 'chip', onclick: () => off.set(v, true), title: 'Go to this twist' }, `${num(v, 0.1)}°`),
          el('button', { class: 'x', 'aria-label': 'Remove bookmark', onclick: () => { S.motion.bookmarks.splice(i, 1); drawMarks(); changed('motion'); } }, '×'))));
        bm.append(el('button', { class: 'chip add', onclick: () => { if (!S.motion.bookmarks.includes(S.motion.offset)) S.motion.bookmarks.push(S.motion.offset); S.motion.bookmarks.sort((a, c) => a - c); drawMarks(); changed('motion'); } }, 'Bookmark this twist'));
      };
      drawMarks(); b.append(bm);
      UI.period = note(b, '');
      if (ADV()) slider(b, 'Detent step (°, 0 = free)', S.motion, 'snap', 0, 30, 0.5, 'motion');
    } else {
      slider(b, 'Inner shell speed (rpm)', S.motion, 'rpmA', -15, 15, 0.05, 'motion');
      slider(b, 'Outer shell speed (rpm)', S.motion, 'rpmB', -15, 15, 0.05, 'motion');
      b.append(el('div', { class: 'btnrow' },
        el('button', { class: 'btn', id: 'play', onclick: () => { UI.playing = !UI.playing; $('#play').textContent = UI.playing ? 'Pause spin' : 'Play spin'; dirty(); } }, UI.playing ? 'Pause spin' : 'Play spin'),
        el('button', { class: 'btn ghost', onclick: () => { UI.animA = UI.animB = 0; dirty(); } }, 'Reset spin')));
      UI.beat = note(b, '');
    }
    beatHint();
  }

  function makeSection(b) {
    select(b, 'Process', S.process, 'profile', [['FDM', 'FDM'], ['SLS', 'SLS / MJF']], 'geom', true);
    UI.makeNote = note(b, ''); makeHint();
    if (!ADV()) return;
    slider(b, 'Minimum web (mm)', S.process, 'minWeb', 0.6, 6, 0.1, 'geom');
    slider(b, 'Minimum hole (mm)', S.process, 'minHole', 0.6, 8, 0.1, 'geom');
    slider(b, 'Shell clearance (mm)', S.process, 'clearance', 0, 3, 0.05, 'geom');
    check(b, 'Fill undersized holes', S.process, 'fillSmall', 'geom');
    check(b, 'Split spheres at the equator', S.process, 'split', 'geom', true);
    if (S.process.split) slider(b, 'Seam band (mm)', S.process, 'seam', 0, 12, 0.5, 'geom');
    slider(b, 'Grid resolution (mm)', S, 'res', 0.35, 2, 0.05, 'geom');
    UI.triNote = note(b, ''); triHint();
    note(b, 'Holes are cut along rays from the light centre, so the wall thickness does not narrow the beam.');
  }

  // ---------- randomize ----------
  // Ranges that tend to look good; the slider limits stay wider for manual tuning.
  const NICE = {
    slots: { N: [12, 90], twist: [-1.5, 1.5], wobA: [0, 6], wobK: [1, 4], duty: [0.3, 0.55] },
    rings: { pitch: [3, 12], K: [0, 12], amp: [0, 4], duty: [0.3, 0.55], bridges: [6, 24], bridgeW: [2.5, 4] },
    phyllo: { N: [150, 900], size: [0.4, 0.75], grad: [-0.5, 0.5] },
    voronoi: { N: [80, 500], web: [2.4, 5], jitter: [0.2, 0.9], seed: [1, 999] },
    superformula: { N: [8, 40], rows: [3, 12], m: [2, 9], n1: [0.3, 4], n2: [0.3, 4], n3: [0.3, 4], size: [0.5, 0.85], grad: [-0.5, 0.5], spin: [-30, 30] },
  };
  // Keep random counts within what the shell can print: roughly 7 mm per slot, 12 mm per lattice cell, 8 mm per dot.
  function niceRange(gen, q, sh) {
    let [lo, hi] = (NICE[gen] || {})[q.k] || [q.min, q.max];
    const Ro = sh.R + sh.t, circ = 2 * Math.PI * Ro, area = circ * Math.max(20, sh.zTop - sh.zBot);
    const cap = { slots: { N: circ / 7 }, superformula: { N: circ / 12 }, phyllo: { N: area / 64 }, voronoi: { N: area / 144 } }[gen];
    if (cap && cap[q.k]) hi = Math.max(lo, Math.min(hi, Math.floor(cap[q.k])));
    if (gen === 'rings' && q.k === 'pitch') lo = Math.max(lo, 7 / Ro * 180 / Math.PI);
    return [lo, Math.max(lo, hi)];
  }
  const DETUNES = [-13, -8, -5, -3, -2, -1, 1, 2, 3, 5, 8, 13];
  function randTargets() {
    const [A, B] = S.shells, T = [{ pat: A.pattern, who: 'A' }];
    if (A.cap.on && !A.cap.follow) T.push({ pat: A.cap.pattern, who: 'Acap' });
    if (S.link.mode === 'independent') { T.push({ pat: B.pattern, who: 'B' }); if (B.cap.on && !B.cap.follow) T.push({ pat: B.cap.pattern, who: 'Bcap' }); }
    return T;
  }
  function randomize() {
    const btn = $('#rand'); if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
    setTimeout(() => {
      const before = JSON.stringify({ shells: S.shells, link: S.link });
      let best = null, bestScore = Infinity, tries = 0, changedN = 0;
      for (; tries < 10; tries++) {
        const cand = JSON.parse(before);
        const tmp = Object.assign({}, S, cand);
        changedN = 0;
        for (const t of randTargets()) {
          const pat = t.who[0] === 'A' ? (t.who === 'A' ? tmp.shells[0].pattern : tmp.shells[0].cap.pattern) : (t.who === 'B' ? tmp.shells[1].pattern : tmp.shells[1].cap.pattern);
          const P = pat.params[pat.gen];
          for (const q of GENS[pat.gen].params) {
            if (q.type === 'bool' || (!ADV() && !q.basic) || UI.locks.includes(`${t.who}.${pat.gen}.${q.k}`)) continue;
            const [lo, hi] = niceRange(pat.gen, q, tmp.shells[t.who[0] === 'A' ? 0 : 1]);
            P[q.k] = Math.min(q.max, Math.max(q.min, Math.round((lo + Math.random() * (hi - lo)) / q.step) * q.step));
            changedN++;
          }
        }
        if (tmp.link.mode === 'linked' && !UI.locks.includes('link.detune')) { tmp.link.detune = DETUNES[Math.floor(Math.random() * DETUNES.length)]; changedN++; }
        if (!changedN) break;
        if (tmp.fit.auto) fitOuter(tmp);
        const pats = effectivePatterns(tmp), caps = effectiveCaps(tmp);
        const g = [0, 1].map(k => buildShell(tmp.shells[k], pats[k], { res: Math.max(1.0, S.res * 1.6), fillSmall: S.process.fillSmall, minWeb: S.process.minWeb, minHole: S.process.minHole, split: S.process.split, seam: S.process.seam, mirror: k === 1 && tmp.link.mirror, capPattern: caps[k], capFollow: capFollows(tmp, k), fdm: S.process.profile === 'FDM' }));
        // filled holes count against a candidate: a pattern whose holes all got filled is not a lamp
        const score = g.reduce((n, x) => n + (x.ok && x.stats.holes > 0 ? x.stats.thin + x.stats.small + x.stats.filled + x.stats.dropped : 1000), 0) + (clearanceGap(g[0], g[1]) < S.process.clearance ? 1000 : 0);
        if (score < bestScore) { bestScore = score; best = cand; }
        if (score === 0) break;
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Randomize'; }
      if (!changedN || !best) { toast('Everything visible is locked. Unlock a slider to randomize it.'); return; }
      UI.undo = before;
      S.shells = best.shells; S.link = best.link;
      renderSidebar(); build(false); changed('motion');
      toast(bestScore === 0 ? `New variation after ${tries + 1} ${tries ? 'tries' : 'try'}; it passes the print checks.` : `No fully clean variation in 10 tries; showing the closest (${bestScore >= 1000 ? 'blocked' : bestScore + ' flags'}).`, bestScore >= 1000);
    }, 20);
  }
  function undoRandom() {
    if (!UI.undo) return;
    const u0 = JSON.parse(UI.undo); UI.undo = null;
    S.shells = u0.shells; S.link = u0.link;
    renderSidebar(); build(false); changed('motion'); toast('Restored the previous pattern.');
  }
  document.addEventListener('keydown', e => {
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) randomize();
  });

  // ---------- hints ----------
  function sharpHint() {
    if (!UI.sharp) return;
    const s = S.source;
    if (s.type === 'point') UI.sharp.textContent = 'An ideal point gives perfectly sharp shadows. Real emitters blur edges by their own size.';
    else if (s.type === 'line') UI.sharp.textContent = 'A filament blurs edges along its length and stays sharp across it: vertical slots stay crisp, horizontal rings blur.';
    else UI.sharp.textContent = `Edges stay crisp where openings are at least 5× the emitter: ${num(5 * s.size, 0.5)} mm here. Smaller openings project as soft blobs.`;
  }
  function triHint() {
    if (!UI.triNote || !G[0]) return;
    const t = (G[0].stats ? G[0].stats.estTris : 0) + (G[1] && G[1].stats ? G[1].stats.estTris : 0);
    UI.triNote.textContent = `About ${(t / 1e6).toFixed(2)} M triangles, ${Math.round(t * 50 / 1e6)} MB of STL. Coarser grid, smaller files.`;
  }
  function makeHint() {
    if (!UI.makeNote) return;
    const bad = notes.filter(x => x.bad).length + [0, 1].filter(k => G[k] && !G[k].ok).length;
    const flags = [0, 1].reduce((n, k) => n + (G[k] && G[k].stats ? G[k].stats.thin + G[k].stats.small : 0), 0);
    UI.makeNote.textContent = bad ? `${bad} blocking issue${bad > 1 ? 's' : ''}. See the notes under the checks table.` :
      flags ? `Exportable, with ${flags} flagged feature${flags > 1 ? 's' : ''} to review in the checks table.` : 'All checks pass. Export when the preview looks right.';
  }
  function periodText() {
    const tp = twistPeriods(effectivePatterns(S)[1], S.shells[1].cap.on ? effectiveCaps(S)[1] : null);
    const d = v => v === null ? 'no short repeat' : v === 0 ? 'unchanged by twist' : `repeats every ${num(v, 0.01)}°`;
    if (S.shells[1].cap.on && tp.wall === tp.cap) return `The outer shell's look ${d(tp.wall)} of twist, walls and cap together.`;
    return `Outer wall ${d(tp.wall)}` + (S.shells[1].cap.on ? `; outer cap ${d(tp.cap)}.` : '.');
  }
  function lobeHint() {
    if (!UI.lobes) return;
    const [pa, pb] = effectivePatterns(S), bi = beatInfo(pa, pb, S.link.mirror, 0, 0);
    UI.lobes.textContent = !bi ? 'Different generators: the room shows their product, with no single beat count.' :
      bi.lobes === 0 ? 'Counts match, so there is no beat: twisting shifts the whole field at once.' :
      `${bi.lobes} moiré lobe${bi.lobes > 1 ? 's' : ''} around the room. Twisting moves them ${num(bi.amp, 0.1)}× faster than the shell turns.`;
  }
  function beatHint() {
    lobeHint();
    if (UI.period) UI.period.textContent = periodText();
    if (!UI.beat) return;
    const [pa, pb] = effectivePatterns(S), bi = beatInfo(pa, pb, S.link.mirror, S.motion.rpmA, S.motion.rpmB);
    UI.beat.textContent = !bi || bi.lobes === 0 ? 'No single beat to track with these patterns.' :
      Math.abs(bi.rate) > 1e-6 ? `The room pattern turns at ${num(bi.rate, 0.01)} rpm.` : 'The room pattern is still.';
  }

  // ---------- build pipeline ----------
  let buildT = null, fullT = null, saveT = null;
  function changed(kind, draft) {
    if (kind === 'geom') { clearTimeout(buildT); buildT = setTimeout(() => build(draft), draft ? 10 : 20); }
    else if (kind === 'room') { R && R.setRoom(S.room.W, S.room.D, S.room.H); setView(UI.view); }
    else if (kind === 'light') { R && R.setEmitter(S.source); crossChecks(); renderChecks(); makeHint(); dirty(); }
    else if (kind === 'motion') { beatHint(); dirty(); }
    if (kind === 'geom' && S.process.profile !== UI.lastProfile) applyProfile();
    beatHint(); sharpHint(); refreshSummaries();
    clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }, 600);
  }
  function applyProfile() {
    if (UI.lastProfile) {
      Object.assign(S.process, S.process.profile === 'SLS' ? { minWeb: 1.5, minHole: 2, clearance: 0.5, split: false } : { minWeb: 2, minHole: 3, clearance: 0.4, split: true });
      renderSidebar();
    }
    UI.lastProfile = S.process.profile;
  }
  function opts(k, res, caps) { return { res, fillSmall: S.process.fillSmall, minWeb: S.process.minWeb, minHole: S.process.minHole, split: S.process.split, seam: S.process.seam, mirror: k === 1 && S.link.mirror, capPattern: caps[k], capFollow: capFollows(S, k), fdm: S.process.profile === 'FDM' }; }
  function build(draft) {
    const res = draft ? Math.min(2.5, S.res * 2) : S.res;
    if (S.fit.auto) fitOuter(S);
    const pats = effectivePatterns(S), caps = effectiveCaps(S);
    G = [0, 1].map(k => buildShell(S.shells[k], pats[k], opts(k, res, caps)));
    G.draft = draft;
    crossChecks();
    if (R) { R.setShell(0, G[0]); R.setShell(1, G[1]); }
    drawMasks(); renderChecks(); triHint(); makeHint(); refreshSummaries(); dirty();
    clearTimeout(fullT); if (draft) fullT = setTimeout(() => build(false), 260);
  }
  function crossChecks() {
    notes = [];
    for (const k of [0, 1]) for (const e of (G[k] ? G[k].errors : [])) notes.push({ bad: true, t: `${k ? 'Outer' : 'Inner'} shell: ${e}` });
    for (const k of [0, 1]) for (const w of (G[k] ? G[k].warnings : [])) notes.push({ bad: false, t: `${k ? 'Outer' : 'Inner'} shell: ${w}` });
    if (G[0] && G[1] && G[0].ok && G[1].ok) {
      const gap = clearanceGap(G[0], G[1]);
      if (gap < S.process.clearance) notes.push({ bad: true, t: gap < 0 ? `Shells overlap by ${num(-gap, 0.01)} mm. Grow the outer radius or shrink the inner shell.` : `Shells are ${num(gap, 0.01)} mm apart; the process needs ${S.process.clearance} mm to rotate freely.` });
      else if (gap < Infinity) notes.push({ bad: false, ok: true, t: `Closest gap between shells: ${num(gap, 0.1)} mm.` });
    }
    if (G[0] && !sourceInside(G[0], S.source)) notes.push({ bad: true, t: 'The emitter pokes through the inner shell or its cap. Shrink it or move it.' });
    if (S.process.profile === 'FDM' && S.shells.some(sh => sh.cap.on && sh.shape === 'cylinder')) notes.push({ bad: false, t: 'Print capped cylinders cap-down: the flat cap needs no support.' });
  }

  // ---------- mask strip & checks ----------
  const COL = { solid: [52, 57, 64], open: [244, 214, 160], drop: [201, 59, 59], thin: [230, 120, 30], small: [140, 110, 240] };
  const maskImg = [null, null];
  function drawMasks() {
    for (const k of [0, 1]) {
      const g = G[k]; maskImg[k] = null;
      if (!g || !g.field) continue;
      const c = document.createElement('canvas'); c.width = g.Nc; c.height = g.Nb;
      const cx = c.getContext('2d'), im = cx.createImageData(g.Nc, g.Nb), d = im.data;
      for (let j = 0; j < g.Nb; j++) for (let i = 0; i < g.Nc; i++) {
        const k2 = j * g.Nc + i, f = g.flags[k2], o = ((g.Nb - 1 - j) * g.Nc + i) * 4;
        const col = f & 1 ? COL.drop : f & 2 ? COL.thin : f & 12 ? COL.small : g.field[k2] < 0 ? COL.open : COL.solid;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
      cx.putImageData(im, 0, 0); maskImg[k] = c;
    }
    paintMasks();
  }
  function paintMasks() {
    const cv = $('#mask'), box = cv.parentElement, dpr = Math.min(2, devicePixelRatio || 1);
    const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const cx = cv.getContext('2d'); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const lab = 18, gap = 14, colW = (w - gap) / 2;
    [0, 1].forEach(k => {
      const x = k * (colW + gap), img = maskImg[k], g = G[k];
      cx.fillStyle = cs.getPropertyValue('--ink-2'); cx.font = '500 13px "Barlow Semi Condensed", system-ui, sans-serif';
      const title = (k ? 'Outer shell' : 'Inner shell') + ', unwrapped' + (g && g.ok && g.cap ? ': wall, then cap above' : '') + (g && g.ok && g.split ? ', printed as two halves' : '');
      cx.fillText(title, x, 13);
      if (!img) { cx.fillText('Fix the errors on the right to see the pattern.', x, 40); return; }
      const ah = h - lab - 4, sc = Math.min(colW / img.width, ah / img.height);
      const dw = img.width * sc, dh = img.height * sc;
      cx.imageSmoothingEnabled = sc < 1; cx.drawImage(img, x, lab + (ah - dh) / 2, dw, dh);
    });
  }
  function renderChecks() {
    const t = $('#checks'); t.innerHTML = '';
    const row = (name, f, cls) => {
      const tr = el('tr', {}, el('th', { scope: 'row' }, name));
      for (const k of [0, 1]) { const g = G[k], v = g && g.stats ? f(g) : '—'; tr.append(el('td', { class: cls && g && g.stats ? cls(g) : '' }, v)); }
      t.append(tr);
    };
    t.append(el('tr', {}, el('th', {}, ''), el('th', { scope: 'col' }, 'Inner'), el('th', { scope: 'col' }, 'Outer')));
    row('Status', g => g.ok ? (G.draft ? 'Draft' : 'Ready') : 'Blocked', g => g.ok ? 'ok' : 'bad');
    row('Holes', g => g.stats.holes);
    row('Open area', g => Math.round(g.stats.open * 100) + '%');
    row('Islands removed', g => g.stats.dropped, g => g.stats.dropped ? 'bad' : '');
    row(`Webs under ${S.process.minWeb} mm`, g => g.stats.thin, g => g.stats.thin ? 'warn' : '');
    if (S.process.fillSmall) row(`Holes filled (under ${S.process.minHole} mm)`, g => g.stats.filled, g => g.stats.filled ? 'odd' : '');
    else row(`Holes under ${S.process.minHole} mm`, g => g.stats.small, g => g.stats.small ? 'odd' : '');
    row('Triangles', g => (g.stats.estTris / 1e6).toFixed(2) + ' M');
    const n = $('#notes'); n.innerHTML = '';
    for (const x of notes) n.append(el('li', { class: x.bad ? 'bad' : x.ok ? 'ok' : 'warn' }, x.t));
    const blocked = !(G[0] && G[0].ok && G[1] && G[1].ok) || notes.some(x => x.bad && /overlap/.test(x.t));
    $('#export').disabled = blocked;
  }

  // ---------- renderer / camera ----------
  const canvas = $('#gl');
  let R = null;
  try { R = createRenderer(canvas); } catch (e) { $('#glerr').textContent = 'The 3D preview failed to start: ' + e.message; $('#glerr').hidden = false; console.error(e); }
  if (!R) { $('#glerr').hidden = false; }
  const cam = { tgt: [0, 0, 0], yaw: 0, pitch: 0, dist: 1000 };
  function eyePos() { const cp = Math.cos(cam.pitch); return [cam.tgt[0] + cam.dist * cp * Math.cos(cam.yaw), cam.tgt[1] + cam.dist * cp * Math.sin(cam.yaw), cam.tgt[2] + cam.dist * Math.sin(cam.pitch)]; }
  function clampCam() {
    const m = 25, { W, D, H } = S.room;
    cam.tgt[0] = Math.max(-W / 2 + m, Math.min(W / 2 - m, cam.tgt[0])); cam.tgt[1] = Math.max(-D / 2 + m, Math.min(D / 2 - m, cam.tgt[1])); cam.tgt[2] = Math.max(m, Math.min(H - m, cam.tgt[2]));
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch)); cam.dist = Math.max(80, Math.min(12000, cam.dist));
  }
  function lookFrom(eye, tgt) { const d = [eye[0] - tgt[0], eye[1] - tgt[1], eye[2] - tgt[2]]; cam.tgt = tgt.slice(); cam.dist = Math.hypot(...d); cam.yaw = Math.atan2(d[1], d[0]); cam.pitch = Math.asin(d[2] / cam.dist); }
  function setView(v) {
    UI.view = v; const { W, D, H, lampZ } = S.room;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v ? 'true' : 'false'));
    if (v === 'room') lookFrom([W / 2 - 120, -D / 2 + 120, Math.min(H - 150, lampZ + 350)], [0, 0, lampZ]);
    if (v === 'wall') lookFrom([0, -D / 2 + 60, Math.min(H - 100, lampZ + 150)], [0, D / 2, lampZ]);
    if (v === 'ceiling') lookFrom([W / 2 - 150, -D / 2 + 150, 300], [0, 0, H]);
    if (v === 'lamp') lookFrom([420, -300, lampZ + 160], [0, 0, lampZ]);
    clampCam(); dirty();
  }
  function camEye() {
    const e = eyePos(), m = 12, { W, D, H } = S.room;
    return [Math.max(-W / 2 + m, Math.min(W / 2 - m, e[0])), Math.max(-D / 2 + m, Math.min(D / 2 - m, e[1])), Math.max(m, Math.min(H - m, e[2]))];
  }
  const ptrs = new Map(); let pinch0 = 0;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
  canvas.addEventListener('pointerup', e => ptrs.delete(e.pointerId));
  canvas.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) cam.dist *= pinch0 / d; pinch0 = d; }
    else if (p.b === 2 || p.sh) {
      const s = cam.dist * 0.0014, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      cam.tgt[0] += sy * dx * s; cam.tgt[1] -= cy * dx * s; cam.tgt[2] += dy * s;
    } else { cam.yaw -= dx * 0.006; cam.pitch += dy * 0.006; }
    clampCam(); dirty();
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); clampCam(); dirty(); }, { passive: false });

  const TESTN = +(new URLSearchParams(location.search).get('frames') || 0);
  const LIGHT = { warm: [1.0, 0.74, 0.47], neutral: [1.0, 0.88, 0.76], cool: [0.93, 0.97, 1.0] };
  let accN = 0, needReset = true, last = performance.now();
  function dirty() { needReset = true; }
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!R) return;
    if (UI.playing && S.motion.mode === 'motor' && (S.motion.rpmA || S.motion.rpmB)) { UI.animA += S.motion.rpmA * 6 * dt; UI.animB += S.motion.rpmB * 6 * dt; needReset = true; }
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; needReset = true; }
    R.targets(w, h);
    const pt = S.source.type === 'point';
    const maxN = TESTN || (R.floatOK ? (pt ? 12 : 128) : 1);
    if (needReset) { accN = 0; needReset = false; }
    if (accN >= maxN) return;
    const eye = camEye(), tgt = cam.tgt;
    const vp = M4.mul(M4.persp(62 * Math.PI / 180, w / h, 5, 30000), M4.look(eye, tgt, [0, 0, 1]));
    const jit = accN === 0 || !R.floatOK ? [0, 0] : [(Math.random() - 0.5) * 2 / w, (Math.random() - 0.5) * 2 / h];
    R.draw({ vp, lamp: [0, 0, S.room.lampZ], rot: [UI.animA * DEG, (S.motion.offset + UI.animB) * DEG], src: S.source,
      samples: UI.playing ? 16 : 8, frame: accN, power: 2.5e6, lightCol: LIGHT[S.source.color], ambient: S.room.ambient,
      exposure: S.room.exposure, jitter: jit, count: accN });
    accN++;
    const st = $('#refine');
    st.textContent = pt || !R.floatOK ? '' : accN < maxN ? `Refining soft shadows ${Math.round(100 * accN / maxN)}%` : '';
  }

  // ---------- export ----------
  function toast(t, bad) { const n = $('#toast'); n.textContent = t; n.className = bad ? 'bad' : ''; n.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => n.hidden = true, 5000); }
  async function save(filename, data, label) {
    const dl = await downloads;
    if (dl) {
      try { await dl.save({ filename, data }); toast(`Saved ${label}.`); }
      catch (e) { if (e && e.code === 'declined') toast('Save cancelled.'); else toast(`Could not save ${label}: ${(e && e.message) || e}`, true); }
      return;
    }
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast(`Saved ${label}.`);
  }
  function interfaceSpec(gap) {
    const prof = (sh, Rs, z) => sh.shape === 'sphere' ? Math.sqrt(Math.max(0, Rs * Rs - z * z)) : Rs;
    return {
      units: 'mm', note: 'Mating dimensions for the stem, bearings and detents you design in CAD. Shell axis is z; the light centre is the origin.',
      shells: [0, 1].map(k => {
        const sh = S.shells[k], g = G[k], R0 = sh.R, R1 = sh.R + sh.t;
        const end = z => ({ z: +z.toFixed(3), innerDiameter: +(2 * prof(sh, R0, z)).toFixed(3), outerDiameter: +(2 * prof(sh, R1, z)).toFixed(3) });
        const top = g.cap ? { cap: true, outerPlaneZ: g.zTop, innerPlaneZ: +(g.zTop - sh.t).toFixed(3), hubRadius: sh.cap.hub, outerDiameterAtTop: +(2 * g.rhoC).toFixed(3) } : Object.assign({ cap: false }, end(g.zTop));
        return { role: k ? 'outer' : 'inner', shape: sh.shape, innerRadius: R0, wall: sh.t, bottomEnd: end(g.zBot), top, splitAtEquator: g.split, seamBand: g.split ? S.process.seam : 0 };
      }),
      closestGap: +gap.toFixed(3), requiredClearance: S.process.clearance,
      twistPeriodDeg: twistPeriods(effectivePatterns(S)[1], S.shells[1].cap.on ? effectiveCaps(S)[1] : null),
      motion: { outerTwistDeg: S.motion.offset, detentStepDeg: S.motion.snap, bookmarksDeg: S.motion.bookmarks, rpmInner: S.motion.rpmA, rpmOuter: S.motion.rpmB },
      source: S.source,
    };
  }
  async function exportPack() {
    const btn = $('#export'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Building meshes…';
    await new Promise(r => setTimeout(r, 30));
    try {
      clearTimeout(fullT); clearTimeout(buildT); build(false);
      if (!(G[0].ok && G[1].ok)) { toast('Fix the blocked shell before exporting.', true); return; }
      const files = [], report = [`Tenebrae export, ${new Date().toISOString()}`, `Grid ${S.res} mm, process ${S.process.profile}, min web ${S.process.minWeb} mm, min hole ${S.process.minHole} mm`, ''];
      let allOK = true;
      for (const k of [0, 1]) for (const part of G[k].parts) {
        const name = `${k ? 'outer' : 'inner'}-shell${part.suffix ? '-' + part.suffix : ''}.stl`;
        btn.textContent = `Meshing ${name}…`; await new Promise(r => setTimeout(r, 0));
        const m = buildMesh(G[k], part), c = checkMesh(m, part.holes, part.ends);
        allOK = allOK && c.ok;
        report.push(`${name}: ${c.F} triangles, ${c.ok ? 'watertight' : 'CHECK FAILED'} (open edges ${c.badEdges}, genus ${c.genus}, expected ${c.expectGenus} for ${part.holes} holes)`);
        files.push({ name, data: stlBinary(m, name) });
      }
      for (const k of [0, 1]) { const s = G[k].stats; report.push(`${k ? 'Outer' : 'Inner'}: ${s.holes} holes, ${Math.round(s.open * 100)}% open, ${s.dropped} islands removed, ${s.thin} thin webs, ${s.small} undersized holes left, ${s.filled} filled`); }
      for (const n of notes) report.push((n.bad ? 'ERROR ' : 'NOTE ') + n.t);
      const enc = new TextEncoder();
      files.push({ name: 'design.json', data: enc.encode(JSON.stringify(S, null, 2)) });
      files.push({ name: 'interface.json', data: enc.encode(JSON.stringify(interfaceSpec(clearanceGap(G[0], G[1])), null, 2)) });
      files.push({ name: 'checks.txt', data: enc.encode(report.join('\n') + '\n') });
      btn.textContent = 'Packing…'; await new Promise(r => setTimeout(r, 0));
      const blob = new Blob(zipStore(files), { type: 'application/zip' });
      if (!allOK) toast('A mesh check failed; see checks.txt in the zip.', true);
      await save(`tenebrae-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'print files');
    } catch (e) { console.error(e); toast('Export failed: ' + e.message, true); }
    finally { btn.textContent = old; renderChecks(); }
  }

  // ---------- header wiring ----------
  const ps = $('#preset');
  const groups = {};
  PRESETS.forEach((p, i) => { const g = p.group || 'Studies'; if (!groups[g]) { groups[g] = el('optgroup', { label: g }); ps.append(groups[g]); } groups[g].append(el('option', { value: i }, p.name)); });
  ps.value = '';
  ps.addEventListener('change', () => {
    const pr = PRESETS[+ps.value], p = pr.make(); S.shells = p.shells; S.link = p.link; S.fit = p.fit; S.plan = p.plan; S.motion.offset = 0; UI.animA = UI.animB = 0;
    if (pr.source) { S.source = JSON.parse(JSON.stringify(pr.source)); R && R.setEmitter(S.source); }
    if (pr.mount) { S.lamp.mount = pr.mount; S.room.lampZ = MOUNT_Z[pr.mount]; R && R.setRoom(S.room.W, S.room.D, S.room.H); setView(UI.view); }
    UI.undo = null;
    renderSidebar(); build(false); changed('motion'); ps.blur();
  });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#export').addEventListener('click', exportPack);
  $('#savejson').addEventListener('click', () => save('tenebrae-design.json', JSON.stringify(S, null, 2), 'design'));
  $('#loadjson').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { S = loadDesign(JSON.parse(rd.result)); UI.lastProfile = S.process.profile; renderSidebar(); R && (R.setRoom(S.room.W, S.room.D, S.room.H), R.setEmitter(S.source)); build(false); setView(UI.view); toast('Design loaded.'); } catch (err) { toast('That file is not a Tenebrae design: ' + err.message, true); } };
    rd.readAsText(f); e.target.value = '';
  });
  new ResizeObserver(() => { paintMasks(); dirty(); }).observe($('#maskbox'));
  downloads.then(d => { if (!d && window.claude && window.claude.use) { /* viewer without downloads: anchor fallback stays */ } });

  UI.lastProfile = S.process.profile;
  renderSidebar();
  if (R) { R.setRoom(S.room.W, S.room.D, S.room.H); R.setEmitter(S.source); }
  build(false); setView('room');
  if (R && !R.floatOK) $('#refine').textContent = 'Soft-shadow refinement unavailable on this GPU; showing single-pass shadows.';
  requestAnimationFrame(loop);
  window.__tenebrae = { S, cam, dirty, get G() { return G; }, setView, build, exportPack };
})();
