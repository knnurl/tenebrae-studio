// ===== Tenebrae state: defaults, presets, effective patterns =====
function mkShell(shape, R, t, zBot, zTop, rimBot, rimTop, gen, params, invert, cap) {
  const p = genDefaults();
  if (params) Object.assign(p[gen], params);
  const c = { on: false, follow: true, hub: 22, gen: 'slots', params: { N: 18, twist: 2, duty: 0.38 } };
  if (cap) Object.assign(c, cap);
  const cp = genDefaults(); Object.assign(cp[c.gen], c.params);
  return { shape, R, t, zBot, zTop, rimBot, rimTop, pattern: { gen, invert: !!invert, phase: 0, params: p },
    cap: { on: c.on, follow: c.follow, hub: c.hub, pattern: { gen: c.gen, invert: false, phase: 0, params: cp } } };
}
function defaultState() {
  const s = {
    v: 2,
    lamp: { mount: 'table' },
    plan: { target: 'ceiling' },
    fit: { auto: true, gap: 9 },
    source: { type: 'disc', size: 1.4, length: 30, z: 0, emit: 'up', color: 'warm' },
    shells: [
      mkShell('cylinder', 50, 3, -25, 110, 25, 6, 'slots', { N: 36, duty: 0.45 }, false, { on: true, follow: true, hub: 24 }),
      mkShell('cylinder', 62, 3, -34, 122, 34, 6, 'slots', { N: 39, duty: 0.45 }, false, { on: true, follow: true, hub: 24 }),
    ],
    link: { mode: 'linked', detune: 3, mirror: false },
    motion: { mode: 'manual', offset: 0, snap: 0, bookmarks: [], rpmA: 0, rpmB: 0.2 },
    process: { profile: 'FDM', minWeb: 2, minHole: 3, clearance: 0.4, split: true, seam: 4, fillSmall: true },
    room: { W: 4200, D: 3600, H: 2600, lampZ: 900, exposure: 1, ambient: 0.02 },
    res: 0.7,
  };
  fitOuter(s);
  return s;
}
// Outer shell derived from the inner shell and one gap (radial, and axial above a cap).
function fitOuter(s) {
  const A = s.shells[0], B = s.shells[1], g = s.fit.gap;
  B.shape = A.shape; B.t = A.t; B.R = A.R + A.t + g;
  if (A.shape === 'sphere') {
    const k = B.R / A.R;
    B.zBot = A.zBot * k; B.rimBot = A.rimBot * k;
    B.zTop = A.cap.on ? A.zTop + g + B.t : A.zTop * k; B.rimTop = A.cap.on ? A.rimTop : A.rimTop * k;
  } else {
    B.zBot = A.zBot - g; B.rimBot = A.rimBot + g;
    B.zTop = A.zTop + g + (A.cap.on ? B.t : 0); B.rimTop = A.cap.on ? A.rimTop : A.rimTop + g;
  }
  B.cap.on = A.cap.on; B.cap.hub = A.cap.hub; B.cap.follow = A.cap.follow;
}
function uplight(gen, params, link, cap) {
  const s = defaultState();
  s.shells[0] = mkShell('cylinder', 50, 3, -25, 110, 25, 6, gen, params, false, Object.assign({ on: true, follow: true, hub: 24 }, cap || {}));
  s.shells[1] = mkShell('cylinder', 62, 3, -34, 122, 34, 6, gen, params, false, { on: true, follow: true, hub: 24 });
  s.link = Object.assign({ mode: 'linked', detune: 3, mirror: false }, link || {});
  fitOuter(s);
  return s;
}
function helixState() {
  const s = defaultState();
  s.fit.auto = false; s.plan.target = 'walls';
  s.shells[0] = mkShell('cylinder', 58, 3.5, -90, 90, 10, 10, 'slots', { N: 40, duty: 0.4 });
  s.shells[1] = mkShell('cylinder', 70, 3.5, -96, 96, 10, 10, 'slots', { N: 43, duty: 0.4 });
  return s;
}
const PRESETS = [
  { name: 'Table uplight, auto-fitted (default)', group: 'Table uplights', make: () => defaultState() },
  { name: 'Uplight: phyllotaxis dots', group: 'Table uplights', make: () => uplight('phyllo', { N: 260, size: 0.6 }, { detune: 13 }) },
  { name: 'Uplight: Voronoi cells', group: 'Table uplights', make: () => { const s = uplight('voronoi', { N: 150, web: 3, jitter: 0.6, seed: 7 }, { mode: 'independent' });
    Object.assign(s.shells[1].pattern.params.voronoi, { N: 170, seed: 21 }); return s; } },
  { name: 'Uplight: wavy rings', group: 'Table uplights', make: () => uplight('rings', { pitch: 8, K: 6, amp: 2, duty: 0.45, bridges: 12, bridgeW: 3 }, { detune: 1 }) },
  { name: 'Uplight: counter-spirals', group: 'Table uplights', make: () => uplight('slots', { N: 30, twist: 1.2, duty: 0.45 }, { detune: 0, mirror: true }) },
  { name: 'Uplight: superformula stars', group: 'Table uplights', make: () => uplight('superformula', { N: 14, rows: 5, m: 5, n1: 0.8, n2: 1.2, n3: 1.2, size: 0.7 }, { detune: 2 }) },
  { name: 'Wall wash: filament and slots', group: 'Other targets', source: { type: 'line', size: 1.4, length: 30, z: 0, emit: 'omni', color: 'warm' }, make: () => { const s = defaultState();
    s.plan.target = 'walls';
    s.shells[0] = mkShell('cylinder', 55, 3, -80, 80, 10, 10, 'slots', { N: 24, duty: 0.42 });
    s.shells[1] = mkShell('cylinder', 67, 3, -89, 89, 19, 19, 'slots', { N: 26, duty: 0.42 });
    s.link = { mode: 'linked', detune: 2, mirror: false }; fitOuter(s); return s; } },
  { name: 'Helix moiré, cylinders', make: () => helixState() },
  { name: 'Phyllotaxis globe', make: () => { const s = defaultState(); s.fit.auto = false; s.plan.target = 'everywhere';
    s.shells[0] = mkShell('sphere', 58, 3.5, -46, 50, 6, 6, 'phyllo', { N: 360, size: 0.6 });
    s.shells[1] = mkShell('sphere', 74, 3.5, -58, 64, 6, 6, 'phyllo', { N: 380, size: 0.6 });
    s.link = { mode: 'linked', detune: 21, mirror: false }; return s; } },
  { name: 'Rings over Voronoi', make: () => { const s = defaultState(); s.fit.auto = false; s.plan.target = 'walls';
    s.shells[0] = mkShell('cylinder', 56, 3.5, -85, 85, 9, 9, 'rings', { pitch: 7, K: 8, amp: 1.5, duty: 0.45, bridges: 14, bridgeW: 3 });
    s.shells[1] = mkShell('cylinder', 70, 3.5, -92, 92, 9, 9, 'voronoi', { N: 220, web: 3.2, jitter: 0.7, seed: 11 });
    s.link = { mode: 'independent', detune: 0, mirror: false }; return s; } },
  { name: 'Counter-spirals', make: () => { const s = defaultState(); s.fit.auto = false; s.plan.target = 'walls';
    s.shells[0] = mkShell('cylinder', 58, 3.5, -90, 90, 10, 10, 'slots', { N: 30, twist: 1.1, duty: 0.42 });
    s.shells[1] = mkShell('cylinder', 70, 3.5, -96, 96, 10, 10, 'slots', { N: 30, twist: 1.1, duty: 0.42 });
    s.link = { mode: 'linked', detune: 0, mirror: true }; return s; } },
  { name: 'Uplight: slots, 5 mm cap gap', group: 'Table uplights', source: { type: 'disc', size: 1.4, length: 30, z: 0, emit: 'up', color: 'warm' }, make: () => { const s = defaultState(); s.fit.auto = false;
    s.shells[0] = mkShell('cylinder', 50, 3, -25, 110, 25, 6, 'slots', { N: 36, duty: 0.45 }, false, { on: true, follow: true, hub: 24 });
    s.shells[1] = mkShell('cylinder', 62, 3, -30, 118, 30, 6, 'slots', { N: 39, duty: 0.45 }, false, { on: true, follow: true, hub: 24 });
    s.link = { mode: 'linked', detune: 3, mirror: false }; return s; } },
  { name: 'Superformula lantern', make: () => { const s = defaultState(); s.fit.auto = false; s.plan.target = 'everywhere';
    s.shells[0] = mkShell('sphere', 60, 3.5, -48, 52, 6, 6, 'superformula', { N: 16, rows: 6, m: 5, n1: 0.8, n2: 1.2, n3: 1.2, size: 0.66 });
    s.shells[1] = mkShell('sphere', 76, 3.5, -60, 66, 6, 6, 'voronoi', { N: 150, web: 3, jitter: 0.5, seed: 3 });
    s.link = { mode: 'independent', detune: 0, mirror: false }; return s; } },
];
function effectivePatterns(st) { return linkedPair(st, sh => sh.pattern); }
function effectiveCaps(st) { return linkedPair(st, sh => sh.cap.follow ? sh.pattern : sh.cap.pattern); }
function capFollows(st, k) { return (st.link.mode === 'linked' ? st.shells[0] : st.shells[k]).cap.follow; }
// Load a saved design. Caps saved before "follow" existed kept their own pattern.
function loadDesign(raw) {
  const S = mergeDeep(defaultState(), raw);
  if (raw && !raw.fit) S.fit.auto = false;
  (raw && raw.shells || []).forEach((sh, k) => { if (S.shells[k] && sh && sh.cap && !('follow' in sh.cap)) S.shells[k].cap.follow = false; });
  return S;
}
function linkedPair(st, pick) {
  const A = pick(st.shells[0]);
  let B = pick(st.shells[1]);
  if (st.link.mode === 'linked') {
    const key = GENS[A.gen].count, def = GENS[A.gen].params.find(q => q.k === key);
    const params = JSON.parse(JSON.stringify(A.params));
    params[A.gen][key] = Math.max(def.min, Math.round(A.params[A.gen][key] + st.link.detune));
    B = { gen: A.gen, invert: A.invert, phase: A.phase, params };
  }
  const flat = p => ({ gen: p.gen, invert: p.invert, phase: p.phase, params: p.params[p.gen] });
  return [flat(A), flat(B)];
}
function mergeDeep(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over.map((v, i) => i < base.length ? mergeDeep(base[i], v) : v) : base;
  if (base && typeof base === 'object') {
    const o = { ...base };
    if (over && typeof over === 'object') for (const k in over) o[k] = k in base ? mergeDeep(base[k], over[k]) : over[k];
    return o;
  }
  return (over === undefined || over === null || typeof over !== typeof base) ? base : over;
}
if (typeof module !== 'undefined') module.exports = { fitOuter, helixState, defaultState, PRESETS, effectivePatterns, effectiveCaps, capFollows, loadDesign, mergeDeep, mkShell };
