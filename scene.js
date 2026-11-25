import * as THREE from "three";

/*
  Liquid-chrome form. One mesh, displaced in the vertex shader with simplex noise,
  lit only by a hand-built studio environment (soft overhead box, side strips,
  dark floor) so the reflections read as a product shot rather than a glow.
  Each chapter of the page sets a target pose + surface character; the form
  eases between them.
*/

const root = document.documentElement;
const canvas = document.querySelector(".stage");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ue = (window.__ue = window.__ue || { scene: "index", velocity: 0, hover: 0, pointer: { x: 0, y: 0 } });

const SCENES = {
  desktop: {
    index: { x: 0.26, y: 0.06, s: 0.56, amp: 0.12, freq: 0.8, twist: 0.0, speed: 1.0 },
    keyveve: { x: -0.5, y: 0.0, s: 0.42, amp: 0.15, freq: 0.9, twist: 0.45, speed: 1.1 },
    record: { x: 0.76, y: 0.02, s: 0.24, amp: 0.09, freq: 0.95, twist: 0.2, speed: 0.8 },
    about: { x: 0.1, y: -1.0, s: 0.6, amp: 0.1, freq: 0.9, twist: 0.0, speed: 0.6 },
    online: { x: 0.54, y: 0.02, s: 0.46, amp: 0.15, freq: 0.85, twist: 0.3, speed: 1.0 },
  },
  mobile: {
    index: { x: 0.0, y: 0.28, s: 0.4, amp: 0.12, freq: 0.8, twist: 0.0, speed: 1.0 },
    keyveve: { x: 0.0, y: 0.48, s: 0.27, amp: 0.15, freq: 0.9, twist: 0.45, speed: 1.1 },
    record: { x: 0.6, y: 0.7, s: 0.15, amp: 0.09, freq: 0.95, twist: 0.2, speed: 0.8 },
    about: { x: 0.0, y: 0.5, s: 0.27, amp: 0.1, freq: 0.9, twist: 0.0, speed: 0.6 },
    online: { x: 0.0, y: 0.44, s: 0.3, amp: 0.15, freq: 0.85, twist: 0.3, speed: 1.0 },
  },
};

const NOISE = /* glsl */ `
  vec3 ue_mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 ue_mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 ue_permute(vec4 x){ return ue_mod289(((x * 34.0) + 1.0) * x); }
  vec4 ue_taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float ue_snoise(vec3 v){
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = ue_mod289(i);
    vec4 p = ue_permute(ue_permute(ue_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 q0 = vec3(a0.xy, h.x);
    vec3 q1 = vec3(a0.zw, h.y);
    vec3 q2 = vec3(a1.xy, h.z);
    vec3 q3 = vec3(a1.zw, h.w);
    vec4 norm = ue_taylorInvSqrt(vec4(dot(q0, q0), dot(q1, q1), dot(q2, q2), dot(q3, q3)));
    q0 *= norm.x; q1 *= norm.y; q2 *= norm.z; q3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(q0, x0), dot(q1, x1), dot(q2, x2), dot(q3, x3)));
  }

  uniform float uTime;
  uniform float uAmp;
  uniform float uFreq;
  uniform float uTwist;

  vec3 ue_displace(vec3 p){
    vec3 q = p;
    float a = uTwist * q.y;
    float c = cos(a);
    float s = sin(a);
    q.xz = mat2(c, -s, s, c) * q.xz;
    float n = ue_snoise(q * uFreq + vec3(0.0, uTime * 0.16, uTime * 0.09));
    n += 0.14 * ue_snoise(q * uFreq * 1.9 - vec3(uTime * 0.13));
    return p + normalize(p) * n * uAmp;
  }
`;

function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 top = vec3(0.78, 0.8, 0.83);
          vec3 horizon = vec3(0.34, 0.36, 0.4);
          vec3 floorc = vec3(0.025, 0.028, 0.034);
          vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.55)) : mix(horizon, floorc, pow(-y, 0.28));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  );
  env.add(dome);

  const box = (w, h, pos, color) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  box(9, 2.4, new THREE.Vector3(0, 9, 4), new THREE.Color(5, 5, 5));
  box(1.4, 12, new THREE.Vector3(-10, 1, 3), new THREE.Color(3.2, 3.2, 3.3));
  box(1.0, 10, new THREE.Vector3(9, 0, -4), new THREE.Color(1.6, 1.9, 2.6));
  box(6, 0.5, new THREE.Vector3(0, -1.2, 9), new THREE.Color(1.4, 1.4, 1.4));
  // Black flags: carve dark edges into the silhouette so it holds against a pale page.
  box(5, 14, new THREE.Vector3(-8, 0, 8), new THREE.Color(0.01, 0.01, 0.012));
  box(4, 14, new THREE.Vector3(9, 0, 6), new THREE.Color(0.015, 0.015, 0.018));
  box(14, 3, new THREE.Vector3(0, 4.5, -9), new THREE.Color(0.02, 0.02, 0.025));

  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

function start() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    root.classList.add("no-webgl");
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  const small = window.innerWidth < 760;
  const segments = small ? 150 : 240;
  const geometry = new THREE.SphereGeometry(1, segments, segments);

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.2 },
    uFreq: { value: 1.05 },
    uTwist: { value: 0 },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.82, 0.84, 0.87),
    metalness: 1,
    roughness: 0.06,
    clearcoat: 0.6,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.0,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${NOISE}`)
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        vec3 uePos = ue_displace(position);
        vec3 ueN = normalize(normal);
        vec3 ueT = normalize(abs(ueN.y) > 0.98 ? cross(ueN, vec3(1.0, 0.0, 0.0)) : cross(ueN, vec3(0.0, 1.0, 0.0)));
        vec3 ueB = normalize(cross(ueN, ueT));
        float ueE = 0.01;
        vec3 ueP1 = ue_displace(normalize(position + ueT * ueE));
        vec3 ueP2 = ue_displace(normalize(position + ueB * ueE));
        vec3 objectNormal = normalize(cross(ueP1 - uePos, ueP2 - uePos));
        if (dot(objectNormal, ueN) < 0.0) objectNormal = -objectNormal;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif
        `,
      )
      .replace("#include <begin_vertex>", "vec3 transformed = uePos;");
  };

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  let halfH = 1;
  let halfW = 1;
  let mode = "desktop";

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    halfW = halfH * camera.aspect;
    mode = w < 760 ? "mobile" : "desktop";
  };
  resize();
  window.addEventListener("resize", resize);

  const cur = { ...SCENES[mode].index };
  const tilt = { x: 0, y: 0 };
  let ampBoost = 0;
  let hover = 0;
  let introStart = null;
  let t = 0;
  let last = performance.now();

  const intro = () => {
    introStart = performance.now();
  };
  if (root.classList.contains("is-ready")) intro();
  else window.addEventListener("ue:ready", intro, { once: true });

  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const target = SCENES[mode][ue.scene] || SCENES[mode].index;
    const k = reduce ? 1 : 1 - Math.pow(0.0018, dt);
    for (const key of Object.keys(cur)) cur[key] += (target[key] - cur[key]) * k;

    const velocity = Math.min(Math.abs(ue.velocity || 0) * 0.004, 0.1);
    ampBoost += (velocity - ampBoost) * (1 - Math.pow(0.02, dt));
    hover += ((ue.hover || 0) - hover) * (1 - Math.pow(0.01, dt));

    const introT = reduce ? 1 : introStart === null ? 0 : Math.min(1, (now - introStart) / 2400);
    const ease = 1 - Math.pow(1 - introT, 4);

    if (!reduce) t += dt * cur.speed;
    uniforms.uTime.value = t;
    uniforms.uAmp.value = cur.amp + ampBoost + hover * 0.08 + (1 - ease) * 0.3;
    uniforms.uFreq.value = cur.freq;
    uniforms.uTwist.value = cur.twist + hover * 0.35;

    const p = ue.pointer || { x: 0, y: 0 };
    tilt.x += (p.y * 0.35 - tilt.x) * (1 - Math.pow(0.04, dt));
    tilt.y += (p.x * 0.5 - tilt.y) * (1 - Math.pow(0.04, dt));

    mesh.position.set(cur.x * halfW + p.x * 0.06, cur.y * halfH - p.y * 0.04, 0);
    mesh.scale.setScalar(cur.s * halfH * (0.55 + 0.45 * ease));
    mesh.rotation.set(tilt.x + t * 0.05, tilt.y + t * 0.12, 0);

    renderer.render(scene, camera);
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
