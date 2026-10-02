// ===== Tenebrae core: pure geometry, no DOM. Units: mm, radians internally. =====
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FORCE = 4;              // mm magnitude used for forced-solid / dropped regions
const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
const MASK_CLAMP = 2;         // mm range packed into the 8-bit preview texture

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrapPi = x => x - TAU * Math.round(x / TAU);

// ---------- Pattern generators ----------
// Each returns a field in mm: negative = open (light passes), positive = solid.
const GENS = {
  slots: {
    label: 'Slots and spirals', count: 'N', azimuthal: true,
    params: [
      { k: 'N', basic: true, label: 'Slots around', min: 3, max: 240, step: 1, def: 60 },
      { k: 'twist', basic: true, label: 'Twist (° per ° of elevation)', min: -3, max: 3, step: 0.01, def: 0 },
      { k: 'wobA', label: 'Wobble amplitude (°)', min: 0, max: 20, step: 0.1, def: 0 },
      { k: 'wobK', label: 'Wobble waves per 90°', min: 0, max: 12, step: 0.5, def: 2 },
      { k: 'duty', basic: true, label: 'Open fraction', min: 0.05, max: 0.9, step: 0.01, def: 0.34 },
    ],
    prepare(ctx, p) {
      const N = Math.round(p.N), tw = p.twist, A = p.wobA * DEG, K = p.wobK * 4, duty = p.duty;
      return (phi, j) => {
        const psi = ctx.psi[j];
        const th = N * (phi + tw * psi + A * Math.sin(K * psi));
        const gpsi = N * (tw + A * K * Math.cos(K * psi));
        const a = N / ctx.rho[j], c = gpsi / ctx.dsd[j], g = Math.sqrt(a * a + c * c);
        return (Math.abs(wrapPi(th)) - Math.PI * duty) / g;
      };
    },
  },
  rings: {
    label: 'Rings and waves', count: 'K', azimuthal: true,
    params: [
      { k: 'pitch', basic: true, label: 'Ring pitch (° of elevation)', min: 1, max: 30, step: 0.1, def: 6 },
      { k: 'K', basic: true, label: 'Waves around', min: 0, max: 48, step: 1, def: 6 },
      { k: 'amp', label: 'Wave amplitude (°)', min: 0, max: 15, step: 0.1, def: 1.5 },
      { k: 'duty', basic: true, label: 'Open fraction', min: 0.05, max: 0.9, step: 0.01, def: 0.4 },
      { k: 'bridges', basic: true, label: 'Bridges around', min: 0, max: 48, step: 1, def: 12 },
      { k: 'bridgeW', label: 'Bridge width (mm)', min: 1, max: 10, step: 0.1, def: 3 },
    ],
    prepare(ctx, p) {
      const P = p.pitch * DEG, K = Math.round(p.K), A = p.amp * DEG, duty = p.duty;
      const B = Math.round(p.bridges), bh = p.bridgeW / 2;
      return (phi, j) => {
        const psi = ctx.psi[j];
        const th = TAU * (psi + A * Math.sin(K * phi)) / P;
        const gphi = TAU * A * K * Math.cos(K * phi) / P / ctx.rho[j], gpsi = TAU / P / ctx.dsd[j];
        const v = (Math.abs(wrapPi(th)) - Math.PI * duty) / Math.sqrt(gphi * gphi + gpsi * gpsi);
        if (!B) return v;
        const b = bh - ctx.rho[j] * Math.abs(wrapPi(B * phi)) / B;
        return v > b ? v : b;
      };
    },
  },
  phyllo: {
    label: 'Phyllotaxis dots', count: 'N', azimuthal: false,
    params: [
      { k: 'N', basic: true, label: 'Dots', min: 20, max: 3000, step: 1, def: 420 },
      { k: 'size', basic: true, label: 'Dot size (× spacing)', min: 0.1, max: 0.95, step: 0.01, def: 0.55 },
      { k: 'grad', label: 'Size gradient, bottom to top', min: -1, max: 1, step: 0.01, def: 0 },
    ],
    prepare(ctx, p) {
      const N = Math.round(p.N);
      const pre = fibPoints(ctx, N, 0, 0, 1);
      const inset = pre.spacing * p.size * 0.5 * (1 + Math.abs(p.grad)) + 0.5;
      const F = fibPoints(ctx, N, inset, 0, 1);
      let maxR = 0;
      for (const q of F.pts) {
        q.r = Math.max(0.05 * F.spacing, F.spacing * p.size * 0.5 * (1 + p.grad * (2 * q.u - 1)));
        maxR = Math.max(maxR, q.r);
      }
      const H = makeHash(ctx, F.pts, F.spacing);
      const search = Math.min(F.spacing * 1.2, FORCE + 1) + maxR;
      return (phi, j) => {
        let best = FORCE;
        H.query(phi, ctx.bandS[j], ctx.rho[j], search, (q, dx, dy) => {
          const v = Math.sqrt(dx * dx + dy * dy) - q.r; if (v < best) best = v;
        });
        return best;
      };
    },
  },
  voronoi: {
    label: 'Voronoi cells', count: 'N', azimuthal: false,
    params: [
      { k: 'N', basic: true, label: 'Cells', min: 20, max: 2000, step: 1, def: 240 },
      { k: 'web', basic: true, label: 'Web width (mm)', min: 0.8, max: 12, step: 0.1, def: 3 },
      { k: 'jitter', label: 'Irregularity', min: 0, max: 1, step: 0.01, def: 0.6 },
      { k: 'seed', label: 'Seed', min: 1, max: 999, step: 1, def: 7 },
    ],
    prepare(ctx, p) {
      const F = fibPoints(ctx, Math.round(p.N), 0, p.jitter, Math.round(p.seed));
      const H = makeHash(ctx, F.pts, F.spacing);
      const pts = F.pts, np = pts.length, half = p.web / 2, C = half + FORCE + 1;
      pts.forEach((q, i) => q.i = i);
      // Neighbour graph (radius covers Delaunay neighbours for Fibonacci-like sets).
      const nb = pts.map(q => { const L = []; H.query(q.phi, q.s, ctx.rhoAt(q.s), F.spacing * 2.6, (o) => { if (o !== q) L.push(o.i); }); return Int32Array.from(L); });
      const PH = Float64Array.from(pts, q => q.phi), PS = Float64Array.from(pts, q => q.s);
      let cur = -1, curRow = -1;
      return (phi, j) => {
        if (np < 2) return FORCE;
        const s = ctx.bandS[j], rq = ctx.rho[j];
        if (curRow !== j || cur < 0) {
          let bd = Infinity; cur = -1;
          H.query(phi, s, rq, F.spacing * 3, (q, dx, dy) => { const d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; cur = q.i; } });
          curRow = j; if (cur < 0) return FORCE;
        }
        // Greedy walk to the nearest site.
        let dxc = rq * wrapPi(PH[cur] - phi), dyc = PS[cur] - s, dc = dxc * dxc + dyc * dyc;
        for (let moved = true; moved;) {
          moved = false; const L = nb[cur];
          for (let t = 0; t < L.length; t++) {
            const o = L[t], dx = rq * wrapPi(PH[o] - phi), dy = PS[o] - s, d2 = dx * dx + dy * dy;
            if (d2 < dc) { dc = d2; cur = o; dxc = dx; dyc = dy; moved = true; }
          }
        }
        const L = nb[cur]; let de = C;
        for (let t = 0; t < L.length; t++) {
          const o = L[t], dx = rq * wrapPi(PH[o] - phi), dy = PS[o] - s;
          const ex = dx - dxc, ey = dy - dyc, sep = Math.sqrt(ex * ex + ey * ey);
          if (sep < 1e-6) continue;
          const e = (dx * dx + dy * dy - dc) / (2 * sep); if (e < de) de = e;
        }
        return half - de;
      };
    },
  },
  superformula: {
    label: 'Superformula lattice', count: 'N', azimuthal: true,
    params: [
      { k: 'N', basic: true, label: 'Shapes per row', min: 3, max: 120, step: 1, def: 18 },
      { k: 'rows', basic: true, label: 'Rows', min: 1, max: 40, step: 1, def: 7 },
      { k: 'm', basic: true, label: 'Symmetry m', min: 0, max: 12, step: 1, def: 5 },
      { k: 'n1', label: 'n1', min: 0.2, max: 10, step: 0.05, def: 0.8 },
      { k: 'n2', label: 'n2', min: 0.2, max: 10, step: 0.05, def: 1.2 },
      { k: 'n3', label: 'n3', min: 0.2, max: 10, step: 0.05, def: 1.2 },
      { k: 'size', basic: true, label: 'Size (× cell)', min: 0.1, max: 1, step: 0.01, def: 0.82 },
      { k: 'grad', label: 'Size gradient, bottom to top', min: -1, max: 1, step: 0.01, def: 0 },
      { k: 'spin', label: 'Rotation per row (°)', min: -90, max: 90, step: 0.5, def: 0 },
      { k: 'stagger', label: 'Stagger rows', type: 'bool', def: true },
    ],
    prepare(ctx, p) {
      const N = Math.round(p.N), M = Math.round(p.rows), m = p.m;
      const n1 = p.n1, n2 = p.n2, n3 = p.n3;
      const rsf = th => Math.pow(Math.pow(Math.abs(Math.cos(m * th / 4)), n2) + Math.pow(Math.abs(Math.sin(m * th / 4)), n3), -1 / n1);
      const LN = 2048, lut = new Float32Array(LN + 1);
      let rmax = 0; for (let i = 0; i <= LN; i++) { lut[i] = rsf(i * TAU / LN); if (i < LN) rmax = Math.max(rmax, lut[i]); }
      for (let i = 0; i <= LN; i++) lut[i] /= rmax;
      const shape = th => { let u = (th / TAU) % 1; if (u < 0) u += 1; const x = u * LN, i = x | 0, f = x - i; return lut[i] + (lut[i + 1] - lut[i]) * f; };
      const ch = (ctx.sHi - ctx.sLo) / M, cellAng = TAU / N;
      const rowS = [], rowHalf = [];
      for (let r = 0; r < M; r++) {
        const sc = ctx.sLo + (r + 0.5) * ch;
        const sz = p.size * (1 + p.grad * (2 * (r + 0.5) / M - 1));
        rowS.push(sc); rowHalf.push(Math.max(0.2, sz) * Math.min(ctx.rhoAt(sc) * cellAng, ch) / 2);
      }
      return (phi, j) => {
        const s = ctx.bandS[j], rq = ctx.rho[j];
        const r0 = Math.floor((s - ctx.sLo) / ch);
        let best = FORCE;
        for (let r = r0 - 1; r <= r0 + 1; r++) {
          if (r < 0 || r >= M) continue;
          const off = p.stagger && (r & 1) ? 0.5 : 0;
          const c0 = Math.round(phi / cellAng - off);
          for (let c = c0 - 1; c <= c0 + 1; c++) {
            const pc = (c + off) * cellAng;
            const dx = rq * wrapPi(phi - pc), dy = s - rowS[r];
            const th = Math.atan2(dy, dx) - r * p.spin * DEG;
            const v = Math.sqrt(dx * dx + dy * dy) - rowHalf[r] * shape(th);
            if (v < best) best = v;
          }
        }
        return best;
      };
    },
  },
};

function genDefaults() {
  const o = {};
  for (const g in GENS) { o[g] = {}; for (const q of GENS[g].params) o[g][q.k] = q.def; }
  return o;
}

// Equal-area Fibonacci points on the outer face, in (phi, s) chart coords.
function fibPoints(ctx, N, inset, jitter, seed) {
  const a = ctx.sLo + inset, b = ctx.sHi - inset;
  const W = ctx.W || (s => ctx.sph ? Math.sin(s / ctx.Ro) : s);
  const Wi = ctx.Wi || (w => ctx.sph ? ctx.Ro * Math.asin(Math.max(-1, Math.min(1, w))) : w);
  const K = ctx.areaK || (ctx.sph ? TAU * ctx.Ro * ctx.Ro : TAU * ctx.Ro);
  const wa = W(Math.min(a, b)), wb = W(Math.max(a, b));
  const area = K * (wb - wa);
  const spacing = Math.sqrt(Math.max(area, 1) / N);
  const rnd = mulberry32(seed);
  const pts = [];
  for (let k = 0; k < N; k++) {
    const u = (k + 0.5) / N;
    let s = Wi(wa + u * (wb - wa));
    let phi = (k * GA) % TAU;
    if (jitter > 0) {
      phi += (rnd() - 0.5) * jitter * spacing / ctx.rhoAt(s);
      s = Math.max(ctx.sLo, Math.min(ctx.sHi, s + (rnd() - 0.5) * jitter * spacing));
    }
    pts.push({ phi: ((phi % TAU) + TAU) % TAU, s, u });
  }
  return { pts, spacing };
}

// Bucket grid for neighbour queries in the (phi, s) chart with local metric.
function makeHash(ctx, pts, spacing) {
  const h = Math.max(spacing, 0.5);
  const nRows = Math.max(1, Math.ceil((ctx.sHi - ctx.sLo) / h) + 1);
  const rows = [];
  for (let r = 0; r < nRows; r++) {
    const sc = ctx.sLo + (r + 0.5) * h;
    const nc = Math.max(1, Math.floor(TAU * ctx.rhoAt(Math.min(sc, ctx.sHi)) / h));
    rows.push({ nc, cells: Array.from({ length: nc }, () => []) });
  }
  for (const q of pts) {
    const r = Math.min(nRows - 1, Math.max(0, Math.floor((q.s - ctx.sLo) / h)));
    const R = rows[r]; R.cells[Math.min(R.nc - 1, Math.floor(q.phi / TAU * R.nc))].push(q);
  }
  return {
    query(phi, s, rhoQ, radius, cb) {
      const r0 = Math.max(0, Math.floor((s - radius - ctx.sLo) / h));
      const r1 = Math.min(nRows - 1, Math.floor((s + radius - ctx.sLo) / h));
      const dphi = radius / Math.max(rhoQ, 1e-3);
      for (let r = r0; r <= r1; r++) {
        const R = rows[r], w = TAU / R.nc;
        let c0, c1;
        if (dphi >= Math.PI) { c0 = 0; c1 = R.nc - 1; }
        else { c0 = Math.floor((phi - dphi) / w); c1 = Math.floor((phi + dphi) / w); if (c1 - c0 >= R.nc) { c0 = 0; c1 = R.nc - 1; } }
        for (let c = c0; c <= c1; c++) {
          const cell = R.cells[((c % R.nc) + R.nc) % R.nc];
          for (const q of cell) {
            const dx = rhoQ * wrapPi(q.phi - phi), dy = q.s - s;
            if (dx * dx + dy * dy <= radius * radius) cb(q, dx, dy);
          }
        }
      }
    },
  };
}

// ---------- Shell construction ----------
// sh: {shape, R, t, zBot, zTop, rimBot, rimTop}; pat: {gen, invert, phase, params}
// opts: {res, minWeb, minHole, split, seam, mirror, fillSmall, fdm, capPattern, capFollow, capBotPattern, capBotFollow}
// sh.cap / sh.capBot: {on, hub, bore, ...}: flat patterned end caps; a bore leaves a through-hole for the stem
function buildShell(sh, pat, opts) {
  const errors = [], warnings = [];
  const sph = sh.shape === 'sphere';
  const R = sh.R, t = sh.t, Ro = R + t, res = opts.res;
  let zBot = sh.zBot, zTop = sh.zTop;
  if (t < 0.2) errors.push('Wall thickness must be at least 0.2 mm.');
  if (t < 1 && opts.fdm) warnings.push('Walls under 1 mm do not print reliably on FDM; thin sheet suits laser cutting.');
  if (sph) {
    const lim = 0.95 * R;
    if (zBot < -lim || zTop > lim) warnings.push(`Sphere openings clamped to ±${lim.toFixed(0)} mm (95% of radius).`);
    zBot = Math.max(-lim, zBot); zTop = Math.min(lim, zTop);
  }
  if (zTop - zBot < 20) errors.push('Shell needs at least 20 mm of height.');

  const cap = !!(sh.cap && sh.cap.on), capB = !!(sh.capBot && sh.capBot.on);
  const boreT = cap ? Math.max(0, sh.cap.bore || 0) : 0, boreB = capB ? Math.max(0, sh.capBot.bore || 0) : 0;
  if (cap && zTop - t < 10) errors.push('A top cap needs the top at least 10 mm plus the wall above the light.');
  if (capB && zBot + t > -10) errors.push('A bottom cap needs the bottom at least 10 mm plus the wall below the light.');
  if (cap && zTop - t <= zBot + 10) errors.push('A capped shell needs at least 10 mm between the bottom opening and the cap.');
  // Corners, where the outer wall meets the top and bottom planes (used when capped).
  const sC = sph ? Ro * Math.asin(Math.min(0.999, zTop / Ro)) : zTop;
  const rhoC = sph ? Math.sqrt(Math.max(0, Ro * Ro - zTop * zTop)) : Ro;
  const sCB = sph ? Ro * Math.asin(Math.max(-0.999, zBot / Ro)) : zBot;
  const rhoCB = sph ? Math.sqrt(Math.max(0, Ro * Ro - zBot * zBot)) : Ro;
  const onCap = s => cap && s > sC, onCapB = s => capB && s < sCB;
  const psiOfS = s => onCap(s) ? Math.atan2(zTop, rhoC - (s - sC)) : onCapB(s) ? Math.atan2(zBot, rhoCB - (sCB - s)) : (sph ? s / Ro : Math.atan(s / Ro));
  const pt = (face, s) => {
    const Rs = face ? Ro : R, psi = psiOfS(s);
    let r = sph ? Rs * Math.cos(psi) : Rs, z = sph ? Rs * Math.sin(psi) : Rs * Math.tan(psi);
    if (cap) { const zc = face ? zTop : zTop - t; if (z > zc) { r = zc / Math.tan(psi); z = zc; } }
    if (capB) { const zc = face ? zBot : zBot + t; if (z < zc) { r = zc / Math.tan(psi); z = zc; } }
    return [r, z];
  };
  const prof = (Rs, z) => sph ? Math.sqrt(Math.max(0, Rs * Rs - z * z)) : Rs;
  const rhoAt = s => onCap(s) ? rhoC - (s - sC) : onCapB(s) ? rhoCB - (sCB - s) : (sph ? Ro * Math.cos(s / Ro) : Ro);

  // Pattern band on the outer face (arc length s). Capped ends run on round their corner to the hub.
  let sLo, sHi, sEndBot, sEndTop, sWallLo, sWallHi, sCapLo = Infinity, sCapBHi = -Infinity;
  const hubT = cap ? Math.max(1, sh.cap.hub) : 0, hubB = capB ? Math.max(1, sh.capBot.hub) : 0;
  if (capB) {
    sLo = sCB - (rhoCB - hubB); sWallLo = sCB + sh.rimBot / 2; sCapBHi = sCB - sh.rimBot / 2;
    if (sCapBHi - sLo < 6 * res) errors.push('The bottom hub and corner band leave no room for the bottom cap pattern. Shrink the hub or the corner band.');
    if (boreB > 0 && boreB > hubB - opts.minWeb) errors.push(`The bottom bore must be at least ${opts.minWeb} mm smaller than the bottom hub.`);
  } else {
    if (sph) { sEndBot = Ro * Math.asin(zBot / Ro); sLo = Math.max(sEndBot + sh.rimBot, Ro * Math.asin(Math.max(-0.999, zBot / R)) + 0.3); }
    else { sEndBot = zBot; sLo = Math.max(zBot + sh.rimBot, zBot * Ro / R + 0.3); }
    sWallLo = sLo;
  }
  if (cap) {
    sHi = sC + rhoC - hubT; sWallHi = sC - sh.rimTop / 2; sCapLo = sC + sh.rimTop / 2;
    if (sHi - sCapLo < 6 * res) errors.push('The cap hub and corner band leave no room for the cap pattern. Shrink the hub or the corner band.');
    if (boreT > 0 && boreT > hubT - opts.minWeb) errors.push(`The top bore must be at least ${opts.minWeb} mm smaller than the top hub.`);
  } else {
    sEndTop = sph ? Ro * Math.asin(zTop / Ro) : zTop;
    sHi = sph ? Math.min(sEndTop - sh.rimTop, Ro * Math.asin(Math.min(0.999, zTop / R)) - 0.3) : Math.min(zTop - sh.rimTop, zTop * Ro / R - 0.3);
    sWallHi = sHi;
  }
  // Separate caps (cylinders): the cap is a flat disc on the tube's end, so the wall pattern stops at least
  // one minimum web short of each joint plane, leaving a solid ring to join to.
  const sepT = !!(opts.capsSeparate && !sph && cap), sepB = !!(opts.capsSeparate && !sph && capB);
  if (sepT) sWallHi = Math.min(sWallHi, zTop - t - Math.max(opts.minWeb, sh.rimTop / 2));
  if (sepB) sWallLo = Math.max(sWallLo, zBot + t + Math.max(opts.minWeb, sh.rimBot / 2));
  // Laser caps on tabs: the disc's flange reaches past the wall and would shade rays leaving the top and
  // bottom of the wall pattern, so the pattern stops where those rays clear the flange.
  if (opts.flange > 0) {
    if (sepT) sWallHi = Math.min(sWallHi, (zTop - t) * Ro / (Ro + opts.flange));
    if (sepB) sWallLo = Math.max(sWallLo, (zBot + t) * Ro / (Ro + opts.flange));
  }
  if (sWallHi - sWallLo < 6 * res) errors.push('Rims leave no room for the wall pattern. Reduce rim height or increase shell height.');
  if ((cap || capB) && sph && opts.fdm) warnings.push('A flat cap on a sphere needs supports on FDM. Print it on SLS, or use a cylinder.');
  if (sh.rimBot < opts.minWeb || sh.rimTop < opts.minWeb) warnings.push(`A rim is narrower than the ${opts.minWeb} mm minimum web.`);

  const G = { sph, R, t, Ro, zBot, zTop, sLo, sHi, cap, sC, rhoC, capB, sCB, rhoCB, boreT, boreB, errors, warnings, psiOfS, pt, rhoAt };
  if (errors.length) { G.ok = false; return G; }

  // Band rows (include s = 0 exactly when the band crosses it, so a seam can sit there).
  let n1, n2, sMid;
  if (sLo < 0 && sHi > 0) { n1 = Math.max(2, Math.ceil(-sLo / res)); n2 = Math.max(2, Math.ceil(sHi / res)); sMid = 0; }
  else { n1 = Math.max(6, Math.ceil((sHi - sLo) / res)); n2 = 0; sMid = sHi; }
  const Nb = n1 + n2 + 1;
  const bandS = new Float64Array(Nb);
  for (let j = 0; j <= n1; j++) bandS[j] = sLo + (sMid - sLo) * j / n1;
  for (let j = 1; j <= n2; j++) bandS[n1 + j] = sMid + (sHi - sMid) * j / n2;
  const Nc = Math.max(24, 2 * Math.ceil(Math.PI * Ro / res));
  const psi = new Float64Array(Nb), rho = new Float64Array(Nb), dsd = new Float64Array(Nb);
  for (let j = 0; j < Nb; j++) {
    psi[j] = psiOfS(bandS[j]); rho[j] = rhoAt(bandS[j]);
    dsd[j] = onCap(bandS[j]) ? zTop / (Math.sin(psi[j]) ** 2) : onCapB(bandS[j]) ? -zBot / (Math.sin(psi[j]) ** 2) : sph ? Ro : Ro / (Math.cos(psi[j]) ** 2);
  }

  // Full profile rows. Open ends blend to flat end planes; bored caps blend to a cylindrical bore.
  const rows = [];
  const b0 = pt(0, sLo), b0o = pt(1, sLo), bL = pt(0, sHi), bLo = pt(1, sHi);
  if (capB) {
    if (boreB > 0) {
      const nb = Math.max(1, Math.ceil((hubB - boreB) / 2));
      for (let k = 0; k < nb; k++) { const f = k / nb; rows.push({ band: -1, ri: boreB + f * (b0[0] - boreB), zi: zBot + t, ro: boreB + f * (b0o[0] - boreB), zo: zBot }); }
    }
  } else {
    const nbR = Math.max(1, Math.ceil((sLo - sEndBot) / 2));
    for (let k = 0; k < nbR; k++) {
      const f = k / nbR, zi = zBot + f * (b0[1] - zBot), zo = zBot + f * (b0o[1] - zBot);
      rows.push({ band: -1, ri: prof(R, zi), zi, ro: prof(Ro, zo), zo });
    }
  }
  const bandRowStart = rows.length;
  for (let j = 0; j < Nb; j++) {
    const a = pt(0, bandS[j]), b = pt(1, bandS[j]);
    rows.push({ band: j, s: bandS[j], ri: a[0], zi: a[1], ro: b[0], zo: b[1] });
  }
  if (cap) {
    if (boreT > 0) {
      const nt = Math.max(1, Math.ceil((hubT - boreT) / 2));
      for (let k = 1; k <= nt; k++) { const f = k / nt; rows.push({ band: -1, ri: bL[0] + f * (boreT - bL[0]), zi: zTop - t, ro: bLo[0] + f * (boreT - bLo[0]), zo: zTop }); }
    }
  } else {
    const ntR = Math.max(1, Math.ceil((sEndTop - sHi) / 2));
    for (let k = 1; k <= ntR; k++) {
      const f = k / ntR, zi = bL[1] + f * (zTop - bL[1]), zo = bLo[1] + f * (zTop - bLo[1]);
      rows.push({ band: -1, ri: prof(R, zi), zi, ro: prof(Ro, zo), zo });
    }
  }

  // Evaluate the pattern field: wall zone, plus a zone for each capped end.
  const zone = (lo, hi, extra) => Object.assign({ sph, Ro, sLo: lo, sHi: hi, bandS, psi, rho, dsd, rhoAt }, extra || {});
  const prep = (p, ctx) => {
    const f = (GENS[p.gen] || GENS.slots).prepare(ctx, p.params);
    const sign = p.invert ? -1 : 1, ph = (p.phase || 0) * DEG;
    return (phi, j) => sign * f(phi - ph, j);
  };
  const fWall = prep(pat, zone(sWallLo, sWallHi));
  let aW = 0, aT = 0, aB = 0;
  for (let j = 0; j < Nb - 1; j++) {
    const a = rho[j] * (bandS[j + 1] - bandS[j]), s = bandS[j];
    if (s >= sWallLo && s < sWallHi) aW += a; else if (s >= sCapLo) aT += a; else if (s <= sCapBHi) aB += a;
  }
  // A cap that follows the wall keeps its dot spacing and row pitch, not raw counts.
  const follow = (cp, area, len) => {
    const g = GENS[cp.gen], p = Object.assign({}, cp.params), def = k => g.params.find(q => q.k === k);
    if (!g.azimuthal) p[g.count] = Math.max(def(g.count).min, Math.round(p[g.count] * area / Math.max(aW, 1)));
    if (cp.gen === 'superformula') p.rows = Math.max(1, Math.round(p.rows * len / Math.max(sWallHi - sWallLo, 1)));
    return Object.assign({}, cp, { params: p });
  };
  let capPat = opts.capPattern, capBPat = opts.capBotPattern;
  if (cap && capPat && opts.capFollow) capPat = follow(capPat, aT, sHi - sCapLo);
  if (capB && capBPat && opts.capBotFollow) capBPat = follow(capBPat, aB, sCapBHi - sLo);
  const fCap = cap && capPat ? prep(capPat, zone(sCapLo, sHi, {
    W: s => (rhoC * rhoC - (rhoC - (s - sC)) ** 2) / 2,
    Wi: w => sC + rhoC - Math.sqrt(Math.max(0, rhoC * rhoC - 2 * w)),
    areaK: TAU,
  })) : null;
  const fCapB = capB && capBPat ? prep(capBPat, zone(sLo, sCapBHi, {
    W: s => (rhoCB - (sCB - s)) ** 2 / 2,
    Wi: w => sCB - rhoCB + Math.sqrt(Math.max(0, 2 * w)),
    areaK: TAU,
  })) : null;
  const field = new Float32Array(Nb * Nc);
  const mir = opts.mirror ? -1 : 1;
  const split = !!(opts.split && !(sepT || sepB) && sMid === 0 && n2 > 0);
  const forced = new Uint8Array(Nb);
  forced[0] = 1; forced[Nb - 1] = 1;
  if (split) for (let j = 0; j < Nb; j++) if (Math.abs(bandS[j]) <= Math.max(opts.seam / 2, 0)) forced[j] = 1;
  if (split) forced[n1] = 1;
  const corner = (lo, hi, sc) => {
    let jc = 0;
    for (let j = 0; j < Nb; j++) {
      if (bandS[j] > lo && bandS[j] < hi) forced[j] = 1;
      if (Math.abs(bandS[j] - sc) < Math.abs(bandS[jc] - sc)) jc = j;
    }
    forced[jc] = 1;
  };
  if (cap) corner(sWallHi, sCapLo, sC);
  if (capB) corner(sCapBHi, sWallLo, sCB);
  for (let j = 0; j < Nb; j++) {
    const o = j * Nc;
    if (forced[j]) { field.fill(FORCE, o, o + Nc); continue; }
    const f = fCap && bandS[j] >= sCapLo ? fCap : fCapB && bandS[j] <= sCapBHi ? fCapB : fWall;
    for (let i = 0; i < Nc; i++) {
      let v = f(mir * (i * TAU / Nc), j);
      if (!(v === v)) v = FORCE;             // NaN guard
      if (Math.abs(v) < 1e-4) v = 1e-4;       // keep crossings off grid vertices
      field[o + i] = v;
    }
  }

  // Connectivity: solid is 8-connected, void 4-connected (matches marching-squares saddles).
  const flags = new Uint8Array(Nb * Nc);
  const solidLab = labelComponents(Nb, Nc, k => field[k] >= 0, true);
  const anchors = new Set();
  for (let j = 0; j < Nb; j++) if (forced[j]) anchors.add(solidLab.lab[j * Nc]);
  const connected = anchors.size === 1;
  let dropped = 0; const droppedLabels = new Set();
  for (let k = 0; k < Nb * Nc; k++) {
    const L = solidLab.lab[k];
    if (L >= 0 && !anchors.has(L)) { field[k] = -FORCE; flags[k] |= 1; droppedLabels.add(L); }
  }
  dropped = droppedLabels.size;
  if (!connected) errors.push(cap ? 'Pattern cuts the shell apart (wall rings or a cap that no longer reaches its hub). Narrow the open fraction or add bridges.' : 'Pattern cuts the shell into separate rings. Narrow the open fraction or add solid bands.');

  let voidLab = labelComponents(Nb, Nc, k => field[k] < 0, false);
  const rw = opts.minWeb / 2, rh = opts.minHole / 2;

  // Undersized holes: void components that never reach the minimum hole width anywhere.
  const hasCore = new Uint8Array(voidLab.count);
  for (let k = 0; k < Nb * Nc; k++) { const L = voidLab.lab[k]; if (L >= 0 && field[k] <= -rh) hasCore[L] = 1; }
  let small = 0; for (let c = 0; c < voidLab.count; c++) if (!hasCore[c]) small++;
  let filled = 0;
  for (let k = 0; k < Nb * Nc; k++) { const L = voidLab.lab[k]; if (L >= 0 && !hasCore[L]) flags[k] |= 4; }
  if (opts.fillSmall && small) { // fill them solid rather than print blobs; recount the real holes
    for (let k = 0; k < Nb * Nc; k++) if (flags[k] & 4) { field[k] = FORCE; flags[k] = (flags[k] & ~4) | 8; }
    filled = small; small = 0;
    voidLab = labelComponents(Nb, Nc, k => field[k] < 0, false);
  }
  const holeRows = voidLab.rowRange; // [minRow, maxRow] per component

  // Thin webs: morphological opening. Erode with the distance-like field,
  // dilate with a chamfer distance; whatever the opening can't reach is narrower than the minimum.
  const dxRow = new Float64Array(Nb), dyRow = new Float64Array(Nb);
  for (let j = 0; j < Nb; j++) { dxRow[j] = rho[j] * TAU / Nc; dyRow[j] = j < Nb - 1 ? bandS[j + 1] - bandS[j] : bandS[j] - bandS[j - 1]; }
  const narrow = (inSet, core, r) => {
    const n = Nb * Nc, d = new Float32Array(n);
    for (let k = 0; k < n; k++) d[k] = core(k) ? 0 : 1e9;
    chamfer(d, Nb, Nc, dxRow, dyRow);
    const out = new Uint8Array(n);
    for (let j = 0; j < Nb; j++) {
      if (forced[j]) continue;
      const slack = 0.75 * Math.sqrt(dxRow[j] * dxRow[j] + dyRow[j] * dyRow[j]);
      for (let i = 0; i < Nc; i++) { const k = j * Nc + i; if (!(flags[k] & 1) && inSet(k) && d[k] > r + slack) out[k] = 1; }
    }
    return out;
  };
  const thinM = narrow(k => field[k] >= 0, k => field[k] >= rw, rw);
  for (let k = 0; k < Nb * Nc; k++) if (thinM[k]) flags[k] |= 2;
  const thinLab = labelComponents(Nb, Nc, k => thinM[k] === 1, true);
  const thinSize = new Int32Array(thinLab.count);
  for (let k = 0; k < Nb * Nc; k++) if (thinLab.lab[k] >= 0) thinSize[thinLab.lab[k]]++;
  let thin = 0; for (let c = 0; c < thinLab.count; c++) if (thinSize[c] >= 4) thin++;

  // Open area fraction of the band (outer face).
  let openA = 0, totA = 0;
  for (let j = 0; j < Nb; j++) {
    const dy = j < Nb - 1 ? bandS[j + 1] - bandS[j] : bandS[j] - bandS[j - 1];
    const a = rho[j] * TAU / Nc * dy;
    for (let i = 0; i < Nc; i++) { totA += a; if (field[j * Nc + i] < 0) openA += a; }
  }

  // 8-bit preview texture (field packed around 0.5).
  const tex = new Uint8Array(Nb * Nc);
  for (let k = 0; k < Nb * Nc; k++) {
    const v = Math.max(-MASK_CLAMP, Math.min(MASK_CLAMP, field[k]));
    tex[k] = Math.max(0, Math.min(255, Math.round(127.5 + v * 127.5 / MASK_CLAMP)));
  }

  // Mesh parts (split spheres at the equator seam).
  const last = rows.length - 1;
  const parts = [];
  const endB = capB && !boreB ? 0 : 1, endT = cap && !boreT ? 0 : 1; // open ends: uncapped, or capped with a bore
  if (sepT || sepB) {
    const onPlane = (s, zc) => Math.abs(pt(0, s)[1] - zc) < 1e-6;
    let jLo = 0, jHi = Nb - 1, jC = -1, jCb = -1;
    if (sepT) {
      jHi = -1; for (let j = 0; j < Nb; j++) if (forced[j] && bandS[j] > sWallHi && bandS[j] <= zTop - t + 1e-9) jHi = j;
      for (let j = Nb - 1; j >= 0; j--) if (forced[j] && bandS[j] > sC && bandS[j] < sCapLo + 1e-9 && onPlane(bandS[j], zTop - t)) jC = j;
      if (jHi < 0 || jC < 0) errors.push('Widen the top corner band to export the cap separately.');
    }
    if (sepB) {
      jLo = -1; for (let j = Nb - 1; j >= 0; j--) if (forced[j] && bandS[j] < sWallLo && bandS[j] >= zBot + t - 1e-9) jLo = j;
      for (let j = 0; j < Nb; j++) if (forced[j] && bandS[j] < sCB && bandS[j] > sCapBHi - 1e-9 && onPlane(bandS[j], zBot + t)) jCb = j;
      if (jLo < 0 || jCb < 0) errors.push('Widen the bottom corner band to export the cap separately.');
    }
    if (!errors.length) {
      const band = (a, b) => rows.slice(bandRowStart + a, bandRowStart + b + 1);
      const pre = rows.slice(0, bandRowStart), post = rows.slice(bandRowStart + Nb);
      const ring = (ri, zi, ro, zo) => ({ band: -1, ri, zi, ro, zo });
      let hW = 0, hT = 0, hB = 0;
      for (let q = 0; q < voidLab.count; q++) {
        const lo = holeRows[2 * q], hi = holeRows[2 * q + 1];
        if (sepT && lo >= jC) hT++; else if (sepB && hi <= jCb) hB++; else hW++;
      }
      const wallRows = [...(sepB ? [ring(R, zBot + t, Ro, zBot + t)] : pre), ...band(jLo, jHi), ...(sepT ? [ring(R, zTop - t, Ro, zTop - t)] : post)];
      parts.push({ suffix: 'wall', rows: wallRows, j0: 0, j1: wallRows.length - 1, holes: hW, ends: 2, fanTop: false, fanBottom: false });
      if (sepT) { const r = [ring(Ro, zTop - t, Ro, zTop), ...band(jC, Nb - 1), ...post]; parts.push({ suffix: 'top-cap', rows: r, j0: 0, j1: r.length - 1, holes: hT, ends: boreT ? 2 : 1, fanTop: !boreT, fanBottom: false }); }
      if (sepB) { const r = [...pre, ...band(0, jCb), ring(Ro, zBot + t, Ro, zBot)]; parts.push({ suffix: 'bottom-cap', rows: r, j0: 0, j1: r.length - 1, holes: hB, ends: boreB ? 2 : 1, fanTop: false, fanBottom: !boreB }); }
    }
  } else if (split) {
    const seamRow = bandRowStart + n1;
    let lo = 0, hi = 0;
    for (let c = 0; c < voidLab.count; c++) { if (holeRows[2 * c + 1] < n1) lo++; else hi++; }
    parts.push({ suffix: 'lower', j0: 0, j1: seamRow, holes: lo, ends: endB + 1 });
    parts.push({ suffix: 'upper', j0: seamRow, j1: last, holes: hi, ends: 1 + endT });
  } else parts.push({ suffix: '', j0: 0, j1: last, holes: voidLab.count, ends: endB + endT });

  Object.assign(G, {
    ok: errors.length === 0, sepT, sepB, sMid, n1, n2, Nb, Nc, sWallLo, sWallHi, sCapLo, sCapBHi, capHub: hubT, capBHub: hubB, bandS, rows, bandRowStart, field, flags, tex, forced, split, parts,
    stats: { holes: voidLab.count, dropped, thin, small, filled, connected, open: openA / totA,
      estTris: estimateTris(rows.length, Nc, openA / totA) },
  });
  return G;
}

function estimateTris(nRows, Nc, open) { return Math.round((nRows - 1) * Nc * 4 * (1 - open) * 1.08); }

// Two-pass chamfer distance (per-row metric, wraps in columns). Run twice for wrap convergence.
function chamfer(d, Nb, Nc, dx, dy) {
  for (let it = 0; it < 2; it++) {
    for (let j = 0; j < Nb; j++) {
      const hx = dx[j], o = j * Nc;
      const vy = j > 0 ? dy[j - 1] : 0, dg = j > 0 ? Math.sqrt(hx * hx + vy * vy) : 0;
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < Nc; i++) {
        const k = o + i, il = (i + Nc - 1) % Nc, ir = (i + 1) % Nc;
        let v = d[k], w = d[o + il] + hx; if (w < v) v = w;
        if (j > 0) { const p = o - Nc; w = d[p + i] + vy; if (w < v) v = w; w = d[p + il] + dg; if (w < v) v = w; w = d[p + ir] + dg; if (w < v) v = w; }
        d[k] = v;
      }
    }
    for (let j = Nb - 1; j >= 0; j--) {
      const hx = dx[j], o = j * Nc;
      const vy = j < Nb - 1 ? dy[j] : 0, dg = j < Nb - 1 ? Math.sqrt(hx * hx + vy * vy) : 0;
      for (let pass = 0; pass < 2; pass++) for (let i = Nc - 1; i >= 0; i--) {
        const k = o + i, il = (i + Nc - 1) % Nc, ir = (i + 1) % Nc;
        let v = d[k], w = d[o + ir] + hx; if (w < v) v = w;
        if (j < Nb - 1) { const p = o + Nc; w = d[p + i] + vy; if (w < v) v = w; w = d[p + il] + dg; if (w < v) v = w; w = d[p + ir] + dg; if (w < v) v = w; }
        d[k] = v;
      }
    }
  }
}

// Connected components on an Nb x Nc grid, wrapping in columns.
function labelComponents(Nb, Nc, pred, eight) {
  const n = Nb * Nc, lab = new Int32Array(n).fill(-1), q = new Int32Array(n);
  let count = 0; const rowRange = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] >= 0 || !pred(s)) continue;
    let h = 0, tl = 0; q[tl++] = s; lab[s] = count;
    let rmin = Infinity, rmax = -Infinity;
    while (h < tl) {
      const k = q[h++], j = (k / Nc) | 0, i = k - j * Nc;
      if (j < rmin) rmin = j; if (j > rmax) rmax = j;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= Nb) continue;
        for (let di = -1; di <= 1; di++) {
          if (!dj && !di) continue;
          if (!eight && dj && di) continue;
          const kk = jj * Nc + (i + di + Nc) % Nc;
          if (lab[kk] < 0 && pred(kk)) { lab[kk] = count; q[tl++] = kk; }
        }
      }
    }
    rowRange.push(rmin, rmax); count++;
  }
  return { lab, count, rowRange };
}

// ---------- Mesh (filled marching squares, walls cut along rays from the source) ----------
function buildMesh(G, part) {
  const { Nc, field } = G, rows = part.rows || G.rows, nR = rows.length, j0 = part.j0, j1 = part.j1;
  const capTop = part.fanTop !== undefined ? part.fanTop : (G.cap && !G.boreT && j1 === nR - 1);
  const capBottom = part.fanBottom !== undefined ? part.fanBottom : (G.capB && !G.boreB && j0 === 0);
  const pos = [], idx = [];
  const gI = new Int32Array(nR * Nc * 2).fill(-1), hI = new Int32Array(nR * Nc * 2).fill(-1), vI = new Int32Array(nR * Nc * 2).fill(-1);
  const dphi = TAU / Nc;
  const val = (i, j) => rows[j].band < 0 ? FORCE : field[rows[j].band * Nc + i];
  const add = (r, z, a) => { pos.push(r * Math.cos(a), r * Math.sin(a), z); return pos.length / 3 - 1; };
  const grid = (i, j, fc) => { const k = (j * Nc + i) * 2 + fc; if (gI[k] < 0) { const w = rows[j]; gI[k] = add(fc ? w.ro : w.ri, fc ? w.zo : w.zi, i * dphi); } return gI[k]; };
  const hx = (i, j, fr, fc) => { const k = (j * Nc + i) * 2 + fc; if (hI[k] < 0) { const w = rows[j]; hI[k] = add(fc ? w.ro : w.ri, fc ? w.zo : w.zi, (i + fr) * dphi); } return hI[k]; };
  const vx = (i, j, fr, fc) => {
    const k = (j * Nc + i) * 2 + fc;
    if (vI[k] < 0) { const s = rows[j].s + fr * (rows[j + 1].s - rows[j].s); const p = G.pt(fc, s); vI[k] = add(p[0], p[1], i * dphi); }
    return vI[k];
  };
  const cl = x => Math.min(0.98, Math.max(0.02, x));
  const tri = (a, b, c) => idx.push(a, b, c);
  const quad = (a, b) => { tri(a[0], b[0], b[1]); tri(a[0], b[1], a[1]); };
  const P = [];
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < Nc; i++) {
      const i1 = (i + 1) % Nc;
      const v0 = val(i, j), v1 = val(i1, j), v2 = val(i1, j + 1), v3 = val(i, j + 1);
      if (v0 < 0 && v1 < 0 && v2 < 0 && v3 < 0) continue;
      P.length = 0;
      if (v0 >= 0) P.push({ c: 0, v: [grid(i, j, 0), grid(i, j, 1)] });
      if ((v0 >= 0) !== (v1 >= 0)) { const fr = cl(v0 / (v0 - v1)); P.push({ x: 1, v: [hx(i, j, fr, 0), hx(i, j, fr, 1)] }); }
      if (v1 >= 0) P.push({ c: 1, v: [grid(i1, j, 0), grid(i1, j, 1)] });
      if ((v1 >= 0) !== (v2 >= 0)) { const fr = cl(v1 / (v1 - v2)); P.push({ x: 1, v: [vx(i1, j, fr, 0), vx(i1, j, fr, 1)] }); }
      if (v2 >= 0) P.push({ c: 2, v: [grid(i1, j + 1, 0), grid(i1, j + 1, 1)] });
      if ((v2 >= 0) !== (v3 >= 0)) { const fr = cl(v3 / (v3 - v2)); P.push({ x: 1, v: [hx(i, j + 1, fr, 0), hx(i, j + 1, fr, 1)] }); }
      if (v3 >= 0) P.push({ c: 3, v: [grid(i, j + 1, 0), grid(i, j + 1, 1)] });
      if ((v3 >= 0) !== (v0 >= 0)) { const fr = cl(v0 / (v0 - v3)); P.push({ x: 1, v: [vx(i, j, fr, 0), vx(i, j, fr, 1)] }); }
      const n = P.length;
      for (let k = 1; k < n - 1; k++) { tri(P[0].v[1], P[k].v[1], P[k + 1].v[1]); tri(P[0].v[0], P[k + 1].v[0], P[k].v[0]); }
      for (let k = 0; k < n; k++) {
        const a = P[k], b = P[(k + 1) % n];
        if (a.x && b.x) quad(a.v, b.v);
        else if (j === j0 && !capBottom && a.c === 0 && b.c === 1) quad(a.v, b.v);
        else if (j + 1 === j1 && !capTop && a.c === 2 && b.c === 3) quad(a.v, b.v);
      }
    }
  }
  if (capBottom) { // bottom hub disc
    const w = rows[j0], cIn = add(0, w.zi, 0), cOut = add(0, w.zo, 0);
    for (let i = 0; i < Nc; i++) {
      const i1 = (i + 1) % Nc;
      tri(cOut, grid(i1, j0, 1), grid(i, j0, 1));
      tri(cIn, grid(i, j0, 0), grid(i1, j0, 0));
    }
  }
  if (capTop) { // hub disc: fan each face to its centre point
    const w = rows[j1], cIn = add(0, w.zi, 0), cOut = add(0, w.zo, 0);
    for (let i = 0; i < Nc; i++) {
      const i1 = (i + 1) % Nc;
      tri(grid(i, j1, 1), grid(i1, j1, 1), cOut);
      tri(grid(i, j1, 0), cIn, grid(i1, j1, 0));
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// Edge-manifold + Euler check. Expected genus = (open ends - 1) + holes: a tube is 1 + holes, a cup is holes.
function checkMesh(m, expectHoles, ends = 2) {
  const V = m.positions.length / 3, F = m.indices.length / 3, ix = m.indices;
  const E = new Map(); let bad = 0;
  for (let t = 0; t < F; t++) {
    for (let e = 0; e < 3; e++) {
      const a = ix[3 * t + e], b = ix[3 * t + (e + 1) % 3];
      const key = a < b ? a * V + b : b * V + a;
      E.set(key, (E.get(key) || 0) + (a < b ? 1 : 1024));
    }
  }
  for (const v of E.values()) if (v !== 1025) bad++;
  const chi = V - E.size + F, genus = (2 - chi) / 2;
  const expectGenus = ends - 1 + expectHoles;
  const ok = bad === 0 && genus === expectGenus;
  return { ok, V, F, E: E.size, badEdges: bad, genus, expectGenus };
}

function stlBinary(m, name) {
  const F = m.indices.length / 3, buf = new ArrayBuffer(84 + 50 * F), dv = new DataView(buf);
  const hdr = ('Tenebrae ' + name).slice(0, 79);
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 127);
  dv.setUint32(80, F, true);
  const p = m.positions, ix = m.indices;
  let o = 84;
  for (let t = 0; t < F; t++) {
    const a = ix[3 * t] * 3, b = ix[3 * t + 1] * 3, c = ix[3 * t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    for (const q of [a, b, c]) { dv.setFloat32(o, p[q], true); dv.setFloat32(o + 4, p[q + 1], true); dv.setFloat32(o + 8, p[q + 2], true); o += 12; }
    o += 2;
  }
  return new Uint8Array(buf);
}

// Minimal store-only ZIP.
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) { // files: [{name, data: Uint8Array}]
  const enc = s => new TextEncoder().encode(s);
  const chunks = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(h.buffer), nm, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + sz;
  }
  let csz = 0; for (const c of central) csz += c.length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csz, true); e.setUint32(16, off, true);
  return [...chunks, ...central, new Uint8Array(e.buffer)];
}

// ---------- Cross-shell checks ----------
function clearanceGap(GA, GB) { // closest gap from A's outer surface to B's inner surface: wall, top cap, bottom cap
  let gap = Infinity;
  if (!GA.ok || !GB.ok) return gap;
  const profB = z => GB.sph ? Math.sqrt(Math.max(0, GB.R * GB.R - z * z)) : GB.R;
  const zcT = GB.cap ? GB.zTop - GB.t : Infinity, zcB = GB.capB ? GB.zBot + GB.t : -Infinity;
  for (const r of GA.rows) {
    if (GB.cap) gap = Math.min(gap, zcT - r.zo);
    if (GB.capB) gap = Math.min(gap, r.zo - zcB);
    if (r.zo < Math.max(GB.zBot, zcB) || r.zo > Math.min(GB.zTop, zcT)) continue;
    gap = Math.min(gap, profB(r.zo) - r.ro);
  }
  return gap;
}
function sourceInside(G, src) {
  if (!G.ok) return true;
  const pts = [];
  const h = src.size / 2;
  if (src.type === 'point') pts.push([0, src.z]);
  if (src.type === 'disc') pts.push([h, src.z]);
  if (src.type === 'line') pts.push([0, src.z - src.length / 2], [0, src.z + src.length / 2]);
  if (src.type === 'sphere') pts.push([h, src.z], [0, src.z + h], [0, src.z - h], [h * 0.7071, src.z + h * 0.7071]);
  for (const [r, z] of pts) {
    if (G.sph ? Math.hypot(r, z) >= G.R - 0.5 : r >= G.R - 0.5) return false;
    if (G.cap && z >= G.zTop - G.t - 0.5) return false;
    if (G.capB && z <= G.zBot + G.t + 0.5) return false;
  }
  return true;
}

// Relative motion readout for azimuthal patterns.
function beatInfo(patA, patB, mirror, rpmA, rpmB) {
  if (patA.gen !== patB.gen || !GENS[patA.gen].azimuthal) return null;
  const key = GENS[patA.gen].count;
  const NA = Math.round(patA.params[key]), NB = (mirror ? -1 : 1) * Math.round(patB.params[key]);
  const d = NA - NB;
  if (d === 0) return { lobes: 0, rate: null };
  return { lobes: Math.abs(d), rate: (NA * rpmA - NB * rpmB) / d, amp: Math.abs(NB / d) };
}

// Twist of the outer shell after which its look repeats (0 = rotationally symmetric, null = no short repeat).
function twistPeriods(patB, capB) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const per = p => {
    if (!p || !GENS[p.gen].azimuthal) return null;
    let n = Math.round(p.params[GENS[p.gen].count]);
    if (p.gen === 'rings') n = gcd(Math.max(0, n), Math.max(0, Math.round(p.params.bridges)));
    return n > 0 ? 360 / n : 0;
  };
  return { wall: per(patB), cap: per(capB) };
}

// ---------- CAD profiles (revolved cross-sections, for native bodies in CAD) ----------
// Each part is a closed (r, z) outline, counter-clockwise, revolved about z. It is the blank shell:
// same faces, caps, bores, joint and seam planes as the printed part, without the pattern.
// Segments: {type:'line', a, b} or {type:'arc', a, m, b, radius} (arcs are centred on the origin).
function shellProfile(G, part) {
  const { sph, R, t, Ro } = G, zBot = G.zBot, zTop = G.zTop;
  const rAt = (Rs, z) => sph ? Math.sqrt(Math.max(0, Rs * Rs - z * z)) : Rs;
  const segs = [], P = (r, z) => [+r.toFixed(6), +z.toFixed(6)];
  const line = (a, b) => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-9) segs.push({ type: 'line', a: P(...a), b: P(...b) }); };
  const face = (Rs, z0, z1) => { // outer or inner face between two heights, in the direction z0 -> z1
    const a = [rAt(Rs, z0), z0], b = [rAt(Rs, z1), z1];
    if (!sph) return line(a, b);
    const ang = (Math.atan2(z0, a[0]) + Math.atan2(z1, b[0])) / 2;
    segs.push({ type: 'arc', a: P(...a), m: P(Rs * Math.cos(ang), Rs * Math.sin(ang)), b: P(...b), radius: Rs });
  };
  const suf = part.suffix || '';
  if (suf === 'top-cap' || suf === 'bottom-cap') { // flat disc, full outer diameter, one wall thick
    const top = suf === 'top-cap', b = top ? G.boreT : G.boreB, z0 = top ? zTop - t : zBot, z1 = z0 + t;
    line([b, z0], [Ro, z0]); line([Ro, z0], [Ro, z1]); line([Ro, z1], [b, z1]); line([b, z1], [b, z0]);
    return segs;
  }
  // End types for a tube or cup: {cap:true, zo, zi, bore} or {cap:false, z} (open end, seam or joint plane).
  let lo = G.capB ? { cap: true, zo: zBot, zi: zBot + t, bore: G.boreB } : { cap: false, z: zBot };
  let hi = G.cap ? { cap: true, zo: zTop, zi: zTop - t, bore: G.boreT } : { cap: false, z: zTop };
  if (suf === 'wall') { if (G.sepB) lo = { cap: false, z: zBot + t }; if (G.sepT) hi = { cap: false, z: zTop - t }; }
  if (suf === 'lower') hi = { cap: false, z: 0 };
  if (suf === 'upper') lo = { cap: false, z: 0 };
  const zoLo = lo.cap ? lo.zo : lo.z, zoHi = hi.cap ? hi.zo : hi.z, ziLo = lo.cap ? lo.zi : lo.z, ziHi = hi.cap ? hi.zi : hi.z;
  // bottom: along the outer plane (cap) or across the end ring (open), then up the outer face
  if (lo.cap) line([lo.bore, zoLo], [rAt(Ro, zoLo), zoLo]); else line([rAt(R, zoLo), zoLo], [rAt(Ro, zoLo), zoLo]);
  face(Ro, zoLo, zoHi);
  // top: in along the outer plane, down the bore (or the axis), out along the inner plane; or across the end ring
  if (hi.cap) { line([rAt(Ro, zoHi), zoHi], [hi.bore, zoHi]); line([hi.bore, zoHi], [hi.bore, ziHi]); line([hi.bore, ziHi], [rAt(R, ziHi), ziHi]); }
  else line([rAt(Ro, zoHi), zoHi], [rAt(R, zoHi), zoHi]);
  face(R, ziHi, ziLo);
  if (lo.cap) { line([rAt(R, ziLo), ziLo], [lo.bore, ziLo]); line([lo.bore, ziLo], [lo.bore, zoLo]); }
  return segs;
}
// Volume of the solid swept by revolving a closed (r, z) outline about z: V = pi * |closed integral of r^2 dz|.
function profileVolume(segs) {
  let I = 0;
  for (const s of segs) {
    if (s.type === 'line') { const [r1, z1] = s.a, [r2, z2] = s.b; I += (z2 - z1) * (r1 * r1 + r1 * r2 + r2 * r2) / 3; }
    else { const F = th => Math.sin(th) - Math.sin(th) ** 3 / 3, th0 = Math.atan2(s.a[1], s.a[0]), th1 = Math.atan2(s.b[1], s.b[0]); I += s.radius ** 3 * (F(th1) - F(th0)); }
  }
  return Math.PI * Math.abs(I);
}
// Every segment must start where the previous one ended, and the last must end where the first starts.
function profileClosed(segs) {
  for (let i = 0; i < segs.length; i++) { const a = segs[i].b, b = segs[(i + 1) % segs.length].a; if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) return false; }
  return segs.length >= 3;
}

// ---------- Flat cutting (laser, CNC, paper): opened-up cylinder walls and cap discs ----------
// Closed contours of the field at level `lev` (mm, hole side is field < lev), from the same marching-squares
// walk as the mesher (solid side on the left, saddles solid-connected). Points are grid coordinates [i, j],
// with i unwrapped across the seam so a loop that crosses it stays continuous.
function fieldContours(G, lev) {
  const { Nb, Nc, field } = G, val = (i, j) => field[j * Nc + i] - lev;
  const next = new Map(), pts = new Map();
  const pt = (id, x, y) => { if (!pts.has(id)) pts.set(id, [x, y]); return id; };
  for (let j = 0; j < Nb - 1; j++) for (let i = 0; i < Nc; i++) {
    const i1 = (i + 1) % Nc, v0 = val(i, j), v1 = val(i1, j), v2 = val(i1, j + 1), v3 = val(i, j + 1);
    const s0 = v0 >= 0, s1 = v1 >= 0, s2 = v2 >= 0, s3 = v3 >= 0;
    if (s0 === s1 && s1 === s2 && s2 === s3) continue;
    const P = [];
    if (s0) P.push(null);
    if (s0 !== s1) P.push(pt(2 * (j * Nc + i), i + v0 / (v0 - v1), j));
    if (s1) P.push(null);
    if (s1 !== s2) P.push(pt(2 * (j * Nc + i1) + 1, i + 1, j + v1 / (v1 - v2)));
    if (s2) P.push(null);
    if (s2 !== s3) P.push(pt(2 * ((j + 1) * Nc + i), i + v3 / (v3 - v2), j + 1));
    if (s3) P.push(null);
    if (s3 !== s0) P.push(pt(2 * (j * Nc + i) + 1, i, j + v0 / (v0 - v3)));
    for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; if (a !== null && b !== null) next.set(a, b); }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const raw = []; let id = start;
    while (id !== undefined && !seen.has(id)) { seen.add(id); raw.push(pts.get(id)); id = next.get(id); }
    if (id !== start || raw.length < 3) continue;
    const out = [raw[0].slice()];
    for (let k = 1; k < raw.length; k++) { let x = raw[k][0]; const px = out[k - 1][0]; while (x - px > Nc / 2) x -= Nc; while (x - px < -Nc / 2) x += Nc; out.push([x, raw[k][1]]); }
    loops.push(out);
  }
  return loops;
}
const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const polyLen = P => { let l = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; l += Math.hypot(q[0] - p[0], q[1] - p[1]); } return l; };
// Sutherland-Hodgman clip of a polygon to an axis-aligned rectangle.
function clipRect(P, x0, y0, x1, y1) {
  const sides = [[p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
                 [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
                 [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
                 [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let out = P;
  for (const [inside, cut] of sides) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return out;
  }
  return out;
}
// Ramer-Douglas-Peucker on a closed loop (keeps cut files small without moving any edge by more than tol).
function simplifyLoop(P, tol) {
  if (P.length < 8) return P;
  let far = 0, fd = -1;
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(P.length); keep[0] = keep[far] = 1;
  const rdp = (a, b) => { // indices a < b, chain P[a..b]
    let idx = -1, dmax = tol;
    const [ax, ay] = P[a], [bx, by] = P[b % P.length], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L; if (d > dmax) { dmax = d; idx = i; } }
    if (idx >= 0) { keep[idx] = 1; rdp(a, idx); rdp(idx, b); }
  };
  rdp(0, far); rdp(far, P.length);
  return P.filter((_, i) => keep[i]);
}
// Flat parts for one cylinder shell, in millimetres, each drawn as seen from outside the lamp.
// wall: the wall opened at phi = 0 into a rectangle, mapped at mid-thickness (x = arc length, y = height
// above the bottom end). strip: optional backing strip glued inside the seam; it sits one sheet further in,
// so its holes are mapped at that smaller radius and line up with the wall's along every ray.
// top-cap / bottom-cap: discs that fit inside the tube ends, holes mapped at the disc's mid-plane.
// Holes are traced at field = -kerf/2 and outlines grown by kerf/2, so parts come out at true size.
function flatParts(G, o) {
  if (G.sph) return { error: "Spheres can't be opened flat; use a cylinder for laser cutting." };
  const kerf = Math.max(0, o.kerf || 0), k = kerf / 2, tol = o.tol || 0.02;
  const { R, t, zBot, zTop, Nc, Nb, bandS } = G, Rm = R + t / 2, H = zTop - zBot, L = TAU * Rm;
  const sAt = y => { const j = Math.min(Nb - 2, Math.max(0, Math.floor(y))), f = y - j; return bandS[j] + f * (bandS[j + 1] - bandS[j]); };
  const loops = fieldContours(G, -k).map(L0 => L0.map(([x, y]) => [x * TAU / Nc, sAt(y)]));
  const zoneOf = P => { let s = 0; for (const p of P) s += p[1]; s /= P.length; return s >= G.sCapLo ? 'top' : s <= G.sCapBHi ? 'bottom' : 'wall'; };
  const wall = loops.filter(P => zoneOf(P) === 'wall');
  const tanPsi = s => Math.tan(G.psiOfS(s));
  const sheet = (Rr, z0, w, h, xShift) => {
    const holes = [];
    for (const P of wall) for (const off of [-TAU, 0, TAU]) {
      const Q = P.map(([phi, s]) => [Rr * (phi + off) + xShift, Rr * tanPsi(s) - z0]);
      let mn = Infinity, mx = -Infinity; for (const q of Q) { if (q[0] < mn) mn = q[0]; if (q[0] > mx) mx = q[0]; }
      if (mx < -k || mn > w + k) continue;
      const C = clipRect(Q, -k, -k, w + k, h + k);
      if (C.length >= 3 && Math.abs(polyArea(C)) > 1e-4) holes.push(simplifyLoop(C, tol));
    }
    return holes;
  };
  const parts = [], tabs = o.joint === 'tabs';
  const rect = (w, h) => ({ type: 'rect', x0: -k, y0: -k, x1: w + k, y1: h + k });
  // Press-fit caps sit inside a full-height tube. Tabbed caps sit on the tube ends, so the tube runs between
  // the two joint planes and carries tabs that push through slots in the caps; whatever comes through folds flat.
  const zLo = zBot + (tabs && G.capB ? t : 0), zHi = zTop - (tabs && G.cap ? t : 0), Hb = zHi - zLo;
  const nTab = Math.max(2, Math.round(o.tabs || 8)), tabW = Math.max(2, o.tabW || 10), tabH = t + Math.max(0, o.tabExtra == null ? 3 : o.tabExtra), fit = Math.max(0, o.fit == null ? 0.1 : o.fit), flange = Math.max(1, o.flange || 4);
  const tabPhi = i => (i + 0.5) * TAU / nTab; // half a spacing away from the seam
  let outline = rect(L, Hb);
  if (tabs && (G.cap || G.capB)) {
    const P = [[0, 0]];
    if (G.capB) for (let i = 0; i < nTab; i++) { const x = Rm * tabPhi(i); P.push([x - tabW / 2, 0], [x - tabW / 2, -tabH], [x + tabW / 2, -tabH], [x + tabW / 2, 0]); }
    P.push([L, 0], [L, Hb]);
    if (G.cap) for (let i = nTab - 1; i >= 0; i--) { const x = Rm * tabPhi(i); P.push([x + tabW / 2, Hb], [x + tabW / 2, Hb + tabH], [x - tabW / 2, Hb + tabH], [x - tabW / 2, Hb]); }
    P.push([0, Hb]);
    outline = { type: 'poly', points: growOrtho(P, k) };
  }
  parts.push({ name: 'wall', kind: 'sheet', w: L, h: Hb, outline, holes: sheet(Rm, zLo, L, Hb, 0), tabs: tabs ? { count: nTab, width: tabW, height: tabH, phi: Array.from({ length: nTab }, (_, i) => tabPhi(i)) } : null,
    note: `Opened at the seam (phi = 0). Rolls into a tube of ${(2 * R).toFixed(2)} mm inside diameter, ${Hb.toFixed(2)} mm tall` + (tabs && (G.cap || G.capB) ? `, with ${nTab} tabs ${tabW} mm wide on each capped end: push them through the cap slots, then fold the ${(tabH - t).toFixed(1)} mm that comes through flat over the cap` : '') + ', seen from outside.' });
  if (o.strip) {
    const Rs = Rm - t, sLo = zBot + (G.capB ? t : 0), sHi = zTop - (G.cap ? t : 0), w = Math.max(2, o.stripW || 10);
    parts.push({ name: 'seam-strip', kind: 'sheet', w, h: sHi - sLo, outline: rect(w, sHi - sLo), holes: sheet(Rs, sLo, w, sHi - sLo, w / 2),
      note: `Glue inside the seam, centred on it, from ${sLo.toFixed(2)} to ${sHi.toFixed(2)} mm. Its holes line up with the wall's.` });
  }
  for (const [end, on, zc, bore, flipY] of [['top', G.cap, zTop - t / 2, G.boreT, 1], ['bottom', G.capB, zBot + t / 2, G.boreB, -1]]) {
    if (!on) continue;
    const holes = loops.filter(P => zoneOf(P) === end).map(P => simplifyLoop(P.map(([phi, s]) => { const r = zc / tanPsi(s); return [r * Math.cos(phi), flipY * r * Math.sin(phi)]; }), tol));
    const circles = [];
    let rOut, note;
    if (tabs) {
      rOut = R + t + flange;
      // arc slots at the wall's radius: sheet thickness plus clearance across, tab width plus clearance along
      const r1 = Rm - t / 2 - fit + k, r2 = Rm + t / 2 + fit - k, a = (tabW / 2 + fit - k) / Rm, n = 16;
      for (let i = 0; i < nTab; i++) {
        const cph = tabPhi(i), S = [];
        for (let q = 0; q <= n; q++) { const ph = cph - a + 2 * a * q / n; S.push([r2 * Math.cos(ph), flipY * r2 * Math.sin(ph)]); }
        for (let q = n; q >= 0; q--) { const ph = cph - a + 2 * a * q / n; S.push([r1 * Math.cos(ph), flipY * r1 * Math.sin(ph)]); }
        holes.push(S);
      }
      note = `Disc ${(2 * rOut).toFixed(2)} mm across with ${nTab} slots for the wall's tabs, ${flange} mm flange past the wall, sits on the tube's ${end} end, seen from ${end === 'top' ? 'above' : 'below'}.`;
    } else {
      rOut = R;
      note = `Disc ${(2 * R).toFixed(2)} mm across, fits inside the tube's ${end} end, seen from ${end === 'top' ? 'above' : 'below'}.`;
    }
    circles.push({ cx: 0, cy: 0, r: rOut + k, layer: 'outline' });
    if (bore > 0) circles.push({ cx: 0, cy: 0, r: Math.max(0.1, bore - k), layer: 'holes' });
    parts.push({ name: `${end}-cap`, kind: 'disc', w: 2 * rOut, h: 2 * rOut, circles, holes, slots: tabs ? nTab : 0, note });
  }
  for (const p of parts) {
    let cut = p.holes.reduce((n, P) => n + polyLen(P), 0), open = p.holes.reduce((n, P) => n + Math.abs(polyArea(P)), 0);
    if (p.outline) cut += p.outline.type === 'poly' ? polyLen(p.outline.points) : 2 * (p.outline.x1 - p.outline.x0 + p.outline.y1 - p.outline.y0);
    for (const c of p.circles || []) { cut += TAU * c.r; if (c.layer === 'holes') open += Math.PI * c.r * c.r; }
    p.cutLength = cut; p.openArea = open;
  }
  return { parts, kerf, thickness: t, midRadius: Rm };
}
const fmt = v => (Math.round(v * 1000) / 1000).toString();
// Grow a counter-clockwise rectilinear polygon outwards by d (every corner is a right angle).
function growOrtho(P, d) {
  if (!d) return P;
  const n = P.length, N = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  return P.map((v, i) => { const n1 = N(P[(i + n - 1) % n], v), n2 = N(v, P[(i + 1) % n]); return [v[0] + d * (n1[0] + n2[0]), v[1] + d * (n1[1] + n2[1])]; });
}
function partBounds(p) {
  if (p.outline && p.outline.type === 'poly') { const xs = p.outline.points.map(q => q[0]), ys = p.outline.points.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  if (p.outline) return [p.outline.x0, p.outline.y0, p.outline.x1, p.outline.y1];
  const r = Math.max(...p.circles.map(c => c.r)); return [-r, -r, r, r];
}
// SVG in millimetres. Red = holes (cut first), blue = outline (cut last); hairline strokes, no fill.
function svgOf(p, meta) {
  const [x0, y0, x1, y1] = partBounds(p), pad = 2, X = x => fmt(x - x0 + pad), Y = y => fmt(y1 - y + pad);
  const W = x1 - x0 + 2 * pad, Hh = y1 - y0 + 2 * pad, path = P => 'M' + P.map(q => X(q[0]) + ' ' + Y(q[1])).join('L') + 'Z';
  const holes = p.holes.map(P => `<path d="${path(P)}"/>`).concat((p.circles || []).filter(c => c.layer === 'holes').map(c => `<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${fmt(c.r)}"/>`));
  const outer = p.outline && p.outline.type === 'poly' ? [`<path d="${path(p.outline.points)}"/>`] : p.outline ? [`<rect x="${X(p.outline.x0)}" y="${Y(p.outline.y1)}" width="${fmt(p.outline.x1 - p.outline.x0)}" height="${fmt(p.outline.y1 - p.outline.y0)}"/>`]
    : p.circles.filter(c => c.layer === 'outline').map(c => `<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${fmt(c.r)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(Hh)}mm" viewBox="0 0 ${fmt(W)} ${fmt(Hh)}">\n` +
    `<title>${meta.title}</title>\n<desc>${meta.desc}</desc>\n` +
    `<g id="cut-holes" fill="none" stroke="#e00000" stroke-width="0.05">\n${holes.join('\n')}\n</g>\n` +
    `<g id="cut-outline" fill="none" stroke="#0000e0" stroke-width="0.05">\n${outer.join('\n')}\n</g>\n</svg>\n`;
}
// DXF R12, millimetres. Layer CUT_HOLES (red) and CUT_OUTLINE (blue); closed POLYLINEs and CIRCLEs.
function dxfOf(p) {
  const o = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const poly = (P, layer, col) => { o.push('0', 'POLYLINE', '8', layer, '62', col, '66', '1', '70', '1', '10', '0', '20', '0', '30', '0'); for (const q of P) o.push('0', 'VERTEX', '8', layer, '10', fmt(q[0]), '20', fmt(q[1]), '30', '0'); o.push('0', 'SEQEND', '8', layer); };
  const circ = (c, layer, col) => o.push('0', 'CIRCLE', '8', layer, '62', col, '10', fmt(c.cx), '20', fmt(c.cy), '30', '0', '40', fmt(c.r));
  for (const P of p.holes) poly(P, 'CUT_HOLES', '1');
  for (const c of p.circles || []) circ(c, c.layer === 'holes' ? 'CUT_HOLES' : 'CUT_OUTLINE', c.layer === 'holes' ? '1' : '5');
  if (p.outline && p.outline.type === 'poly') poly(p.outline.points, 'CUT_OUTLINE', '5');
  else if (p.outline) { const b = p.outline; poly([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], 'CUT_OUTLINE', '5'); }
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}

if (typeof module !== 'undefined') module.exports = { fieldContours, flatParts, svgOf, dxfOf, polyArea, clipRect, simplifyLoop, shellProfile, profileVolume, profileClosed, twistPeriods, GENS, genDefaults, buildShell, buildMesh, checkMesh, stlBinary, zipStore, crc32, clearanceGap, sourceInside, beatInfo, labelComponents, FORCE, TAU, DEG };
