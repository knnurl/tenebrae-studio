// Geometry test harness. Usage: node tools/test.js
// Builds a node bundle of src/core.js + src/state.js and checks every preset's meshes.
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), strip = f => fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/\nif \(typeof module[\s\S]*$/, '\n');
const bundlePath = path.join(os.tmpdir(), 'tenebrae-bundle.js');
fs.writeFileSync(bundlePath, strip('core.js') + strip('state.js') + 'module.exports={fieldContours,flatParts,printedCap,svgOf,dxfOf,polyArea,shellProfile,profileVolume,profileClosed,effectiveCapsBot,capFollowsBot,mkCap,tableUplightState,GENS,buildShell,buildMesh,checkMesh,stlBinary,zipStore,crc32,clearanceGap,sourceInside,beatInfo,twistPeriods,PRESETS,effectivePatterns,effectiveCaps,capFollows,loadDesign,defaultState,helixState,fitOuter,fibPoints,wrapPi,TAU,DEG};');
const X = require(bundlePath);
let fails = 0;
const check = (name, cond, info='') => { console.log((cond?'PASS ':'FAIL ')+name+(info?'  '+info:'')); if(!cond) fails++; };
const zlib = require('zlib');
for (const pr of X.PRESETS) {
  const st = pr.make(); const pats = X.effectivePatterns(st); const caps = X.effectiveCaps(st); const capsB = X.effectiveCapsBot(st);
  for (let k=0;k<2;k++) for (const split of [false, true]) {
    const t0=Date.now();
    const G = X.buildShell(st.shells[k], pats[k], {res: st.res, fillSmall: st.process.fillSmall, minWeb:2, minHole:3, split, seam:4, mirror: k===1 && st.link.mirror, capPattern: caps[k], capFollow: X.capFollows(st, k), capBotPattern: capsB[k], capBotFollow: X.capFollowsBot(st, k)});
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
// Auto-fit: the table uplight derives the outer shell; gaps as stated
{
  const st = X.tableUplightState(); const pats = X.effectivePatterns(st), caps = X.effectiveCaps(st);
  const o = k => ({res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:caps[k],capFollow:X.capFollows(st,k)});
  const GA = X.buildShell(st.shells[0], pats[0], o(0)), GB = X.buildShell(st.shells[1], pats[1], o(1));
  const radial = st.shells[1].R - (st.shells[0].R + st.shells[0].t), axial = (st.shells[1].zTop - st.shells[1].t) - st.shells[0].zTop;
  check('auto-fit: radial and axial gap both equal the set gap', Math.abs(radial - st.fit.gap) < 1e-9 && Math.abs(axial - st.fit.gap) < 1e-9 && Math.abs(X.clearanceGap(GA, GB) - st.fit.gap) < 1e-6, `radial=${radial} axial=${axial} gap=${X.clearanceGap(GA,GB)}`);
  check('auto-fit: default design builds clean', GA.ok && GB.ok && GA.stats.thin + GA.stats.small + GB.stats.thin + GB.stats.small === 0, `A ${GA.stats.holes} holes, B ${GB.stats.holes} holes`);
  const sp = X.tableUplightState(); sp.shells[0].shape = 'sphere'; sp.shells[0].R = 60; sp.shells[0].zBot = -40; sp.shells[0].zTop = 50; sp.shells[0].cap.on = false; X.fitOuter(sp);
  const GS = [0,1].map(k => X.buildShell(sp.shells[k], X.effectivePatterns(sp)[k], {res:0.7,minWeb:2,minHole:3,split:true,seam:4}));
  check('auto-fit sphere: builds, gap as set', GS[0].ok && GS[1].ok && Math.abs(X.clearanceGap(GS[0], GS[1]) - sp.fit.gap) < 0.5, `gap=${X.clearanceGap(GS[0], GS[1]).toFixed(2)}`);
  const old = JSON.parse(JSON.stringify(X.helixState())); delete old.fit; delete old.plan; delete old.lamp; old.shells[1].R = 71.25;
  const L = X.loadDesign(old);
  check('old design loads with auto-fit off and outer shell untouched', L.fit.auto === false && L.shells[1].R === 71.25);
}
// Opening design: the uploaded file, plus bottom caps and pendant stem bores
{
  const d = X.defaultState();
  const want = { lamp: { mount: 'pendant' }, fit: { auto: true, gap: 23 }, source: { type: 'line', size: 1.4, length: 8, z: 10, emit: 'omni', color: 'warm' }, link: { mode: 'linked', detune: 0, mirror: true }, motion: { mode: 'motor', offset: 0, snap: 0, bookmarks: [], rpmA: 0.9, rpmB: 0 }, room: { W: 4900, D: 4150, H: 2700, lampZ: 940, exposure: 1, ambient: 0.015 } };
  const same = Object.keys(want).every(k => JSON.stringify(d[k]) === JSON.stringify(want[k]));
  const geo = [d.shells[0].R, d.shells[0].zBot, d.shells[0].zTop, d.shells[1].R, d.shells[1].zBot, d.shells[1].zTop].join(',');
  const caps = d.shells.map(s => [s.cap.on, s.cap.bore, s.capBot.on, s.capBot.bore].join('/')).join(' ');
  check('opening design: uploaded file plus bottom caps and top stem bores', same && geo === '50,-82.5,119.5,76,-108.5,145.5' && caps === 'true/6/true/0 true/4.5/true/0' && JSON.stringify(d.shells[0].pattern.params.slots) === JSON.stringify({ N: 31, twist: 1.47, wobA: 0, wobK: 1.5, duty: 0.62 }), geo + ' | ' + caps);
  const up = X.PRESETS.filter(p => p.group === 'Table uplights');
  check('every table-uplight preset carries an upward die and table mount', up.length === 7 && up.every(p => p.source && p.source.emit === 'up' && p.mount === 'table'), up.map(p => p.name).join(' | '));
}
// Bottom caps and bores: every combination is watertight with genus = (open ends - 1) + holes
{
  const sv = (m) => { const p=m.positions, ix=m.indices; let v=0; for (let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3; v += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;} return v; };
  const blank = {gen:'slots', invert:false, phase:0, params:{N:3,twist:0,wobA:0,wobK:0,duty:0.0001}};
  const slots = {gen:'slots', invert:false, phase:0, params:{N:24,twist:0.6,wobA:0,wobK:0,duty:0.4}};
  const base = () => ({ shape:'cylinder', R:50, t:3, zBot:-90, zTop:110, rimBot:6, rimTop:6, cap: X.mkCap({on:true, hub:22}), capBot: X.mkCap({on:true, hub:22}) });
  // analytic volume: wall annulus over the full height, plus two cap discs, minus the bores
  for (const [bT, bB] of [[0,0],[6,0],[0,6],[6,4.5]]) {
    const sh = base(); sh.cap.bore = bT; sh.capBot.bore = bB;
    const G = X.buildShell(sh, blank, {res:0.5,minWeb:2,minHole:3,split:false,seam:4,capPattern:blank,capBotPattern:blank});
    const p = G.parts[0], m = X.buildMesh(G, p), c = X.checkMesh(m, p.holes, p.ends), vol = sv(m);
    const Ro = sh.R+sh.t, exact = Math.PI*(Ro*Ro-sh.R*sh.R)*(sh.zTop-sh.zBot) + Math.PI*(sh.R*sh.R-bT*bT)*sh.t + Math.PI*(sh.R*sh.R-bB*bB)*sh.t;
    check(`blank shell capped both ends, bores ${bT}/${bB}: watertight, volume`, c.ok && Math.abs(vol-exact)/exact < 0.005, `ends=${p.ends} genus=${c.genus}/${c.expectGenus} vol err=${((vol-exact)/exact*100).toFixed(3)}%`);
  }
  for (const [bT, bB, split] of [[0,0,false],[6,0,false],[0,6,true],[6,4.5,true],[0,0,true]]) {
    const sh = base(); sh.cap.bore = bT; sh.capBot.bore = bB;
    const G = X.buildShell(sh, slots, {res:0.7,minWeb:2,minHole:3,split,seam:4,capPattern:slots,capFollow:true,capBotPattern:slots,capBotFollow:true});
    for (const p of G.parts) { const c = X.checkMesh(X.buildMesh(G, p), p.holes, p.ends); check(`patterned, both caps, bores ${bT}/${bB}, ${p.suffix || 'whole'}`, c.ok, `ends=${p.ends} holes=${p.holes} genus=${c.genus}/${c.expectGenus} bad=${c.badEdges}`); }
  }
  const sp = { shape:'sphere', R:60, t:3.5, zBot:-50, zTop:50, rimBot:6, rimTop:6, cap: X.mkCap({on:true, hub:12}), capBot: X.mkCap({on:true, hub:12, bore:5}) };
  const GS = X.buildShell(sp, slots, {res:0.7,minWeb:2,minHole:3,split:true,seam:4,capPattern:slots,capFollow:true,capBotPattern:slots,capBotFollow:true,fdm:true});
  for (const p of GS.parts) { const c = X.checkMesh(X.buildMesh(GS, p), p.holes, p.ends); check(`sphere, both caps, split ${p.suffix}`, c.ok, `ends=${p.ends} genus=${c.genus}/${c.expectGenus}`); }
  // clearance at the bottom, emitter above the bottom cap, and a bore too big for its hub
  const A = base(), B = base(); B.R = 62; B.zBot = -96; B.zTop = 116;
  const o = {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:blank,capBotPattern:blank};
  const GA = X.buildShell(A, blank, o), GB = X.buildShell(B, blank, o);
  check('closest gap = 3 mm at both caps', Math.abs(X.clearanceGap(GA, GB) - 3) < 1e-6, X.clearanceGap(GA, GB).toFixed(3));
  B.zBot = -92; check('bottom cap collision detected', X.clearanceGap(GA, X.buildShell(B, blank, o)) < 0);
  check('emitter below the bottom cap rejected', !X.sourceInside(GA, {type:'line', size:1, length:180, z:0}) && X.sourceInside(GA, {type:'line', size:1, length:30, z:0}));
  const big = base(); big.capBot.bore = 21; check('bore too big for its hub is an error', !X.buildShell(big, blank, o).ok);
  // old designs: no capBot and no bore -> open bottom and solid top hub, whatever the default has
  const old = JSON.parse(JSON.stringify(X.tableUplightState())); old.shells.forEach(s => { delete s.capBot; delete s.cap.bore; });
  const L = X.loadDesign(old);
  check('old design loads with open bottoms and solid top hubs', L.shells.every(s => s.capBot.on === false && s.cap.bore === 0));
}
// Separate caps (cylinders): wall tube + flat discs, each watertight; volumes add up to the analytic shell
{
  const sv = (m) => { const p=m.positions, ix=m.indices; let v=0; for (let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3; v += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;} return v; };
  const blank = {gen:'slots', invert:false, phase:0, params:{N:3,twist:0,wobA:0,wobK:0,duty:0.0001}};
  const slots = {gen:'slots', invert:false, phase:0, params:{N:24,twist:0.6,wobA:0,wobK:0,duty:0.4}};
  const base = () => ({ shape:'cylinder', R:50, t:3, zBot:-90, zTop:110, rimBot:6, rimTop:6, cap: X.mkCap({on:true, hub:22}), capBot: X.mkCap({on:true, hub:22}) });
  for (const [bT, bB] of [[0,0],[6,0],[0,6],[6,4.5]]) {
    const sh = base(); sh.cap.bore = bT; sh.capBot.bore = bB;
    const G = X.buildShell(sh, blank, {res:0.5,minWeb:2,minHole:3,split:true,seam:4,capPattern:blank,capBotPattern:blank,capsSeparate:true});
    let vol = 0, ok = G.ok && G.parts.length === 3; const info = [];
    for (const p of G.parts) { const m = X.buildMesh(G, p), c = X.checkMesh(m, p.holes, p.ends); ok = ok && c.ok; vol += sv(m); info.push(`${p.suffix} ends=${p.ends} genus=${c.genus}/${c.expectGenus}`); }
    const Ro = sh.R + sh.t, exact = Math.PI*(Ro*Ro-sh.R*sh.R)*(sh.zTop-sh.zBot-2*sh.t) + Math.PI*(Ro*Ro-bT*bT)*sh.t + Math.PI*(Ro*Ro-bB*bB)*sh.t;
    check(`separate caps, bores ${bT}/${bB}: 3 watertight parts, volumes add up`, ok && Math.abs(vol-exact)/exact < 0.001, info.join('; ') + ` | vol err=${((vol-exact)/exact*100).toFixed(4)}%`);
  }
  const sh = base(); sh.cap.bore = 6;
  const G = X.buildShell(sh, slots, {res:0.7,minWeb:2,minHole:3,split:true,seam:4,capPattern:slots,capFollow:true,capBotPattern:slots,capBotFollow:true,capsSeparate:true});
  const tot = G.parts.reduce((n, p) => n + p.holes, 0);
  for (const p of G.parts) { const c = X.checkMesh(X.buildMesh(G, p), p.holes, p.ends); check(`separate caps, patterned: ${p.suffix}`, c.ok, `holes=${p.holes} ends=${p.ends} genus=${c.genus}/${c.expectGenus}`); }
  check('separate caps: every hole lands in exactly one part, and no seam split', tot === G.stats.holes && !G.split, `${tot} of ${G.stats.holes}`);
  const wall = G.parts[0].rows, top = wall[wall.length - 1], bot = wall[0];
  check('wall tube ends are flat joint rings one wall in from the caps', top.zi === sh.zTop - sh.t && top.zo === sh.zTop - sh.t && bot.zi === sh.zBot + sh.t && bot.zo === sh.zBot + sh.t);
  const narrow = base(); narrow.rimTop = 1;
  check('too-narrow corner band is an error when caps are separate', !X.buildShell(narrow, slots, {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:slots,capFollow:true,capBotPattern:slots,capBotFollow:true,capsSeparate:true}).ok);
  const d = X.defaultState(); const pa = X.effectivePatterns(d), ca = X.effectiveCaps(d), cb = X.effectiveCapsBot(d);
  for (const k of [0, 1]) {
    const g = X.buildShell(d.shells[k], pa[k], {res:d.res,fillSmall:true,minWeb:2,minHole:3,split:false,seam:4,mirror:k===1&&d.link.mirror,capPattern:ca[k],capFollow:X.capFollows(d,k),capBotPattern:cb[k],capBotFollow:X.capFollowsBot(d,k),capsSeparate:true});
    const res = g.parts.map(p => { const c = X.checkMesh(X.buildMesh(g, p), p.holes, p.ends); return `${p.suffix}:${c.ok ? 'ok' : 'FAIL'}`; });
    check(`default design, separate caps, ${k ? 'outer' : 'inner'}`, g.ok && res.every(r => r.endsWith('ok')) && res.length === 3, res.join(' '));
  }
}

// CAD profiles: closed outlines whose planes match the printed meshes and whose revolved volume matches the blank mesh
{
  const sv = (m) => { const p=m.positions, ix=m.indices; let v=0; for (let t=0;t<ix.length;t+=3){const a=ix[t]*3,b=ix[t+1]*3,c=ix[t+2]*3; v += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;} return v; };
  const zr = m => { let lo=Infinity, hi=-Infinity; for (let i=2;i<m.positions.length;i+=3){ lo=Math.min(lo,m.positions[i]); hi=Math.max(hi,m.positions[i]); } return [lo,hi]; };
  const pz = segs => { let lo=Infinity, hi=-Infinity; for (const s of segs) for (const q of [s.a,s.b]) { lo=Math.min(lo,q[1]); hi=Math.max(hi,q[1]); } return [lo,hi]; };
  const blank = {gen:'slots', invert:false, phase:0, params:{N:3,twist:0,wobA:0,wobK:0,duty:0.0001}};
  const slots = {gen:'slots', invert:false, phase:0, params:{N:24,twist:0.6,wobA:0,wobK:0,duty:0.4}};
  const cyl = () => ({ shape:'cylinder', R:50, t:3, zBot:-90, zTop:110, rimBot:6, rimTop:6, cap: X.mkCap({on:true, hub:22}), capBot: X.mkCap({on:true, hub:22}) });
  const sph = () => ({ shape:'sphere', R:60, t:3.5, zBot:-50, zTop:50, rimBot:6, rimTop:6, cap: X.mkCap({on:true, hub:12}), capBot: X.mkCap({on:true, hub:12, bore:5}) });
  const cases = [];
  for (const [bT,bB] of [[0,0],[6,0],[0,6],[6,4.5]]) for (const [sep, split] of [[false,false],[false,true],[true,false]]) {
    const sh = cyl(); sh.cap.bore=bT; sh.capBot.bore=bB; cases.push([`cylinder bores ${bT}/${bB}${sep?' separate caps':''}${split?' split':''}`, sh, {split, capsSeparate:sep}]);
  }
  { const sh = cyl(); sh.cap.on=false; sh.capBot.on=false; cases.push(['open cylinder', sh, {split:false}]); }
  { const sh = cyl(); sh.capBot.on=false; sh.cap.bore=6; cases.push(['top-capped cylinder, open bottom', sh, {split:false}]); cases.push(['top-capped cylinder, separate cap', JSON.parse(JSON.stringify(sh)), {split:false, capsSeparate:true}]); }
  cases.push(['capped sphere, split', sph(), {split:true, fdm:true}]);
  { const sh = sph(); sh.cap.on=false; sh.capBot.on=false; cases.push(['open sphere', sh, {split:false}]); }
  for (const [label, sh, o] of cases) {
    const base = {res:0.5,minWeb:2,minHole:3,seam:4};
    const GB = X.buildShell(sh, blank, Object.assign({}, base, o, {capPattern:blank, capBotPattern:blank}));
    const GP = X.buildShell(sh, slots, Object.assign({}, base, o, {res:0.7, capPattern:slots, capFollow:true, capBotPattern:slots, capBotFollow:true}));
    if (!GB.ok || !GP.ok) { check(`profile ${label}: builds`, false, GB.errors.concat(GP.errors).join('; ')); continue; }
    const info = []; let ok = GB.parts.length === GP.parts.length;
    GB.parts.forEach((p, i) => {
      const segs = X.shellProfile(GB, p), closed = X.profileClosed(segs);
      const vB = sv(X.buildMesh(GB, p)), vP = X.profileVolume(segs), err = (vP - vB) / vB;
      const [a0,a1] = pz(segs), [m0,m1] = zr(X.buildMesh(GP, GP.parts[i]));
      const planes = Math.abs(a0-m0) < 1e-4 && Math.abs(a1-m1) < 1e-4;
      const good = closed && Math.abs(err) < 0.005 && planes && segs.length < 20;
      ok = ok && good;
      info.push(`${p.suffix||'whole'}: ${closed?'closed':'OPEN'} vol err ${(err*100).toFixed(3)}% z ${a0.toFixed(2)}..${a1.toFixed(2)} vs mesh ${m0.toFixed(2)}..${m1.toFixed(2)}`);
    });
    check(`profile ${label}`, ok, info.join('; '));
  }

  // every preset, both shells, as exported (split and separate caps as the studio would choose them)
  for (const pr of X.PRESETS) for (const sepCaps of [false, true]) {
    const st = pr.make(), pats = X.effectivePatterns(st), caps = X.effectiveCaps(st), capsB = X.effectiveCapsBot(st);
    let ok = true; const bad = [];
    for (const k of [0,1]) {
      const sh = st.shells[k], sep = sepCaps && sh.shape === 'cylinder' && (sh.cap.on || sh.capBot.on);
      const split = (sh.shape === 'sphere' && st.process.split) || (k === 1 && sh.cap.on && sh.capBot.on && !sep);
      const G = X.buildShell(sh, pats[k], {res:1.2,fillSmall:true,minWeb:2,minHole:3,split,seam:4,mirror:k===1&&st.link.mirror,capPattern:caps[k],capFollow:X.capFollows(st,k),capBotPattern:capsB[k],capBotFollow:X.capFollowsBot(st,k),capsSeparate:sepCaps,fdm:true});
      if (!G.ok) continue;
      for (const p of G.parts) {
        const segs = X.shellProfile(G, p), [a0,a1] = pz(segs), [m0,m1] = zr(X.buildMesh(G, p));
        if (!X.profileClosed(segs) || Math.abs(a0-m0) > 1e-4 || Math.abs(a1-m1) > 1e-4) { ok = false; bad.push(`shell${k} ${p.suffix||'whole'} ${a0.toFixed(2)}..${a1.toFixed(2)} vs ${m0.toFixed(2)}..${m1.toFixed(2)}`); }
      }
    }
    check(`profile planes match meshes: ${pr.name}${sepCaps?' (separate caps)':''}`, ok, bad.join('; '));
  }
  // exact volume for a blank capped cylinder with bores (no faceting in the profile)
  const sh = cyl(); sh.cap.bore = 6; sh.capBot.bore = 4.5;
  const G = X.buildShell(sh, blank, {res:0.7,minWeb:2,minHole:3,split:false,seam:4,capPattern:blank,capBotPattern:blank});
  const Ro = sh.R+sh.t, exact = Math.PI*(Ro*Ro-sh.R*sh.R)*(sh.zTop-sh.zBot) + Math.PI*(sh.R*sh.R-36)*sh.t + Math.PI*(sh.R*sh.R-4.5*4.5)*sh.t;
  const v = X.profileVolume(X.shellProfile(G, G.parts[0]));
  check('profile volume is exact for a blank capped cylinder', Math.abs(v-exact)/exact < 1e-9, `${v.toFixed(3)} vs ${exact.toFixed(3)}`);
  const s2 = { shape:'sphere', R:60, t:3, zBot:-40, zTop:40, rimBot:6, rimTop:6, cap: X.mkCap({on:false}), capBot: X.mkCap({on:false}) };
  const G2 = X.buildShell(s2, blank, {res:0.7,minWeb:2,minHole:3,split:false,seam:4});
  const slab = (r, z0, z1) => Math.PI*(r*r*(z1-z0) - (z1**3 - z0**3)/3);
  const exact2 = slab(63, -40, 40) - slab(60, -40, 40);
  const v2 = X.profileVolume(X.shellProfile(G2, G2.parts[0]));
  check('profile volume is exact for an open sphere band', Math.abs(v2-exact2)/exact2 < 1e-7, `${v2.toFixed(3)} vs ${exact2.toFixed(3)}`);
}
// Flat cutting: opened walls and cap discs match the field they come from
{
  const d = X.defaultState(); d.shells.forEach(s => { s.t = 0.8; }); X.fitOuter(d);
  const pa = X.effectivePatterns(d), ca = X.effectiveCaps(d), cb = X.effectiveCapsBot(d);
  const o = k => ({res:d.res,fillSmall:true,minWeb:1.2,minHole:1,split:false,seam:4,mirror:k===1&&d.link.mirror,capPattern:ca[k],capFollow:X.capFollows(d,k),capBotPattern:cb[k],capBotFollow:X.capFollowsBot(d,k),capsSeparate:true});
  for (const k of [0, 1]) {
    const G = X.buildShell(d.shells[k], pa[k], o(k)), who = k ? 'outer' : 'inner';
    if (!G.ok) { check(`flat ${who}: builds`, false, G.errors.join('; ')); continue; }
    const F0 = X.flatParts(G, { kerf: 0, strip: true, stripW: 10 }), F = X.flatParts(G, { kerf: 0.2, strip: true, stripW: 10 });
    const P = n => F0.parts.find(p => p.name === n), Rm = G.R + G.t / 2, Ro = G.Ro;
    const wall = P('wall');
    check(`flat ${who}: wall is circumference x height at mid-thickness`, Math.abs(wall.w - 2 * Math.PI * Rm) < 1e-9 && Math.abs(wall.h - (G.zTop - G.zBot)) < 1e-9, `${wall.w.toFixed(3)} x ${wall.h.toFixed(2)}`);
    // expected open area of the wall: field < 0 in the wall zone, mapped to the mid-surface (y = Rm s / Ro)
    let want = 0, wantT = 0; const zc = G.zTop - G.t / 2;
    for (let j = 0; j < G.Nb - 1; j++) {
      const s = G.bandS[j], ds = G.bandS[j + 1] - s; let open = 0;
      for (let i = 0; i < G.Nc; i++) open += (G.field[j * G.Nc + i] + G.field[(j + 1) * G.Nc + i]) < 0 ? 1 : 0;
      if (s >= G.sWallLo && s < G.sWallHi) want += open / G.Nc * 2 * Math.PI * Rm * (Rm / Ro) * ds;
      if (s >= G.sCapLo) { const r0 = zc / Math.tan(G.psiOfS(s)), r1 = zc / Math.tan(G.psiOfS(G.bandS[j + 1])); wantT += open / G.Nc * Math.PI * Math.abs(r0 * r0 - r1 * r1); }
    }
    const got = wall.holes.reduce((n, h) => n + Math.abs(X.polyArea(h)), 0);
    check(`flat ${who}: wall hole area matches the field's open area`, Math.abs(got - want) / want < 0.02, `${got.toFixed(0)} vs ${want.toFixed(0)} mm2 (${((got - want) / want * 100).toFixed(2)}%)`);
    const cap = P('top-cap'), gotT = cap.holes.reduce((n, h) => n + Math.abs(X.polyArea(h)), 0);
    check(`flat ${who}: top-cap hole area matches the field's open area`, Math.abs(gotT - wantT) / wantT < 0.03, `${gotT.toFixed(0)} vs ${wantT.toFixed(0)} mm2`);
    // kerf: each hole shrinks by about perimeter x kerf/2
    const wallK = F.parts.find(p => p.name === 'wall'), aK = wallK.holes.reduce((n, h) => n + Math.abs(X.polyArea(h)), 0);
    const per = wall.holes.reduce((n, h) => { let l = 0; for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; if (!(a[0] <= 1e-9 && b[0] <= 1e-9) && !(a[0] >= wall.w - 1e-9 && b[0] >= wall.w - 1e-9)) l += Math.hypot(b[0] - a[0], b[1] - a[1]); } return n + l; }, 0);
    check(`flat ${who}: kerf shrinks holes by perimeter x kerf/2`, Math.abs((got - aK) - per * 0.1) / (per * 0.1) < 0.15, `lost ${(got - aK).toFixed(0)} mm2, expected ~${(per * 0.1).toFixed(0)}`);
    const strip = P('seam-strip'), sA = strip.holes.reduce((n, h) => n + Math.abs(X.polyArea(h)), 0);
    check(`flat ${who}: seam strip has holes inside its outline`, strip.holes.length > 0 && sA < strip.w * strip.h && strip.holes.every(h => h.every(q => q[0] >= -1e-6 && q[0] <= strip.w + 1e-6)), `${strip.holes.length} cut-outs, ${sA.toFixed(0)} mm2`);
    let fin = true; for (const p of F.parts) for (const h of p.holes) for (const q of h) if (!isFinite(q[0]) || !isFinite(q[1])) fin = false;
    check(`flat ${who}: every cut path is finite and closed`, fin && F.parts.every(p => p.holes.every(h => h.length >= 3)));
    let agree = true; const info = [];
    for (const p of F.parts) {
      const svg = X.svgOf(p, { title: p.name, desc: '' }), dxf = X.dxfOf(p);
      const paths = (svg.match(/<path /g) || []).length, svgC = (svg.match(/<circle /g) || []).length, rects = (svg.match(/<rect /g) || []).length;
      const polys = (dxf.match(/\nPOLYLINE\n/g) || []).length, seqs = (dxf.match(/\nSEQEND\n/g) || []).length, circs = (dxf.match(/\nCIRCLE\n/g) || []).length;
      const ok = paths === p.holes.length && polys === p.holes.length + rects && seqs === polys && circs === svgC && /<\/svg>\s*$/.test(svg) && /EOF\n$/.test(dxf);
      agree = agree && ok; info.push(`${p.name}: ${paths} paths/${polys} polylines`);
    }
    check(`flat ${who}: SVG and DXF carry the same cut paths`, agree, info.join(', '));
  }
  const sp = { shape:'sphere', R:60, t:1, zBot:-40, zTop:40, rimBot:6, rimTop:6, cap: X.mkCap(), capBot: X.mkCap() };
  const GS = X.buildShell(sp, {gen:'slots',invert:false,phase:0,params:{N:20,twist:0,wobA:0,wobK:0,duty:0.4}}, {res:1,minWeb:1.2,minHole:1,split:false,seam:4});
  check('flat: spheres are refused', !!X.flatParts(GS, {}).error);
}
// Tabbed laser caps: tabs and slots line up, fit with the set clearance, and the flange shades nothing
{
  const d = X.defaultState(); d.shells.forEach(s => { s.t = 0.8; }); X.fitOuter(d);
  const pa = X.effectivePatterns(d), ca = X.effectiveCaps(d), cb = X.effectiveCapsBot(d), m = 4;
  const o = (k, fl) => ({res:d.res,fillSmall:true,minWeb:1.2,minHole:1,split:false,seam:4,mirror:k===1&&d.link.mirror,capPattern:ca[k],capFollow:X.capFollows(d,k),capBotPattern:cb[k],capBotFollow:X.capFollowsBot(d,k),capsSeparate:true,flange:fl});
  for (const k of [0, 1]) {
    const G = X.buildShell(d.shells[k], pa[k], o(k, m)), who = k ? 'outer' : 'inner', t = G.t, Rm = G.R + t / 2, Ro = G.Ro;
    // a ray from the light through the top of the wall pattern passes just under the flange's outer edge
    const zAtFlange = G.sWallHi * (Ro + m) / Ro, zAtFlangeB = G.sWallLo * (Ro + m) / Ro;
    check(`tabs ${who}: wall pattern stops where rays clear the flange`, zAtFlange <= G.zTop - t + 1e-9 && zAtFlangeB >= G.zBot + t - 1e-9, `top ray ${zAtFlange.toFixed(3)} <= ${(G.zTop - t).toFixed(3)}, bottom ${zAtFlangeB.toFixed(3)} >= ${(G.zBot + t).toFixed(3)}`);
    const opt = { kerf: 0, strip: false, joint: 'tabs', tabs: 8, tabW: 10, tabExtra: 3, flange: m, fit: 0.1 };
    const F = X.flatParts(G, opt), wall = F.parts.find(p => p.name === 'wall'), P = wall.outline.points, tabH = t + 3;
    let ortho = true; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (Math.abs(a[0] - b[0]) > 1e-9 && Math.abs(a[1] - b[1]) > 1e-9) ortho = false; }
    const wantA = wall.w * wall.h + 2 * 8 * 10 * tabH;
    check(`tabs ${who}: wall outline is closed and rectilinear, body plus 2 x 8 tabs`, ortho && Math.abs(X.polyArea(P) - wantA) < 1e-6, `${X.polyArea(P).toFixed(3)} vs ${wantA.toFixed(3)} mm2, body ${wall.h.toFixed(2)} mm tall`);
    check(`tabs ${who}: wall body runs between the joint planes`, Math.abs(wall.h - (G.zTop - G.zBot - 2 * t)) < 1e-9);
    let ok = true; const info = [];
    for (const end of ['top-cap', 'bottom-cap']) {
      const cap = F.parts.find(p => p.name === end), slots = cap.holes.slice(-8), flip = end === 'top-cap' ? 1 : -1;
      if (Math.abs(cap.circles[0].r - (G.R + t + m)) > 1e-9) ok = false;
      for (let i = 0; i < 8; i++) {
        const S = slots[i], r = S.map(q => Math.hypot(q[0], q[1])), ang = S.map(q => Math.atan2(flip * q[1], q[0]));
        const rw = Math.max(...r) - Math.min(...r), phi = (i + 0.5) * 2 * Math.PI / 8, tabX = phi * Rm;
        let a0 = Infinity, a1 = -Infinity; for (const a of ang) { const w = a - phi - 2 * Math.PI * Math.round((a - phi) / (2 * Math.PI)); a0 = Math.min(a0, w); a1 = Math.max(a1, w); }
        const arc = (a1 - a0) * Rm;
        if (Math.abs(rw - (t + 0.2)) > 1e-6 || Math.abs(arc - 10.2) > 1e-6 || Math.abs((a0 + a1) / 2) > 1e-9) ok = false;
        if (i === 0) info.push(`${end}: slot ${rw.toFixed(3)} x ${arc.toFixed(3)} mm at ${(phi * 180 / Math.PI).toFixed(2)} deg, tab centre ${tabX.toFixed(3)} mm along the wall`);
      }
    }
    check(`tabs ${who}: slots sit under the tabs, sheet + 2 x 0.1 mm across, tab + 2 x 0.1 mm along`, ok, info.join('; '));
    const FK = X.flatParts(G, Object.assign({}, opt, { kerf: 0.2 })), wk = FK.parts.find(p => p.name === 'wall');
    const grow = X.polyArea(wk.outline.points) - X.polyArea(P), per = (() => { let l = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; l += Math.hypot(b[0] - a[0], b[1] - a[1]); } return l; })();
    check(`tabs ${who}: kerf grows the outline by half a kerf all round`, Math.abs(grow - per * 0.1) / (per * 0.1) < 0.01, `+${grow.toFixed(1)} mm2 vs ${(per * 0.1).toFixed(1)}`);
    const svg = X.svgOf(wk, { title: 'w', desc: '' }), dxf = X.dxfOf(wk);
    check(`tabs ${who}: SVG and DXF both carry the tabbed outline`, (svg.split('id="cut-outline"')[1].match(/<path /g) || []).length === 1 && (dxf.match(/\nPOLYLINE\n/g) || []).length === wk.holes.length + 1);
  }
}
// Printed caps for laser-cut walls: watertight, the groove fits the sheet, holes stay on their rays, lips shade nothing
{
  const d = X.defaultState(); d.shells.forEach(s => { s.t = 0.8; }); X.fitOuter(d);
  const pa = X.effectivePatterns(d), ca = X.effectiveCaps(d), cb = X.effectiveCapsBot(d), co = { fit: 0.1, lip: 1.6, depth: 5, plate: 2.4 }, reach = co.fit + co.lip;
  const o = (k, extra) => Object.assign({res:d.res,fillSmall:true,minWeb:1.2,minHole:1,split:false,seam:4,mirror:k===1&&d.link.mirror,capPattern:ca[k],capFollow:X.capFollows(d,k),capBotPattern:cb[k],capBotFollow:X.capFollowsBot(d,k),capsSeparate:true,flange:reach,flangeDrop:co.depth,lipIn:reach}, extra || {});
  for (const k of [0, 1]) {
    const G = X.buildShell(d.shells[k], pa[k], o(k)), who = k ? 'outer' : 'inner', t = G.t, Ro = G.Ro;
    if (!G.ok) { check(`printed ${who}: shell builds`, false, G.errors.join('; ')); continue; }
    for (const top of [true, false]) {
      const end = `${who} ${top ? 'top' : 'bottom'}`, P = X.printedCap(G, top, co), q = P.groove;
      const m = X.buildMesh(P.G, P.part), c = X.checkMesh(m, P.part.holes, P.part.ends);
      check(`printed ${end}: cap is watertight with every hole`, c.ok && P.part.holes > 0, `holes=${P.part.holes} genus=${c.genus} exp=${c.expectGenus} bad=${c.badEdges} F=${c.F}`);
      check(`printed ${end}: groove is sheet + 2 x 0.1 mm wide, 5 mm deep, centred on the wall`, Math.abs(q.width - (t + 0.2)) < 1e-9 && Math.abs(Math.abs(q.zLip - q.zJoint) - 5) < 1e-9 && Math.abs((q.inner + q.outer) / 2 - (G.R + t / 2)) < 1e-9, `${q.width.toFixed(3)} x ${Math.abs(q.zLip - q.zJoint)} mm`);
      let zmin = Infinity, zmax = -Infinity, rmax = 0; const p = m.positions;
      for (let i = 0; i < p.length; i += 3) { zmin = Math.min(zmin, p[i + 2]); zmax = Math.max(zmax, p[i + 2]); rmax = Math.max(rmax, Math.hypot(p[i], p[i + 1])); }
      const want = top ? [G.zTop - t - 5, G.zTop - t + 2.4] : [G.zBot + t - 2.4, G.zBot + t + 5];
      check(`printed ${end}: spans lip foot to plate face, ${(2 * q.lipOuter).toFixed(1)} mm across`, Math.abs(zmin - want[0]) < 1e-4 && Math.abs(zmax - want[1]) < 1e-4 && Math.abs(rmax - (Ro + reach)) < 1e-4, `z ${zmin.toFixed(3)}..${zmax.toFixed(3)}, r ${rmax.toFixed(3)}`);
      let ray = 0; for (const r of P.part.rows) if (r.band >= 0) ray = Math.max(ray, Math.abs(Math.atan2(r.zi, r.ri) - Math.atan2(r.zo, r.ro)));
      check(`printed ${end}: thickened holes stay on their rays from the light`, ray < 1e-12, `max ${ray.toExponential(1)} rad`);
    }
    // a ray through the end of the wall pattern passes the outer lip's foot; one through the cap pattern's edge passes inside the inner lip
    const e = Ro + reach, a = G.R - reach;
    const wallT = G.sWallHi * e / Ro <= G.zTop - t - 5 + 1e-9, wallB = G.sWallLo * e / Ro >= G.zBot + t + 5 - 1e-9;
    const capT = G.pt(0, G.sCapLo)[0] <= a + 1e-9, capB = G.pt(0, G.sCapBHi)[0] <= a + 1e-9;
    check(`printed ${who}: no wall or cap pattern ray touches a lip`, wallT && wallB && capT && capB, `wall top ray at the lip ${(G.sWallHi * e / Ro).toFixed(2)} <= ${(G.zTop - t - 5).toFixed(2)}, cap edge r ${G.pt(0, G.sCapLo)[0].toFixed(2)} <= ${a.toFixed(2)}`);
    const F = X.flatParts(G, { kerf: 0, strip: true, stripW: 10, joint: 'print', depth: 5 }), wall = F.parts.find(p => p.name === 'wall'), strip = F.parts.find(p => p.name === 'seam-strip');
    check(`printed ${who}: wall is a plain rectangle between the joint planes, no cap discs`, wall.outline.type === 'rect' && Math.abs(wall.h - (G.zTop - G.zBot - 2 * t)) < 1e-9 && !F.parts.some(p => p.kind === 'disc'));
    check(`printed ${who}: seam strip stops clear of both grooves`, Math.abs(strip.h - (wall.h - 2 * 5.5)) < 1e-9, `${strip.h.toFixed(2)} of ${wall.h.toFixed(2)} mm`);
  }
  // Volume: an unpierced cap matches its revolved cross-section
  const sh = d.shells[0], pat = { gen: 'slots', invert: false, phase: 0, params: { N: 3, twist: 0, wobA: 0, wobK: 0, duty: 0.0001 } };
  const G = X.buildShell(sh, pat, o(0, { capPattern: null, capBotPattern: null, capFollow: false, capBotFollow: false }));
  const P = X.printedCap(G, true, co), q = P.groove, m = X.buildMesh(P.G, P.part), pp = m.positions, ix = m.indices;
  let vol = 0; for (let i = 0; i < ix.length; i += 3) { const A = ix[i] * 3, B = ix[i + 1] * 3, C = ix[i + 2] * 3; vol += (pp[A] * (pp[B + 1] * pp[C + 2] - pp[B + 2] * pp[C + 1]) - pp[A + 1] * (pp[B] * pp[C + 2] - pp[B + 2] * pp[C]) + pp[A + 2] * (pp[B] * pp[C + 1] - pp[B + 1] * pp[C])) / 6; }
  const zc = q.zJoint, zL = q.zLip, z1 = q.zFace, h = q.chamfer, b0 = G.boreT;
  const poly = [[q.outer + h, zL], [q.lipOuter, zL], [q.lipOuter, z1], [b0, z1], [b0, zc], [q.lipInner, zc], [q.lipInner, zL], [q.inner - h, zL], [q.inner, zL + h], [q.inner, zc], [q.outer, zc], [q.outer, zL + h]];
  const segs = poly.map((a, i) => ({ type: 'line', a, b: poly[(i + 1) % poly.length] })), exact = X.profileVolume(segs);
  check('printed: unpierced cap volume matches its cross-section', G.stats.holes === 0 && vol > 0 && Math.abs(vol - exact) / exact < 0.002, `vol=${vol.toFixed(1)} exact=${exact.toFixed(1)}`);
}
// FDM overhang check: twisted slots lean at atan(1 / twist) at lamp height; the check agrees with the meshed faces
{
  const d = X.defaultState(), pa = X.effectivePatterns(d), ca = X.effectiveCaps(d), cb = X.effectiveCapsBot(d), sh = d.shells[0];
  const o = (sep, fdm) => ({res:d.res,fillSmall:true,minWeb:2,minHole:3,split:false,seam:4,mirror:false,capPattern:ca[0],capFollow:X.capFollows(d,0),capBotPattern:cb[0],capBotFollow:X.capFollowsBot(d,0),capsSeparate:sep,fdm});
  const meshFlat = (G, bed) => { // area of mesh faces towards the bed flatter than 45 degrees, off the bed
    const part = G.parts.find(p => p.suffix === 'wall'), m = X.buildMesh(G, part), p = m.positions, ix = m.indices, sg = bed === 'top' ? 1 : -1;
    let zEnd = -sg * Infinity; for (let i = 2; i < p.length; i += 3) zEnd = sg > 0 ? Math.max(zEnd, p[i]) : Math.min(zEnd, p[i]);
    let A = 0;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
      if (sg * nz / L > Math.cos(Math.PI / 4) && Math.abs((p[a + 2] + p[b + 2] + p[c + 2]) / 3 - zEnd) > 0.01) A += L / 2;
    }
    return A;
  };
  for (const tw of [1.47, 1.2, 1.0, 0.85, 0]) {
    const pat = JSON.parse(JSON.stringify(pa[0])); pat.params.twist = tw;
    const G = X.buildShell(sh, pat, o(true, true)), s = G.stats, want = Math.atan(1 / tw) / X.DEG, A = meshFlat(G, s.ohBed);
    const angOK = tw > 1.0 ? s.overhang > 0 && Math.abs(s.ohFlat - want) < 1.5 : s.overhang === 0;
    check(`overhang twist ${tw}: ${tw > 1 ? `flags slots leaning ${want.toFixed(1)} deg` : 'passes'}`, G.ok && angOK && (s.overhang > 0) === (A > 50) && (s.overhang > 0) === G.warnings.some(w => /overhang/.test(w)),
      `runs=${s.overhang} flattest=${s.ohFlat.toFixed(1)} bed=${s.ohBed} mesh faces under 45 deg=${A.toFixed(0)} mm2`);
  }
  const G0 = X.buildShell(sh, pa[0], o(true, false));
  check('overhang: not checked outside FDM', G0.stats.overhang === 0 && !G0.warnings.some(w => /overhang/.test(w)));
  const GA = X.buildShell(Object.assign({}, sh, { capBot: Object.assign({}, sh.capBot, { on: false }) }), pa[0], o(false, true));
  const GS = X.buildShell(sh, pa[0], Object.assign(o(false, true), { split: true }));
  check('overhang: split halves are each checked cap-down', GS.split && GS.stats.ohBed === 'cap' && GS.stats.overhang > 0 && GS.warnings.some(w => /each half cap-down/.test(w)), `split=${GS.split} bed=${GS.stats.ohBed} runs=${GS.stats.overhang}`);
  check('overhang: a shell with only its top cap attached is checked cap-down', GA.stats.ohBed === 'top' && GA.stats.overhang > 0, `bed=${GA.stats.ohBed}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
