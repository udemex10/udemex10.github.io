/*
  Liquid mercury — a raymarched signed-distance field, no 3D library.

  The form is one SDF that blends between five shapes (sphere, ring, rounded cube,
  twisted column, the "U" monogram). Blending distance fields, rather than meshes,
  is what lets one shape melt into the next like a liquid. Droplets are extra
  spheres smooth-unioned into the body: drag the form and they stretch out on a
  neck, snap off when pulled far enough, then spring home and merge.

  Lighting is an analytic studio (pale sky, hard horizon, dark floor, two softbox
  strips, two black flags), so the chrome reads as a product shot on the pale page.
*/

const root = document.documentElement;
const canvas = document.querySelector(".stage");
const hint = document.querySelector(".hint");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ue = (window.__ue = window.__ue || { scene: "index", velocity: 0, hover: 0, pointer: { x: 0, y: 0 } });

const SHAPES = ["Sphere", "Ring", "Cube", "Twist", "Monogram"];
const CHAPTER_SHAPE = { index: 0, keyveve: 3, record: 2, about: 1, online: 4 };

const POSES = {
  desktop: {
    index: { x: 0.26, y: 0.04, s: 0.5 },
    keyveve: { x: -0.5, y: 0.0, s: 0.4 },
    record: { x: 0.76, y: 0.02, s: 0.24 },
    about: { x: 0.1, y: -0.98, s: 0.56 },
    online: { x: 0.54, y: 0.02, s: 0.42 },
  },
  mobile: {
    index: { x: 0.0, y: 0.3, s: 0.36 },
    keyveve: { x: 0.0, y: 0.48, s: 0.26 },
    record: { x: 0.6, y: 0.7, s: 0.15 },
    about: { x: 0.0, y: 0.5, s: 0.26 },
    online: { x: 0.0, y: 0.44, s: 0.28 },
  },
};

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTan;
uniform vec3 uCenter;
uniform float uScale;
uniform mat3 uRot;
uniform int uA;
uniform int uB;
uniform float uMix;
uniform float uTime;
uniform float uAmp;
uniform vec4 uDrops[4];
uniform vec4 uBound;
uniform vec2 uLight;     // studio rig yaw / pitch, follows the cursor
uniform vec4 uSquash;    // axis.xyz, stretch factor — the jelly spring
uniform vec4 uStretch;   // axis.xyz, stretch factor — elongation along flight
uniform vec4 uImpact;    // impact point (body units), age in seconds
uniform float uRipAmp;
uniform float uInflate;  // swell while melting between forms
uniform vec3 uShadow;    // shadow centre xy (world), strength
uniform float uHQ;       // 1 = self-reflection bounce + dispersion
uniform float uSS;       // supersamples per pixel: 1, 2 or 4

// Volume-preserving stretch by f along unit axis u (inverse map for the SDF).
vec3 deform(vec3 p, vec4 a) {
  float k = dot(p, a.xyz);
  vec3 perp = p - a.xyz * k;
  return perp * sqrt(a.w) + a.xyz * (k / a.w);
}

float lipschitz(float f) { return min(sqrt(f), 1.0 / f); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdRing(vec3 p) {
  vec2 q = vec2(length(p.xy) - 0.64, p.z);
  return length(q) - 0.27;
}

float sdTwist(vec3 p) {
  float a = p.y * 1.7;
  float c = cos(a), s = sin(a);
  p.xz = mat2(c, -s, s, c) * p.xz;
  return sdRoundBox(p, vec3(0.4, 0.84, 0.4), 0.17) * 0.72;
}

float sdMonogram(vec3 p) {
  p.y += 0.1;
  float r = 0.44, t = 0.12, h = 0.46;
  float d2 = p.y < 0.0
    ? abs(length(p.xy) - r) - t
    : length(vec2(abs(p.x) - r, max(p.y - h, 0.0))) - t;
  vec2 w = vec2(d2, abs(p.z) - 0.1);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 0.1;
}

float shape(int i, vec3 p) {
  if (i == 0) return length(p) - 0.9;
  if (i == 1) return sdRing(p);
  if (i == 2) return sdRoundBox(p, vec3(0.62), 0.24);
  if (i == 3) return sdTwist(p);
  return sdMonogram(p);
}

float map(vec3 pw) {
  vec3 rel = (pw - uCenter) / uScale;
  rel = deform(rel, uStretch);
  rel = deform(rel, uSquash);
  vec3 q = uRot * rel;
  float d = mix(shape(uA, q), shape(uB, q), uMix) - uInflate;
  d += uAmp * sin(q.x * 3.1 + uTime * 1.3) * sin(q.y * 2.7 + uTime * 1.05) * sin(q.z * 2.9 - uTime * 0.85);
  // Ripple: a ring band travelling outward from the impact point.
  float rr = length(rel - uImpact.xyz);
  float front = exp(-pow((rr - uImpact.w * 1.25) * 3.2, 2.0));
  d += uRipAmp * sin(rr * 17.0 - uImpact.w * 19.0) * front * exp(-uImpact.w * 1.7);
  d *= uScale * lipschitz(uStretch.w) * lipschitz(uSquash.w);
  for (int i = 0; i < 4; i++) {
    vec4 dr = uDrops[i];
    if (dr.w > 0.001) d = smin(d, length(pw - dr.xyz) - dr.w, 0.24 * uScale);
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  float e = 0.0012;
  return normalize(
    k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
    k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// Soft-edged rectangle mask in a projected 2D plane.
float panel(vec2 uv, vec2 c, vec2 halfSize, float soft) {
  vec2 q = abs(uv - c) - halfSize;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-soft * 0.5, soft, d);
}

// A real softbox is hottest in the middle and falls off toward its frame.
float softbox(vec2 uv, vec2 c, vec2 halfSize, float soft) {
  vec2 q = (uv - c) / halfSize;
  float fall = clamp(1.0 - 0.55 * dot(q, q), 0.0, 1.0);
  return panel(uv, c, halfSize, soft) * (0.35 + 0.65 * fall);
}

// Dark product studio. Polished metal is mostly a mirror of darkness, painted
// with a few large, soft-falloff lights — that is what reads as expensive.
vec3 env(vec3 d) {
  float a = uLight.x;
  d.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * d.xz;
  float b = uLight.y;
  d.yz = mat2(cos(b), -sin(b), sin(b), cos(b)) * d.yz;

  float y = d.y;
  vec3 ceil = vec3(0.04, 0.043, 0.05);
  vec3 wall = vec3(0.115, 0.12, 0.132);
  vec3 flo = vec3(0.03, 0.032, 0.037);
  vec3 c = y > 0.0 ? mix(wall, ceil, smoothstep(0.0, 0.75, y)) : mix(wall, flo, smoothstep(0.0, 0.35, -y));
  // floor sweep catching spill: a broad, soft glow just under the horizon
  c += vec3(0.4, 0.41, 0.43) * exp(-pow((y + 0.12) * 6.0, 2.0));

  // overhead key: large softbox
  if (d.y > 0.02) {
    vec2 uv = d.xz / d.y;
    c += vec3(6.5, 6.6, 6.8) * softbox(uv, vec2(0.0, 0.55), vec2(0.85, 0.42), 0.12);
  }
  // tall left fill
  if (d.x < -0.02) {
    vec2 uv = d.yz / -d.x;
    c += vec3(3.6, 3.7, 3.9) * softbox(uv, vec2(0.15, 0.45), vec2(1.05, 0.24), 0.1);
  }
  // right rim strip, cool
  if (d.x > 0.02) {
    vec2 uv = d.yz / d.x;
    c += vec3(1.7, 2.1, 2.9) * softbox(uv, vec2(0.0, -0.35), vec2(0.95, 0.07), 0.05);
  }
  // ring light behind the camera: a circular catchlight on the metal
  if (d.z > 0.02) {
    vec2 uv = d.xy / d.z;
    float rr = length(uv - vec2(-0.32, 0.34));
    c += vec3(1.4) * (1.0 - smoothstep(0.0, 0.025, abs(rr - 0.14) - 0.012));
  }
  // back kicker, low and wide: separates the lower silhouette
  if (d.z < -0.02) {
    vec2 uv = d.xy / -d.z;
    c += vec3(1.1, 1.15, 1.25) * softbox(uv, vec2(0.0, -0.25), vec2(1.4, 0.16), 0.15);
  }
  return c;
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.06 * uScale * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 1.7 * occ / uScale, 0.0, 1.0);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Trace + shade one camera ray. Returns linear premultiplied colour and coverage.
vec4 shadeRay(vec3 ro, vec3 rd, float pix, vec2 jit) {
  vec3 oc = ro - uBound.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uBound.w * uBound.w;
  float h = b * b - c;
  if (h < 0.0) return vec4(0.0);
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float tEnd = -b + h;

  float minD = 1e9;
  float tMin = t;
  bool hit = false;
  for (int i = 0; i < 120; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < minD) { minD = d; tMin = t; }
    if (d < 0.0004 * t) { hit = true; break; }
    t += d * 0.82;
    if (t > tEnd) break;
  }

  float alpha = hit ? 1.0 : 1.0 - smoothstep(0.0, pix, minD);
  if (alpha <= 0.0) return vec4(0.0);

  vec3 p = ro + rd * (hit ? t : tMin);
  vec3 n = calcNormal(p);
  float ndv = clamp(dot(n, -rd), 0.0, 1.0);
  // Per-sample micro-roughness: the samples average into a creamy, real reflection.
  vec3 r = normalize(reflect(rd, n) + vec3(jit, -jit.x * jit.y * 4.0) * 0.022);

  vec3 refl = uHQ > 0.5
    ? vec3(env(normalize(r + n * 0.012)).r, env(r).g, env(normalize(r - n * 0.012)).b)
    : env(r);

  if (uHQ > 0.5) {
    vec3 o2 = p + n * 0.004 * uScale;
    float tr = 0.02 * uScale;
    bool rh = false;
    for (int i = 0; i < 48; i++) {
      float dd = map(o2 + r * tr);
      if (dd < 0.001 * uScale) { rh = true; break; }
      tr += dd * 0.9;
      if (tr > 3.2 * uScale) break;
    }
    if (rh) {
      vec3 p2 = o2 + r * tr;
      vec3 n2 = calcNormal(p2);
      refl = env(reflect(r, n2)) * vec3(0.82, 0.84, 0.88);
    }
  }

  float fr = pow(1.0 - ndv, 5.0);
  vec3 tint = vec3(0.8, 0.82, 0.86);
  vec3 col = refl * mix(tint, vec3(1.0), fr);

  float th = 1.0 - ndv;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + th * 1.7 + 0.12));
  col *= mix(vec3(1.0), film * 1.2, 0.14 * smoothstep(0.45, 1.0, th));

  col *= mix(0.5, 1.0, calcAO(p, n));
  return vec4(col * alpha, alpha);
}

void main() {
  vec3 ro = vec3(0.0, 0.0, 6.0);
  float pix = 2.0 * uTan * 6.0 / uRes.y;

  // Soft contact shadow on the z = 0 plane, from the pixel-centre ray.
  vec2 uv0 = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 rd0 = normalize(vec3(uv0 * uTan, -1.0));
  vec2 pz = (ro + rd0 * (6.0 / max(-rd0.z, 1e-3))).xy;
  vec2 sd = (pz - uShadow.xy) / (vec2(0.95, 0.15) * uScale);
  float sd2 = dot(sd, sd);
  float shadow = (exp(-sd2 * 1.7) * 0.75 + exp(-sd2 * 6.0) * 0.25) * uShadow.z;

  // Supersampling on a rotated grid (1, 2 or 4 rays per pixel).
  vec4 acc = vec4(0.0);
  float n = 0.0;
  for (int s = 0; s < 4; s++) {
    if (float(s) >= uSS) break;
    vec2 off = uSS > 2.5
      ? (s == 0 ? vec2(0.125, 0.375) : s == 1 ? vec2(0.375, -0.125) : s == 2 ? vec2(-0.125, -0.375) : vec2(-0.375, 0.125))
      : uSS > 1.5
        ? (s == 0 ? vec2(0.25, 0.25) : vec2(-0.25, -0.25))
        : vec2(0.0);
    vec2 uv = (gl_FragCoord.xy + off - 0.5 * uRes) / (0.5 * uRes.y);
    vec3 rd = normalize(vec3(uv * uTan, -1.0));
    vec4 sampleCol = shadeRay(ro, rd, pix, off);
    // Tone-map per sample so bright edges anti-alias cleanly.
    sampleCol.rgb = sampleCol.a > 0.0 ? aces(sampleCol.rgb / sampleCol.a * 1.2) * sampleCol.a : vec3(0.0);
    acc += sampleCol;
    n += 1.0;
    // Pixels nowhere near the form need no extra rays.
    if (s == 0 && sampleCol.a <= 0.0 && uBound.w > 0.0) {
      vec3 oc = ro - uBound.xyz;
      float bb = dot(oc, rd);
      if (bb * bb - (dot(oc, oc) - uBound.w * uBound.w) < 0.0) break;
    }
  }
  acc /= max(n, 1.0);
  vec3 col = acc.a > 0.0 ? pow(acc.rgb / acc.a, vec3(1.0 / 2.2)) * acc.a : vec3(0.0);
  outColor = vec4(col, acc.a + shadow * (1.0 - acc.a));
}`;

function start() {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) {
    root.classList.add("no-webgl");
    return;
  }

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  [
    "uRes", "uTan", "uCenter", "uScale", "uRot", "uA", "uB", "uMix", "uTime", "uAmp", "uDrops", "uBound",
    "uLight", "uSquash", "uStretch", "uImpact", "uRipAmp", "uInflate", "uShadow", "uHQ", "uSS",
  ].forEach(
    (n) => (U[n] = gl.getUniformLocation(prog, n)),
  );

  const TAN = Math.tan((15 * Math.PI) / 180);
  gl.uniform1f(U.uTan, TAN);
  gl.clearColor(0, 0, 0, 0);

  let halfH = TAN * 6;
  let halfW = halfH;
  let mode = "desktop";

  // Quality ladder: [render scale × devicePixelRatio, samples per pixel].
  // Starts high and steps down only if frames get slow, so it stays smooth.
  const LADDER = [
    [1.0, 4],
    [1.0, 2],
    [0.85, 2],
    [0.85, 1],
    [0.7, 1],
    [0.55, 1],
  ];
  let level = window.innerWidth < 760 ? 3 : 0;

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    mode = w < 760 ? "mobile" : "desktop";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const [scale, ss] = LADDER[level];
    const rs = dpr * scale;
    gl.uniform1f(U.uHQ, mode === "mobile" ? 0 : 1);
    gl.uniform1f(U.uSS, ss);
    canvas.width = Math.max(1, Math.round(w * rs));
    canvas.height = Math.max(1, Math.round(h * rs));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    halfW = halfH * (w / h);
  };
  resize();
  window.addEventListener("resize", resize);

  /* State ------------------------------------------------------------------ */

  const pose = { ...POSES[mode].index };
  let S = pose.s * halfH;
  const center = { x: 0, y: 0 };

  let formA = 0;
  let formB = 0;
  let morphT = 0;
  let lastScene = ue.scene;
  let jiggle = 0;
  let t = 0;
  let intro = reduce ? 1 : 0;
  let introStarted = reduce;

  const drops = Array.from({ length: 4 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0 }));
  const pointer = { x: 0, y: 0, inside: false, active: false };
  let dragging = false;
  let down = null;
  const tilt = { x: 0, y: 0 };
  const anchorDir = { x: 0, y: -1 };
  const light = { x: 0, y: 0 };

  // Jelly spring: log-stretch along Y. Positive = tall, negative = squashed.
  let sq = 0;
  let sqv = 0;
  const kick = (v) => {
    if (!reduce) sqv += v;
  };

  // Flight stretch: elongate along the direction of travel between chapters.
  const prevCenter = { x: 0, y: 0, ready: false };
  const flight = { x: 0, y: 1, f: 1 };

  // Surface ripple from an impact point.
  const impact = { x: 0, y: 0, z: 1, age: 9, amp: 0 };
  const ripple = (wx, wy, amp) => {
    if (reduce) return;
    let x = (wx - center.x) / S;
    let y = (wy - center.y) / S;
    const l = Math.hypot(x, y);
    if (l > 0.85) {
      x *= 0.85 / l;
      y *= 0.85 / l;
    }
    impact.x = x;
    impact.y = y;
    impact.z = Math.sqrt(Math.max(0.04, 0.85 - x * x - y * y));
    impact.age = 0;
    impact.amp = amp;
  };

  let wasBroken = false;
  let returning = false;
  let morphLanded = true;

  const announce = (k) => {
    if (!hint) return;
    hint.textContent = `Form ${String(k + 1).padStart(2, "0")} / 05 — ${SHAPES[k]}`;
  };

  const morphTo = (k) => {
    if (k === formB && formA === formB) return;
    if (formA !== formB) formA = morphT > 0.5 ? formB : formA;
    formB = k;
    morphT = reduce ? 1 : 0;
    morphLanded = false;
    jiggle = Math.min(1, jiggle + 0.4);
    kick(-1.1);
  };

  /* Interaction ------------------------------------------------------------ */

  const toWorld = (cx, cy) => ({
    x: (cx / window.innerWidth) * 2 * halfW - halfW,
    y: halfH - (cy / window.innerHeight) * 2 * halfH,
  });

  const interactive = () => {
    if (!root.classList.contains("is-ready")) return false;
    if (mode === "mobile") return ue.scene === "index" || ue.scene === "online";
    return true;
  };

  const overForm = (wx, wy) => Math.hypot(wx - center.x, wy - center.y) < S * 1.02;

  const isControl = (el) => !!(el && el.closest && el.closest("a, button, input, textarea, select, label"));

  const updateCursor = () => {
    root.classList.toggle("can-grab", pointer.inside && !dragging);
    root.classList.toggle("is-grabbing", dragging);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      const w = toWorld(e.clientX, e.clientY);
      pointer.x = w.x;
      pointer.y = w.y;
      pointer.active = true;
      pointer.inside = interactive() && !isControl(e.target) && overForm(w.x, w.y);
      updateCursor();
    },
    { passive: true },
  );

  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || isControl(e.target) || !interactive()) return;
    const w = toWorld(e.clientX, e.clientY);
    if (!overForm(w.x, w.y)) return;
    pointer.x = w.x;
    pointer.y = w.y;
    dragging = true;
    down = { x: e.clientX, y: e.clientY, time: performance.now() };
    e.preventDefault();
    ue.lenis?.stop();
    // Seed the chain on the surface under the cursor so it grows out of the body.
    const gd = Math.hypot(w.x - center.x, w.y - center.y) || 1e-4;
    anchorDir.x = (w.x - center.x) / gd;
    anchorDir.y = (w.y - center.y) / gd;
    drops.forEach((d) => {
      d.x = center.x + anchorDir.x * S * 0.62;
      d.y = center.y + anchorDir.y * S * 0.62;
      d.vx = d.vy = 0;
    });
    kick(-0.7);
    updateCursor();
  });

  // Keep touch drags on the form from scrolling the page.
  window.addEventListener(
    "touchstart",
    (e) => {
      if (!interactive() || isControl(e.target)) return;
      const touch = e.touches[0];
      const w = toWorld(touch.clientX, touch.clientY);
      if (overForm(w.x, w.y)) e.preventDefault();
    },
    { passive: false },
  );

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    const moved = e && down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
    const quick = down && performance.now() - down.time < 420;
    if (moved < 7 && quick) {
      const next = (formB + 1) % SHAPES.length;
      ripple(pointer.x, pointer.y, 0.06);
      morphTo(next);
      announce(next);
    } else {
      returning = true;
      kick(1.4);
    }
    down = null;
    ue.lenis?.start();
    updateCursor();
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", () => release(null));

  const begin = () => {
    introStarted = true;
    if (reduce) return;
    sq = -0.42;
    sqv = 0;
    jiggle = 0.6;
    impact.x = 0;
    impact.y = 0.2;
    impact.z = 0.8;
    impact.age = 0;
    impact.amp = 0.05;
  };
  if (root.classList.contains("is-ready")) begin();
  else window.addEventListener("ue:ready", begin, { once: true });

  /* Frame ------------------------------------------------------------------ */

  const rotX = (a) => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
  const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
  const mul = (a, b) => {
    const o = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  };
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const dropData = new Float32Array(16);

  let last = performance.now();
  let perfAcc = 0;
  let perfN = 0;
  let calm = 0;
  let slowStreak = 0;
  const govern = (ms) => {
    if (document.hidden) {
      perfAcc = 0;
      perfN = 0;
      slowStreak = 0;
      return;
    }
    // Fast path: a run of clearly slow frames steps down immediately.
    slowStreak = ms > 45 ? slowStreak + 1 : 0;
    if (slowStreak >= 8 && level < LADDER.length - 1) {
      slowStreak = 0;
      perfAcc = 0;
      perfN = 0;
      level += 1;
      resize();
      return;
    }
    perfAcc += ms;
    perfN += 1;
    if (perfN < 45) return;
    const avg = perfAcc / perfN;
    perfAcc = 0;
    perfN = 0;
    if (avg > 21 && level < LADDER.length - 1) {
      level += 1;
      calm = 0;
      resize();
    } else if (avg < 12) {
      calm += 1;
      if (calm >= 6 && level > (mode === "mobile" ? 2 : 0)) {
        level -= 1;
        calm = 0;
        resize();
      }
    } else {
      calm = 0;
    }
  };

  const frame = (now) => {
    const rawMs = now - last;
    const dt = Math.min(0.05, rawMs / 1000);
    last = now;
    if (rawMs > 0 && rawMs < 2000) govern(Math.min(rawMs, 250));

    // Chapter → pose + form
    if (ue.scene !== lastScene) {
      lastScene = ue.scene;
      if (ue.scene in CHAPTER_SHAPE) morphTo(CHAPTER_SHAPE[ue.scene]);
    }
    const target = POSES[mode][ue.scene] || POSES[mode].index;
    const k = reduce ? 1 : 1 - Math.pow(0.002, dt);
    pose.x += (target.x - pose.x) * k;
    pose.y += (target.y - pose.y) * k;
    pose.s += (target.s - pose.s) * k;

    if (introStarted && intro < 1) intro = Math.min(1, intro + dt / 2.2);
    const introEase = 1 - Math.pow(1 - intro, 4);

    S = pose.s * halfH * (0.5 + 0.5 * introEase);
    const p = ue.pointer || { x: 0, y: 0 };
    center.x = pose.x * halfW + p.x * 0.05;
    center.y = pose.y * halfH - p.y * 0.035;

    // Morph: the liquid swells, tips toward you, pours into the new form,
    // then lands with a squash.
    let mix = 0;
    if (formA !== formB) {
      morphT = Math.min(1, morphT + dt / 1.35);
      mix = easeInOut(morphT);
      if (morphT >= 1) {
        formA = formB;
        mix = 0;
      }
    }
    if (!morphLanded && formA === formB) {
      morphLanded = true;
      kick(1.6);
    }
    const melt = formA !== formB ? Math.sin(mix * Math.PI) : 0;

    // Flight stretch from how fast the body is travelling between chapters.
    if (!prevCenter.ready) {
      prevCenter.x = center.x;
      prevCenter.y = center.y;
      prevCenter.ready = true;
    }
    const fvx = (center.x - prevCenter.x) / Math.max(dt, 1e-3);
    const fvy = (center.y - prevCenter.y) / Math.max(dt, 1e-3);
    prevCenter.x = center.x;
    prevCenter.y = center.y;
    const speed = Math.hypot(fvx, fvy);
    const fTarget = reduce ? 1 : 1 + Math.min((speed / Math.max(S, 1e-3)) * 0.09, 0.5);
    flight.f += (fTarget - flight.f) * (1 - Math.exp(-dt * 9));
    if (speed > 0.05) {
      flight.x += (fvx / speed - flight.x) * (1 - Math.exp(-dt * 10));
      flight.y += (fvy / speed - flight.y) * (1 - Math.exp(-dt * 10));
      const fl = Math.hypot(flight.x, flight.y) || 1;
      flight.x /= fl;
      flight.y /= fl;
    }

    // Droplets: spring chain from the body to the cursor while dragging;
    // a small bulge that leans toward the cursor while hovering.
    const dx = pointer.x - center.x;
    const dy = pointer.y - center.y;
    const dist = Math.hypot(dx, dy) || 1e-4;
    const broken = dist > S * 2.7;
    const hoverNear = !dragging && pointer.inside;
    // Anchor the chain on the surface facing the cursor, not the centre:
    // the ring and the monogram are hollow in the middle.
    if (dragging || hoverNear) {
      anchorDir.x = dx / dist;
      anchorDir.y = dy / dist;
    }
    const ax = center.x + anchorDir.x * S * 0.62;
    const ay = center.y + anchorDir.y * S * 0.62;

    // Surface tension events: the neck snapping, and the droplet merging home.
    if (dragging && broken && !wasBroken) {
      kick(1.2);
      ripple(ax, ay, 0.07);
    }
    wasBroken = dragging && broken;
    if (returning && !dragging) {
      const head = drops[drops.length - 1];
      if (Math.hypot(head.x - ax, head.y - ay) < S * 0.35) {
        returning = false;
        kick(-1.3);
        ripple(ax, ay, 0.06);
      }
    }
    drops.forEach((d, i) => {
      const f = (i + 1) / drops.length;
      let tx = ax;
      let ty = ay;
      let tr = 0;
      let fast = false;
      if (dragging) {
        tx = ax + (pointer.x - ax) * f;
        ty = ay + (pointer.y - ay) * f;
        tr = S * (0.15 + 0.17 * f);
        if (i === drops.length - 1) tr = S * 0.36;
        else if (broken) {
          tx = ax;
          ty = ay;
          tr = 0;
          fast = true;
        }
      } else if (hoverNear && i === drops.length - 1) {
        tx = center.x + anchorDir.x * S * 0.72;
        ty = center.y + anchorDir.y * S * 0.72;
        tr = S * 0.26;
      } else {
        // Fly home first, then dissolve into the body.
        const home = Math.hypot(d.x - ax, d.y - ay);
        tr = home > S * 0.3 ? d.r : 0;
      }
      const kk = dragging ? 150 - i * 22 : 70;
      d.vx += (tx - d.x) * kk * dt;
      d.vy += (ty - d.y) * kk * dt;
      const damp = Math.exp(-(dragging ? 11 : 8) * dt);
      d.vx *= damp;
      d.vy *= damp;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.r += (tr - d.r) * (1 - Math.exp(-dt * (tr > d.r ? 10 : fast ? 18 : 7)));
      dropData.set([d.x, d.y, 0, d.r < 0.002 ? 0 : d.r], i * 4);
    });

    // Jelly spring (under-damped: compresses, overshoots, settles).
    if (!reduce) {
      const scrollPush = Math.max(-0.6, Math.min(0.6, (ue.velocity || 0) * -0.012));
      const acc = -110 * sq - 7.5 * sqv + scrollPush * 6;
      sqv += acc * dt;
      sq += sqv * dt;
      sq = Math.max(-0.45, Math.min(0.45, sq));
    }
    const squashF = Math.exp(sq * 0.55);
    impact.age += dt;

    // Bounding sphere: body + every live droplet, padded for stretch.
    let bound = S * 1.3 * Math.max(squashF, 1 / Math.sqrt(squashF)) * flight.f;
    drops.forEach((d) => {
      if (d.r > 0.002) bound = Math.max(bound, Math.hypot(d.x - center.x, d.y - center.y) + d.r + S * 0.3);
    });

    // Motion
    if (!reduce) t += dt;
    jiggle *= Math.exp(-dt * 1.6);
    const vel = Math.min(Math.abs(ue.velocity || 0) * 0.0025, 0.05);
    const amp = reduce ? 0.012 : 0.016 + jiggle * 0.05 + vel + melt * 0.05 + (1 - introEase) * 0.08;

    tilt.x += (p.y * 0.3 - tilt.x) * (1 - Math.pow(0.05, dt));
    tilt.y += (p.x * 0.45 - tilt.y) * (1 - Math.pow(0.05, dt));
    const rot = mul(
      rotX(tilt.x + Math.sin(t * 0.31) * 0.12 + melt * 0.32),
      rotY(tilt.y + Math.sin(t * 0.37) * 0.55 + melt * 0.85),
    );

    light.x += (p.x * 0.38 - light.x) * (1 - Math.pow(0.03, dt));
    light.y += (-p.y * 0.16 - light.y) * (1 - Math.pow(0.03, dt));
    const shadowStrength = root.dataset.theme === "dark" ? 0 : 0.28 * introEase;

    gl.uniform3f(U.uCenter, center.x, center.y, 0);
    gl.uniform1f(U.uScale, S);
    gl.uniformMatrix3fv(U.uRot, false, rot);
    gl.uniform1i(U.uA, formA);
    gl.uniform1i(U.uB, formB);
    gl.uniform1f(U.uMix, mix);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uAmp, amp);
    gl.uniform4fv(U.uDrops, dropData);
    gl.uniform4f(U.uBound, center.x, center.y, 0, bound);
    gl.uniform2f(U.uLight, light.x, light.y);
    gl.uniform4f(U.uSquash, 0, 1, 0, squashF);
    gl.uniform4f(U.uStretch, flight.x, flight.y, 0, flight.f);
    gl.uniform4f(U.uImpact, impact.x, impact.y, impact.z, impact.age);
    gl.uniform1f(U.uRipAmp, impact.age < 4 ? impact.amp : 0);
    gl.uniform1f(U.uInflate, melt * 0.07);
    gl.uniform3f(U.uShadow, center.x, center.y - S * 1.24, shadowStrength);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  ue.sceneReady = true;
}

try {
  start();
} catch (e) {
  root.classList.add("no-webgl");
  console.warn(e);
}
