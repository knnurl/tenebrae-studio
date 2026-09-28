// ===== Tenebrae renderer: WebGL2, per-pixel ray test through both shells =====
const SCENE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
uniform mat4 uVP; uniform vec3 uOffset; uniform vec2 uJitter;
out vec3 vW; out vec3 vN;
void main(){ vec3 w = aPos + uOffset; vW = w; vN = aNrm; vec4 c = uVP * vec4(w, 1.0); c.xy += uJitter * c.w; gl_Position = c; }`;

const SCENE_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vW; in vec3 vN; out vec4 outC;
struct Shell { float shape; float R; float T; float zBot; float zTop; float sLo; float sMid; float sHi; float n1; float n2; float rows; float cols; float rot; float cap; float sC; float rhoC; };
uniform Shell uS[2];
uniform sampler2D uMaskA; uniform sampler2D uMaskB;
uniform vec3 uLamp; uniform int uKind; uniform int uShell; uniform vec3 uAlbedo;
uniform int uSrcType; uniform float uSrcSize; uniform float uSrcLen; uniform float uSrcZ; uniform int uEmit;
uniform int uSamples; uniform float uFrame; uniform float uPower; uniform vec3 uLightCol; uniform float uAmbient;
uniform int uDirect; uniform float uExposure;
const float TAU = 6.283185307179586;
float maskVal(int k, vec2 uv){ return k == 0 ? textureLod(uMaskA, uv, 0.0).r : textureLod(uMaskB, uv, 0.0).r; }
bool solidAt(int k, vec3 p){
  float rho = length(p.xy); float Ro = uS[k].R + uS[k].T;
  float s;
  if (uS[k].cap > 0.5 && p.z > 0.0 && uS[k].zTop * rho < uS[k].rhoC * p.z) s = uS[k].sC + uS[k].rhoC - uS[k].zTop * rho / p.z;
  else s = uS[k].shape < 0.5 ? Ro * p.z / max(rho, 1e-4) : Ro * atan(p.z, rho);
  if (s <= uS[k].sLo || s >= uS[k].sHi) return true;
  float row = s < uS[k].sMid ? (s - uS[k].sLo) / (uS[k].sMid - uS[k].sLo) * uS[k].n1
                             : uS[k].n1 + (s - uS[k].sMid) / (uS[k].sHi - uS[k].sMid) * uS[k].n2;
  float c = fract((atan(p.y, p.x) - uS[k].rot) / TAU) * uS[k].cols;
  return maskVal(k, vec2((c + 0.5) / uS[k].cols, (row + 0.5) / uS[k].rows)) >= 0.5;
}
float hitShell(int k, int f, vec3 S, vec3 D){
  float Rs = uS[k].R + (f == 1 ? uS[k].T : 0.0);
  if (uS[k].shape < 0.5) {
    float a = dot(D.xy, D.xy); if (a < 1e-9) return -1.0;
    float b = dot(S.xy, D.xy), c = dot(S.xy, S.xy) - Rs * Rs, disc = b * b - a * c;
    if (disc < 0.0) return -1.0; return (-b + sqrt(disc)) / a;
  }
  float b = dot(S, D), c = dot(S, S) - Rs * Rs, disc = b * b - c;
  if (disc < 0.0) return -1.0; return -b + sqrt(disc);
}
float transmit(vec3 S, vec3 P){
  vec3 d = P - S; float L = length(d); vec3 D = d / L;
  for (int k = 0; k < 2; k++) for (int f = 0; f < 2; f++) {
    float l = hitShell(k, f, S, D);
    bool capped = uS[k].cap > 0.5;
    if (capped) {
      float zc = uS[k].zTop - (f == 0 ? uS[k].T : 0.0);
      if (l <= 0.0 || S.z + l * D.z > zc) { if (D.z <= 1e-6) continue; l = (zc - S.z) / D.z; }
    }
    if (l > 0.0 && l < L - 0.05) {
      vec3 H = S + l * D;
      bool exists = capped ? H.z >= uS[k].zBot : (H.z >= uS[k].zBot && H.z <= uS[k].zTop);
      if (exists && solidAt(k, H)) return 0.0;
    }
  }
  return 1.0;
}
uint hash(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
vec3 rand3(int i){
  uvec2 px = uvec2(gl_FragCoord.xy);
  uint h = hash(px.x * 1973u + px.y * 9277u + 26699u);
  vec3 cp = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1024.0;
  float n = uFrame * float(uSamples) + float(i);
  return fract(cp + n * vec3(0.8191725134, 0.6710436067, 0.5497004779));
}
vec3 srcPoint(int i){
  if (uSrcType == 0) return vec3(0.0, 0.0, uSrcZ);
  vec3 r = rand3(i);
  if (uSrcType == 1) { float rr = 0.5 * uSrcSize * sqrt(r.x), a = TAU * r.y; return vec3(rr * cos(a), rr * sin(a), uSrcZ); }
  if (uSrcType == 2) return vec3(0.0, 0.0, uSrcZ + (r.x - 0.5) * uSrcLen);
  float z = 2.0 * r.x - 1.0, a = TAU * r.y, rr = 0.5 * uSrcSize * pow(r.z, 1.0 / 3.0), q = sqrt(max(0.0, 1.0 - z * z));
  return vec3(q * cos(a) * rr, q * sin(a) * rr, uSrcZ + z * rr);
}
float emitW(vec3 D){ if (uEmit == 0) return 1.0; if (uEmit == 1) return 2.0 * max(0.0, D.z); return 2.0 * max(0.0, -D.z); }
vec3 finish(vec3 c){ if (uDirect == 1) return pow(1.0 - exp(-c * uExposure), vec3(1.0 / 2.2)); return min(c, vec3(400.0)); }
void main(){
  vec3 P = vW - uLamp;
  if (uKind == 1 && !solidAt(uShell, P)) discard;
  if (uKind == 2) { outC = vec4(finish(uLightCol * 40.0), 1.0); return; }
  vec3 N = normalize(vN);
  int K = uSrcType == 0 ? 1 : uSamples;
  float E = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= K) break;
    vec3 S = srcPoint(i), d = P - S; float L2 = dot(d, d); vec3 D = d * inversesqrt(L2);
    float recv = max(0.0, dot(N, -D)); if (recv <= 0.0) continue;
    float w = emitW(D); if (w <= 0.0) continue;
    E += transmit(S, P) * w * recv / L2;
  }
  E *= uPower / float(K);
  outC = vec4(finish(uAlbedo * (E * uLightCol + uAmbient)), 1.0);
}`;

const QUAD_VS = `#version 300 es
out vec2 vUV; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const ACC_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D uTex; void main(){ o = texture(uTex, vUV); }`;
const DISP_FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform float uInv; uniform float uExposure;
void main(){ vec3 c = texture(uTex, vUV).rgb * uInv; o = vec4(pow(1.0 - exp(-c * uExposure), vec3(1.0 / 2.2)), 1.0); }`;

const M4 = {
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  look(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
  },
  mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
};

function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
  if (!gl) return null;
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  const compile = (vs, fs) => {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; U[nm] = gl.getUniformLocation(p, nm); }
    return { p, U };
  };
  const scene = compile(SCENE_VS, SCENE_FS), acc = compile(QUAD_VS, ACC_FS), disp = compile(QUAD_VS, DISP_FS);
  const vao = gl.createVertexArray();
  const meshes = { room: [], lamp: [[], []], emitter: null };
  const tex = [gl.createTexture(), gl.createTexture()];
  const shellU = [null, null];

  function mesh(pos, nrm, idx) {
    const v = gl.createVertexArray(); gl.bindVertexArray(v);
    const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const b2 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b2); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const b3 = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b3); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { v, n: idx.length, free() { gl.deleteVertexArray(v); gl.deleteBuffer(b1); gl.deleteBuffer(b2); gl.deleteBuffer(b3); } };
  }

  function setRoom(W, D, H) {
    meshes.room.forEach(m => m.m.free()); meshes.room = [];
    const x0 = -W / 2, x1 = W / 2, y0 = -D / 2, y1 = D / 2;
    const face = (a, b, c, d, n, alb) => meshes.room.push({ m: mesh([...a, ...b, ...c, ...d], [...n, ...n, ...n, ...n], [0, 1, 2, 0, 2, 3]), alb });
    const wall = [0.80, 0.79, 0.76];
    face([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, 1], [0.42, 0.38, 0.34]);
    face([x0, y0, H], [x0, y1, H], [x1, y1, H], [x1, y0, H], [0, 0, -1], [0.86, 0.86, 0.85]);
    face([x0, y0, 0], [x0, y0, H], [x1, y0, H], [x1, y0, 0], [0, 1, 0], wall);
    face([x0, y1, 0], [x1, y1, 0], [x1, y1, H], [x0, y1, H], [0, -1, 0], wall);
    face([x0, y0, 0], [x0, y1, 0], [x0, y1, H], [x0, y0, H], [1, 0, 0], wall);
    face([x1, y0, 0], [x1, y0, H], [x1, y1, H], [x1, y1, 0], [-1, 0, 0], wall);
  }

  // Shell preview surfaces (smooth faces; holes come from the mask in the shader).
  function setShell(k, G) {
    meshes.lamp[k].forEach(m => m.m.free()); meshes.lamp[k] = [];
    const U = { shape: 0, R: 1, T: 0, zBot: 1, zTop: 0, sLo: 0, sMid: 1, sHi: 2, n1: 1, n2: 0, rows: 1, cols: 1, rot: 0, cap: 0, sC: 0, rhoC: 0 };
    gl.bindTexture(gl.TEXTURE_2D, tex[k]); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (!G || !G.ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
      shellU[k] = U; texParams(); return;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, G.Nc, G.Nb, 0, gl.RED, gl.UNSIGNED_BYTE, G.tex); texParams();
    Object.assign(U, { shape: G.sph ? 1 : 0, R: G.R, T: G.t, zBot: G.zBot, zTop: G.zTop, sLo: G.sLo, sMid: G.sMid, sHi: G.sHi, n1: G.n1, n2: G.n2, rows: G.Nb, cols: G.Nc, cap: G.cap ? 1 : 0, sC: G.sC, rhoC: G.rhoC });
    shellU[k] = U;
    const rows = G.rows, step = Math.max(1, Math.floor(G.Nb / 110)), pick = [];
    for (let j = 0; j < rows.length; j++) if (rows[j].band < 0 || rows[j].band % step === 0 || j === rows.length - 1) pick.push(rows[j]);
    const C = 200, last = pick.length - 1;
    for (const fc of [0, 1]) {
      const pos = [], nrm = [], idx = [], sg = fc ? 1 : -1;
      const P = j => fc ? [pick[j].ro, pick[j].zo] : [pick[j].ri, pick[j].zi];
      pick.forEach((r, j) => {
        const [rho, z] = P(j), a0 = P(Math.max(0, j - 1)), a1 = P(Math.min(last, j + 1));
        let tr = a1[0] - a0[0], tz = a1[1] - a0[1]; const tl = Math.hypot(tr, tz) || 1; tr /= tl; tz /= tl;
        const nr = sg * tz, nz = -sg * tr; // outward for the outer face, towards the light for the inner face
        for (let i = 0; i <= C; i++) {
          const a = i / C * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          pos.push(rho * c, rho * s, z); nrm.push(nr * c, nr * s, nz);
          if (j > 0 && i < C) { const a0i = (j - 1) * (C + 1) + i, b0 = j * (C + 1) + i; idx.push(a0i, a0i + 1, b0 + 1, a0i, b0 + 1, b0); }
        }
      });
      if (G.cap) { // hub disc
        const cz = P(last)[1], ci = pos.length / 3; pos.push(0, 0, cz); nrm.push(0, 0, sg);
        for (let i = 0; i < C; i++) idx.push(last * (C + 1) + i, last * (C + 1) + i + 1, ci);
      }
      meshes.lamp[k].push({ m: mesh(pos, nrm, idx), kind: 1 });
    }
    for (const [r, nz] of G.cap ? [[rows[0], -1]] : [[rows[0], -1], [rows[rows.length - 1], 1]]) {
      const pos = [], nrm = [], idx = [];
      for (let i = 0; i <= C; i++) {
        const a = i / C * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(r.ri * c, r.ri * s, r.zi, r.ro * c, r.ro * s, r.zo); nrm.push(0, 0, nz, 0, 0, nz);
        if (i < C) idx.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
      }
      meshes.lamp[k].push({ m: mesh(pos, nrm, idx), kind: 0 });
    }
  }
  function texParams() {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function setEmitter(src) {
    if (meshes.emitter) meshes.emitter.free();
    let rx = 1.2, rz = 1.2;
    if (src.type === 'disc') { rx = Math.max(0.8, src.size / 2); rz = 0.5; }
    if (src.type === 'line') { rx = 0.8; rz = src.length / 2; }
    if (src.type === 'sphere') { rx = rz = src.size / 2; }
    const pos = [], nrm = [], idx = [], A = 16, B = 10;
    for (let b = 0; b <= B; b++) for (let a = 0; a <= A; a++) {
      const th = b / B * Math.PI, ph = a / A * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph), z = Math.cos(th);
      pos.push(x * rx, y * rx, z * rz + src.z); nrm.push(x, y, z);
      if (a < A && b < B) { const i0 = b * (A + 1) + a, i1 = i0 + A + 1; idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1); }
    }
    meshes.emitter = mesh(pos, nrm, idx);
  }

  // Targets
  let W = 0, H = 0, fb = null;
  function targets(w, h) {
    if (w === W && h === H && fb) return; W = w; H = h;
    if (fb) { gl.deleteFramebuffer(fb.f); gl.deleteFramebuffer(fb.a); gl.deleteTexture(fb.ft); gl.deleteTexture(fb.at); gl.deleteRenderbuffer(fb.d); }
    if (!floatOK) { fb = null; return; }
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    const ft = mk(), at = mk(), d = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ft, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
    const a = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, a); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, at, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fb = { f, a, ft, at, d };
  }

  // P: {vp, lamp:[x,y,z], rot:[a,b], src, samples, frame, power, lightCol, ambient, exposure, jitter, count}
  function draw(P) {
    const direct = !fb;
    gl.useProgram(scene.p); const U = scene.U;
    gl.uniformMatrix4fv(U.uVP, false, P.vp); gl.uniform2fv(U.uJitter, P.jitter);
    gl.uniform3fv(U.uLamp, P.lamp);
    for (let k = 0; k < 2; k++) {
      const s = shellU[k]; if (!s) continue;
      for (const key in s) { const loc = U[`uS[${k}].${key}`]; if (loc) gl.uniform1f(loc, key === 'rot' ? P.rot[k] : s[key]); }
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[0]); gl.uniform1i(U.uMaskA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex[1]); gl.uniform1i(U.uMaskB, 1);
    const st = { point: 0, disc: 1, line: 2, sphere: 3 }[P.src.type];
    gl.uniform1i(U.uSrcType, st); gl.uniform1f(U.uSrcSize, P.src.size); gl.uniform1f(U.uSrcLen, P.src.length); gl.uniform1f(U.uSrcZ, P.src.z);
    gl.uniform1i(U.uEmit, { omni: 0, up: 1, down: 2 }[P.src.emit]);
    gl.uniform1i(U.uSamples, P.samples); gl.uniform1f(U.uFrame, P.frame); gl.uniform1f(U.uPower, P.power);
    gl.uniform3fv(U.uLightCol, P.lightCol); gl.uniform1f(U.uAmbient, P.ambient);
    gl.uniform1i(U.uDirect, direct ? 1 : 0); gl.uniform1f(U.uExposure, P.exposure);
    gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : fb.f);
    gl.viewport(0, 0, W, H); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const drawM = (m, kind, shell, alb, off) => {
      gl.uniform1i(U.uKind, kind); gl.uniform1i(U.uShell, shell); gl.uniform3fv(U.uAlbedo, alb); gl.uniform3fv(U.uOffset, off);
      gl.bindVertexArray(m.v); gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    };
    for (const r of meshes.room) drawM(r.m, 0, 0, r.alb, [0, 0, 0]);
    for (let k = 0; k < 2; k++) for (const s of meshes.lamp[k]) drawM(s.m, s.kind, k, [0.1, 0.1, 0.1], P.lamp);
    if (meshes.emitter) drawM(meshes.emitter, 2, 0, [1, 1, 1], P.lamp);
    gl.bindVertexArray(null);
    if (direct) return;
    // accumulate
    gl.disable(gl.DEPTH_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, fb.a);
    if (P.count === 0) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(acc.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fb.ft); gl.uniform1i(acc.U.uTex, 0);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    present(P.count + 1, P.exposure);
  }
  function present(n, exposure) {
    if (!fb) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(disp.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fb.at);
    gl.uniform1i(disp.U.uTex, 0); gl.uniform1f(disp.U.uInv, 1 / n); gl.uniform1f(disp.U.uExposure, exposure);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
  }
  return { gl, floatOK, setRoom, setShell, setEmitter, targets, draw, present, size: () => [W, H] };
}
if (typeof module !== 'undefined') module.exports = { createRenderer, M4 };
