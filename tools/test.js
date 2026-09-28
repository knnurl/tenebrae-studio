// Geometry test harness. Usage: node tools/test.js
// Builds a node bundle of src/core.js + src/state.js and checks every preset's meshes.
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..'), strip = f => fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/\nif \(typeof module[\s\S]*$/, '\n');
const bundlePath = path.join(os.tmpdir(), 'tenebrae-bundle.js');
fs.writeFileSync(bundlePath, strip('core.js') + strip('state.js') + 'module.exports={effectiveCapsBot,capFollowsBot,mkCap,tableUplightState,GENS,buildShell,buildMesh,checkMesh,stlBinary,zipStore,crc32,clearanceGap,sourceInside,beatInfo,twistPeriods,PRESETS,effectivePatterns,effectiveCaps,capFollows,loadDesign,defaultState,helixState,fitOuter,fibPoints,wrapPi,TAU};');
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
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
