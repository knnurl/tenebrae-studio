// Geometry test harness. Usage: node tools/test.js
// Builds a node bundle of src/core.js + src/state.js and checks every preset's meshes.
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), strip = f => fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/\nif \(typeof module[\s\S]*$/, '\n');
const bundlePath = path.join(os.tmpdir(), 'tenebrae-bundle.js');
fs.writeFileSync(bundlePath, strip('core.js') + strip('state.js') + 'module.exports={GENS,buildShell,buildMesh,checkMesh,stlBinary,zipStore,crc32,clearanceGap,sourceInside,beatInfo,twistPeriods,PRESETS,effectivePatterns,effectiveCaps,capFollows,loadDesign,defaultState,helixState,fitOuter,fibPoints,wrapPi,TAU};');
const X = require(bundlePath);
let fails = 0;
const check = (name, cond, info='') => { console.log((cond?'PASS ':'FAIL ')+name+(info?'  '+info:'')); if(!cond) fails++; };
const zlib = require('zlib');
for (const pr of X.PRESETS) {
  const st = pr.make(); const pats = X.effectivePatterns(st); const caps = X.effectiveCaps(st);
  for (let k=0;k<2;k++) for (const split of [false, true]) {
    const t0=Date.now();
    const G = X.buildShell(st.shells[k], pats[k], {res: st.res, fillSmall: st.process.fillSmall, minWeb:2, minHole:3, split, seam:4, mirror: k===1 && st.link.mirror, capPattern: caps[k], capFollow: X.capFollows(st, k)});
    const tb=Date.now()-t0;
    if (!G.ok) { check(`${pr.name} shell${k} build`, false, G.errors.join('; ')); continue; }
    for (const part of G.parts) {
      const t1=Date.now(); const m = X.buildMesh(G, part); const tm=Date.now()-t1;
      const c = X.checkMesh(m, part.holes, part.ends);
      check(`${pr.name} shell${k} split=${split} ${part.suffix||'whole'}${G.cap?' capped':''}`, c.ok, `holes=${part.holes} genus=${c.genus} exp=${c.expectGenus} bad=${c.badEdges} F=${c.F} build=${tb}ms mesh=${tm}ms est=${G.stats.estTris} thin=${G.stats.thin} small=${G.stats.small} filled=${G.stats.filled} drop=${G.stats.dropped} open=${(G.stats.open*100).toFixed(1)}%`);
    }
  }
}
// Orientation: signed volume must be positive and match analytic solid volume for an unperforated cylinder
{
  const st = X.helixState(); const sh = st.shells[0];
  const pat = {gen:'slots', invert:false, phase:0, params:{N:3,twist:0,wobA:0,wobK:0,duty:0.0001}};
  const G = X.buildShell(sh, pat, {res:0.7,minWeb:2,minHole:3,split:false,seam:4});
  const m = X.buildMesh(G, G.parts[0]); const p=m.positions, ix=m.indices; let vol=0;
  for (let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3; vol += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
  const exact = Math.PI*((sh.R+sh.t)**2 - sh.R**2)*(sh.zTop-sh.zBot);
  check('signed volume positive & ~analytic', vol>0 && Math.abs(vol-exact)/exact < 0.01, `vol=${vol.toFixed(0)} exact=${exact.toFixed(0)} holes=${G.stats.holes}`);
}
// Ray alignment: every hole wall vertex pair lies on a ray from origin -> check a vertical-edge crossing inner/outer share direction
{
  const st = X.helixState(); const pats = X.effectivePatterns(st);
  const G = X.buildShell(st.shells[0], pats[0], {res:0.7,minWeb:2,minHole:3,split:false,seam:4});
  let maxErr = 0;
  for (let j=0;j<G.Nb;j++){ const s=G.bandS[j]; const a=G.pt(0,s), b=G.pt(1,s); const e = Math.abs(Math.atan2(a[1],a[0]) - Math.atan2(b[1],b[0])); maxErr=Math.max(maxErr,e); }
  check('band rows ray-aligned (inner/outer same elevation)', maxErr < 1e-9, `maxErr=${maxErr}`);
}
// STL + ZIP integrity
{
  const st = X.helixState(); const pats = X.effectivePatterns(st);
  const G = X.buildShell(st.shells[0], pats[0], {res:1.2,minWeb:2,minHole:3,split:false,seam:4});
  const m = X.buildMesh(G, G.parts[0]); const stl = X.stlBinary(m,'t');
  check('STL size', stl.length === 84 + 50*m.indices.length/3);
  const chunks = X.zipStore([{name:'a.stl', data: stl},{name:'b.json', data: new TextEncoder().encode('{"x":1}')}]);
  const buf = Buffer.concat(chunks.map(c=>Buffer.from(c))); fs.writeFileSync(path.join(os.tmpdir(), 'tenebrae-test.zip'), buf);
  check('zip central directory present', buf.includes(Buffer.from([0x50,0x4b,0x05,0x06])));
}
// Beat readout
{
  const b = X.beatInfo({gen:'slots',params:{N:60}},{gen:'slots',params:{N:63}},false,0,1);
  check('beat lobes=3, rate=-21 rpm', b.lobes===3 && Math.abs(b.rate-21)<1e-9 || Math.abs(b.rate+21)<1e-9, JSON.stringify(b));
}
// Connectivity error: a full circumferential ring slot must be rejected
{
  const st = X.helixState();
  const G = X.buildShell(st.shells[0], {gen:'rings',invert:false,phase:0,params:{pitch:6,K:0,amp:0,duty:0.4}}, {res:0.7,minWeb:2,minHole:3,split:false,seam:4});
  check('ring slots flagged as disconnecting', !G.stats.connected && !G.ok, G.errors.join(';'));
}

// Capped geometry: unperforated capped cylinder volume, capped sphere split, cap-row ray alignment
{
  const sv = (m) => { const p=m.positions, ix=m.indices; let v=0; for (let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3; v += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;} return v; };
  const st = X.PRESETS.find(p=>/5 mm cap gap/.test(p.name)).make(); const sh = JSON.parse(JSON.stringify(st.shells[0]));
  const blank = {gen:'slots', invert:false, phase:0, params:{N:3,twist:0,wobA:0,wobK:0,duty:0.0001}};
  const G = X.buildShell(sh, blank, {res:0.5,minWeb:2,minHole:3,split:false,seam:4, capPattern: blank});
  const m = X.buildMesh(G, G.parts[0]); const c = X.checkMesh(m, G.parts[0].holes, G.parts[0].ends); const vol = sv(m);
  const Ro = sh.R+sh.t, exact = Math.PI*(Ro*Ro - sh.R*sh.R)*(sh.zTop-sh.zBot) + Math.PI*sh.R*sh.R*sh.t;
  check('capped blank cylinder: watertight cup, volume ~analytic', c.ok && Math.abs(vol-exact)/exact < 0.01, `holes=${G.parts[0].holes} genus=${c.genus} exp=${c.expectGenus} vol=${vol.toFixed(0)} exact=${exact.toFixed(0)} err=${((vol-exact)/exact*100).toFixed(3)}%`);
  let maxErr = 0;
  for (let j=0;j<G.Nb;j++){ const s=G.bandS[j]; const a=G.pt(0,s), b=G.pt(1,s); maxErr=Math.max(maxErr, Math.abs(Math.atan2(a[1],a[0]) - Math.atan2(b[1],b[0]))); }
  check('cap rows ray-aligned', maxErr < 1e-9, `maxErr=${maxErr}`);
  const top = G.rows[G.rows.length-1];
  check('cap top planes flat at zTop / zTop-t', Math.abs(top.zo - sh.zTop) < 1e-9 && Math.abs(top.zi - (sh.zTop - sh.t)) < 1e-9, `zo=${top.zo} zi=${top.zi} hubR=${top.ro.toFixed(2)}`);
  // capped sphere, split
  const sp = { shape:'sphere', R:60, t:3.5, zBot:-48, zTop:50, rimBot:6, rimTop:6, cap:{on:true, hub:10} };
  const pat = {gen:'phyllo', invert:false, phase:0, params:{N:300,size:0.55,grad:0}};
  const capP = {gen:'rings', invert:false, phase:0, params:{pitch:4,K:6,amp:1,duty:0.4,bridges:10,bridgeW:3}};
  const GS = X.buildShell(sp, pat, {res:0.7,minWeb:2,minHole:3,split:true,seam:4, capPattern: capP, fdm:true});
  for (const part of GS.parts) { const mm = X.buildMesh(GS, part); const cc = X.checkMesh(mm, part.holes, part.ends); check(`capped sphere split ${part.suffix}`, cc.ok, `holes=${part.holes} ends=${part.ends} genus=${cc.genus} exp=${cc.expectGenus} bad=${cc.badEdges}`); }
  check('capped sphere on FDM warns about supports', GS.warnings.some(w=>/supports/.test(w)), GS.warnings.join(' | '));
  // clearance: outer cap must clear inner cap axially
  const caps = X.effectiveCaps(st), pats = X.effectivePatterns(st);
  const GA = X.buildShell(st.shells[0], pats[0], {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:caps[0],capFollow:true});
  const GB = X.buildShell(st.shells[1], pats[1], {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:caps[1]});
  const gap = X.clearanceGap(GA, GB);
  check('uplight clearance = min(radial 9, axial 5)', Math.abs(gap - 5) < 0.01, `gap=${gap.toFixed(3)}`);
  const lowB = JSON.parse(JSON.stringify(st.shells[1])); lowB.zTop = 111;
  const GB2 = X.buildShell(lowB, pats[1], {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:caps[1]});
  check('cap collision detected', X.clearanceGap(GA, GB2) < 0, `gap=${X.clearanceGap(GA, GB2).toFixed(2)}`);
  check('emitter above inner cap rejected', !X.sourceInside(GA, {type:'point', size:1, length:1, z:109}) && X.sourceInside(GA, st.source));
  const tp = X.twistPeriods(pats[1], caps[1]);
  check('follow: one twist period for wall and cap (360/39)', Math.abs(tp.wall-360/39)<1e-9 && tp.cap === tp.wall, JSON.stringify(tp));
  check('follow: uplight clean at hub 24 (no thin webs / small holes)', GA.stats.thin === 0 && GA.stats.small === 0 && GB.stats.thin === 0 && GB.stats.small === 0, `A thin=${GA.stats.thin} small=${GA.stats.small} B thin=${GB.stats.thin} small=${GB.stats.small}`);
  // follow with dots keeps spacing: cap dot count scales with area
  const dsh = JSON.parse(JSON.stringify(st.shells[0])); const dots = {gen:'phyllo',invert:false,phase:0,params:{N:300,size:0.55,grad:0}};
  const GD = X.buildShell(dsh, dots, {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:dots,capFollow:true});
  const GD0 = X.buildShell(dsh, dots, {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:dots,capFollow:false});
  check('follow: dots scaled to cap area (fewer cap holes than raw N)', GD.stats.holes < GD0.stats.holes && GD.stats.holes > 300, `scaled=${GD.stats.holes} raw=${GD0.stats.holes}`);
  // old caps (saved before follow existed) keep their own pattern
  const oldRaw = JSON.parse(JSON.stringify(st)); oldRaw.shells.forEach(s => delete s.cap.follow);
  const L = X.loadDesign(oldRaw);
  check('loadDesign keeps pre-follow caps independent', L.shells[0].cap.follow === false && X.loadDesign(JSON.parse(JSON.stringify(st))).shells[0].cap.follow === true);
}
// Auto-fit: default design derives the outer shell; gaps as stated
{
  const st = X.defaultState(); const pats = X.effectivePatterns(st), caps = X.effectiveCaps(st);
  const o = k => ({res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:caps[k],capFollow:X.capFollows(st,k)});
  const GA = X.buildShell(st.shells[0], pats[0], o(0)), GB = X.buildShell(st.shells[1], pats[1], o(1));
  const radial = st.shells[1].R - (st.shells[0].R + st.shells[0].t), axial = (st.shells[1].zTop - st.shells[1].t) - st.shells[0].zTop;
  check('auto-fit: radial and axial gap both equal the set gap', Math.abs(radial - st.fit.gap) < 1e-9 && Math.abs(axial - st.fit.gap) < 1e-9 && Math.abs(X.clearanceGap(GA, GB) - st.fit.gap) < 1e-6, `radial=${radial} axial=${axial} gap=${X.clearanceGap(GA,GB)}`);
  check('auto-fit: default design builds clean', GA.ok && GB.ok && GA.stats.thin + GA.stats.small + GB.stats.thin + GB.stats.small === 0, `A ${GA.stats.holes} holes, B ${GB.stats.holes} holes`);
  const sp = X.defaultState(); sp.shells[0].shape = 'sphere'; sp.shells[0].R = 60; sp.shells[0].zBot = -40; sp.shells[0].zTop = 50; sp.shells[0].cap.on = false; X.fitOuter(sp);
  const GS = [0,1].map(k => X.buildShell(sp.shells[k], X.effectivePatterns(sp)[k], {res:0.7,minWeb:2,minHole:3,split:true,seam:4}));
  check('auto-fit sphere: builds, gap as set', GS[0].ok && GS[1].ok && Math.abs(X.clearanceGap(GS[0], GS[1]) - sp.fit.gap) < 0.5, `gap=${X.clearanceGap(GS[0], GS[1]).toFixed(2)}`);
  const old = JSON.parse(JSON.stringify(X.helixState())); delete old.fit; delete old.plan; delete old.lamp; old.shells[1].R = 71.25;
  const L = X.loadDesign(old);
  check('old design loads with auto-fit off and outer shell untouched', L.fit.auto === false && L.shells[1].R === 71.25);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
