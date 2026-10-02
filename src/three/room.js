// The virtual living room — the laboratory itself. Evening interior lit by
// lamps and an HDRI, with a kitchen corner where the propane cylinder and the
// natural-gas (methane) pipe sit side by side, far from the NAFAS unit that
// hangs on the wall next to the door.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import apartmentHDR from '@pmndrs/assets/hdri/apartment.exr.js';
import { createDevice, glowTexture } from './device.js';
import * as TX from './textures.js';

const W = 10;
const D = 7.6;
const H = 3;
const X0 = -W / 2;
const Z0 = -D / 2;
const T = 0.18; // wall thickness

// ---------- small helpers ----------
function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const box = (w, h, d, mat, o) => mesh(new THREE.BoxGeometry(w, h, d), mat, o);
const rbox = (w, h, d, r, mat, seg = 4, o) => mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat, o);
const cyl = (rt, rb, h, mat, seg = 24, o) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, o);
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const phys = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, ...o });

// Phones, tablets and weak laptops get a lighter pipeline: lower resolution,
// no ambient occlusion or bloom, cheaper shadows and a 30 fps cap.
const LOW = (() => {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 820;
    const cores = navigator.hardwareConcurrency || 8;
    return coarse || small || cores <= 4 || /[?&]lite\b/.test(location.search);
  } catch { return false; }
})();

export function createRoom(canvasEl, { onDeviceClick } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The room is static, so shadow maps are only redrawn when something that
  // casts a shadow moves (the window sashes) instead of on every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  // Quiet backdrop: a dark gradient with a faint cool glow low on the horizon.
  scene.background = new THREE.Color(0x010203);
  const backdropMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float glow = exp(-pow((d.y + 0.25) / 0.45, 2.0));
        vec3 col = mix(vec3(0.004, 0.005, 0.007), vec3(0.006, 0.01, 0.018), glow);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), backdropMat);
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  scene.add(backdrop);
  new EXRLoader().load(apartmentHDR, (tex) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
  });
  scene.environmentIntensity = 0.32;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const HOME = { pos: new THREE.Vector3(8.6, 7.4, 11.4), target: new THREE.Vector3(-0.15, 0.3, -0.35) };
  camera.position.copy(HOME.pos);

  // ---------- materials ----------
  const floorTex = TX.woodFloor();
  const M = {
    floor: phys(0xffffff, { map: floorTex.map, roughnessMap: floorTex.rough, roughness: 0.9, clearcoat: 0.18, clearcoatRoughness: 0.55 }),
    wall: std(0xffffff, { map: TX.plaster('#d8d1c6', 3), roughness: 0.95 }),
    accent: std(0xffffff, { map: TX.plaster('#35504d', 4), roughness: 0.95 }),
    trim: std(0xf3f0ea, { roughness: 0.45 }),
    walnut: phys(0x5b3a26, { roughness: 0.45, clearcoat: 0.4 }),
    oak: phys(0xa47b52, { roughness: 0.5, clearcoat: 0.25 }),
    black: std(0x1a1c1e, { roughness: 0.4, metalness: 0.6 }),
    brass: std(0xc9a14a, { roughness: 0.28, metalness: 1 }),
    chrome: std(0xd9dde0, { roughness: 0.15, metalness: 1 }),
    steel: std(0xb7bec2, { roughness: 0.3, metalness: 1 }),
    gold: std(0xc8a04a, { roughness: 0.32, metalness: 1 }),
    sofa: phys(0xffffff, { map: TX.fabric('#b9ab98', 9), roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: 0xefe3d0 }),
    chair: phys(0xffffff, { map: TX.fabric('#3f6b66', 12), roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: 0x9fd8cf }),
    pillowA: phys(0xffffff, { map: TX.fabric('#c9823d', 13), roughness: 0.95, sheen: 0.8, sheenColor: 0xffd29a }),
    pillowB: phys(0xffffff, { map: TX.fabric('#2f5b58', 14), roughness: 0.95, sheen: 0.8, sheenColor: 0x9fd8cf }),
    rug: std(0xffffff, { map: TX.rug(), roughness: 1 }),
    tile: phys(0xffffff, { map: TX.tiles(), roughness: 0.25, clearcoat: 0.6 }),
    cabinet: std(0x2e4441, { roughness: 0.55 }),
    counter: phys(0xe7e3dc, { roughness: 0.25, clearcoat: 0.5 }),
    glassBlack: phys(0x0a0b0c, { roughness: 0.08, metalness: 0.2, clearcoat: 1 }),
    ceramic: phys(0xf2efe9, { roughness: 0.35, clearcoat: 0.6 }),
    terracotta: std(0xb46a45, { roughness: 0.85 }),
    soil: std(0x2e2118, { roughness: 1 }),
    pipe: phys(0xf2c12e, { roughness: 0.35, clearcoat: 0.6 }),
    red: phys(0xb3261e, { roughness: 0.35, clearcoat: 0.7 }),
    rubber: std(0x151515, { roughness: 0.8 }),
  };

  // ---------- shell ----------
  const floor = mesh(new THREE.BoxGeometry(W, 0.12, D), [M.trim, M.trim, M.floor, M.trim, M.trim, M.trim], { cast: false });
  at(floor, 0, -0.06, 0);
  scene.add(floor);
  const plinth = rbox(W + 0.4, 0.3, D + 0.4, 0.06, std(0x1a2427, { roughness: 0.9 }), 2, { cast: false });
  at(plinth, 0, -0.27, 0);
  scene.add(plinth);

  const addWallPiece = (mat, w, h, d, x, y, z) => scene.add(at(box(w, h, d, mat), x, y, z));
  // back wall with a window opening
  const win = { x0: 0.15, x1: 2.35, y0: 0.95, y1: 2.5 };
  for (const [xa, xb, ya, yb] of [[X0 - T, win.x0, 0, H], [win.x1, X0 + W, 0, H], [win.x0, win.x1, 0, win.y0], [win.x0, win.x1, win.y1, H]]) {
    addWallPiece(M.wall, xb - xa, yb - ya, T, (xa + xb) / 2, (ya + yb) / 2, Z0 - T / 2);
  }
  // left wall (accent) with a door opening
  const door = { z0: 2.2, z1: 3.15, h: 2.15 };
  for (const [za, zb, ya, yb] of [[Z0, door.z0, 0, H], [door.z1, Z0 + D, 0, H], [door.z0, door.z1, door.h, H]]) {
    addWallPiece(M.accent, T, yb - ya, zb - za, X0 - T / 2, (ya + yb) / 2, (za + zb) / 2);
  }
  // baseboards + crown moulding
  const baseRun = (len, x, z, alongX) => scene.add(at(box(alongX ? len : 0.025, 0.12, alongX ? 0.025 : len, M.trim), x, 0.06, z));
  const crownRun = (len, x, z, alongX) => scene.add(at(box(alongX ? len : 0.06, 0.08, alongX ? 0.06 : len, M.trim), alongX ? x : x + 0.02, H - 0.04, alongX ? z + 0.02 : z));
  baseRun(W, 0, Z0 + 0.012, true);
  crownRun(W, 0, Z0 + 0.012, true);
  // the baseboard stops at the door; the crown moulding runs the full wall
  baseRun(door.z0 - Z0, X0 + 0.012, (Z0 + door.z0) / 2, false);
  baseRun(Z0 + D - door.z1, X0 + 0.012, (door.z1 + Z0 + D) / 2, false);
  crownRun(D, X0 + 0.012, 0, false);
  const capMat = std(0x10181a);
  scene.add(at(box(W + T, 0.015, T, capMat), -T / 2, H + 0.008, Z0 - T / 2));
  scene.add(at(box(T, 0.015, D, capMat), X0 - T / 2, H + 0.008, 0));

  // ---------- door (six-panel, painted, brass lever) ----------
  const dw = door.z1 - door.z0;
  const casing = (w, h, x, y, z) => scene.add(at(box(0.05, h, w, M.trim), x, y, z));
  casing(0.09, door.h + 0.09, X0 + 0.02, (door.h + 0.09) / 2, door.z0 - 0.045);
  casing(0.09, door.h + 0.09, X0 + 0.02, (door.h + 0.09) / 2, door.z1 + 0.045);
  casing(dw + 0.18, 0.09, X0 + 0.02, door.h + 0.045, (door.z0 + door.z1) / 2);
  const doorG = new THREE.Group();
  const slabMat = phys(0xe9e5dd, { roughness: 0.4, clearcoat: 0.3 });
  doorG.add(at(rbox(0.045, door.h - 0.02, dw - 0.02, 0.01, slabMat, 2), 0, (door.h - 0.02) / 2, 0));
  const panelMat = phys(0xe2ddd3, { roughness: 0.45, clearcoat: 0.3 });
  const pz = (dw - 0.02) / 4;
  for (const [py, ph] of [[0.42, 0.62], [1.12, 0.62], [1.78, 0.46]]) {
    for (const sz of [-1, 1]) {
      const p = rbox(0.018, ph, pz * 1.45, 0.006, panelMat, 2);
      doorG.add(at(p, 0.028, py, sz * pz * 0.9));
      const mould = rbox(0.012, ph + 0.05, pz * 1.45 + 0.05, 0.004, slabMat, 1);
      doorG.add(at(mould, 0.022, py, sz * pz * 0.9));
    }
  }
  const lever = new THREE.Group();
  lever.add(at(rbox(0.02, 0.14, 0.05, 0.01, M.brass, 2), 0, 0, 0));
  const leverArm = at(rbox(0.03, 0.022, 0.13, 0.01, M.brass, 2), 0.035, 0.03, -0.05);
  lever.add(leverArm);
  doorG.add(at(lever, 0.03, 1.02, -(dw / 2) + 0.1));
  for (const hy of [0.25, 1.9]) doorG.add(at(box(0.012, 0.1, 0.03, M.brass), 0.02, hy, dw / 2 - 0.02));
  at(doorG, X0 - 0.03, 0, (door.z0 + door.z1) / 2);
  scene.add(doorG);

  // ---------- window with curtains and a night city ----------
  const ww = win.x1 - win.x0;
  const wh = win.y1 - win.y0;
  for (const [fw, fh, fx, fy] of [[ww + 0.1, 0.07, (win.x0 + win.x1) / 2, win.y1], [ww + 0.1, 0.07, (win.x0 + win.x1) / 2, win.y0], [0.07, wh, win.x0, (win.y0 + win.y1) / 2], [0.07, wh, win.x1, (win.y0 + win.y1) / 2]]) {
    scene.add(at(box(fw, fh, T + 0.04, M.trim), fx, fy, Z0 - T / 2));
  }
  scene.add(at(rbox(ww + 0.34, 0.05, 0.3, 0.02, M.counter, 2), (win.x0 + win.x1) / 2, win.y0 - 0.01, Z0 + 0.1));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfd8e6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.5 });
  const sashes = [];
  for (const side of [0, 1]) {
    const pivot = new THREE.Group();
    const hingeX = side === 0 ? win.x0 + 0.035 : win.x1 - 0.035;
    pivot.position.set(hingeX, win.y0 + 0.035, Z0 - 0.03);
    const sw = ww / 2 - 0.05;
    const dir = side === 0 ? 1 : -1;
    const g = new THREE.Group();
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.1, wh - 0.16), glass), dir * sw / 2, (wh - 0.07) / 2, 0));
    for (const [fw, fh, fx, fy] of [[sw, 0.055, sw / 2, 0.028], [sw, 0.055, sw / 2, wh - 0.1], [0.055, wh - 0.07, 0.028, (wh - 0.07) / 2], [0.055, wh - 0.07, sw - 0.028, (wh - 0.07) / 2], [sw, 0.03, sw / 2, (wh - 0.07) * 0.55]]) {
      g.add(at(box(fw, fh, 0.05, M.trim), dir * fx, fy, 0));
    }
    const knob = at(rbox(0.02, 0.1, 0.03, 0.008, M.chrome, 2), dir * (sw - 0.06), wh * 0.45, 0.04);
    g.add(knob);
    pivot.add(g);
    scene.add(pivot);
    sashes.push({ pivot, dir });
  }
  // curtains with folds
  const curtainMat = phys(0xe8dfd0, { roughness: 1, sheen: 0.6, sheenColor: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
  const curtainGeo = () => {
    const g = new THREE.PlaneGeometry(0.62, 2.72, 40, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 32) * 0.035);
    g.computeVertexNormals();
    return g;
  };
  for (const cx of [win.x0 - 0.44, win.x1 + 0.44]) {
    scene.add(at(mesh(curtainGeo(), curtainMat), cx, 1.39, Z0 + 0.16));
  }
  scene.add(at(cyl(0.015, 0.015, ww + 1.7, M.brass, 12), (win.x0 + win.x1) / 2, 2.76, Z0 + 0.16).rotateZ(Math.PI / 2));

  // ---------- radiator (heater) ----------
  const radMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.35, emissive: 0xff4a12, emissiveIntensity: 0 });
  const radiator = new THREE.Group();
  for (let i = 0; i < 14; i++) radiator.add(at(rbox(0.07, 0.6, 0.1, 0.03, radMat, 3), -0.72 + i * 0.111, 0.5, 0));
  radiator.add(at(cyl(0.022, 0.022, 1.56, radMat, 12), 0, 0.78, 0).rotateZ(Math.PI / 2));
  radiator.add(at(cyl(0.022, 0.022, 1.56, radMat, 12), 0, 0.22, 0).rotateZ(Math.PI / 2));
  radiator.add(at(cyl(0.035, 0.035, 0.07, M.chrome, 16), 0.82, 0.62, 0).rotateZ(Math.PI / 2));
  const heatLed = at(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0x333333 })), 0.82, 0.7, 0.05);
  radiator.add(heatLed);
  at(radiator, (win.x0 + win.x1) / 2, 0, Z0 + 0.14);
  scene.add(radiator);
  const heaterSource = new THREE.Vector3((win.x0 + win.x1) / 2, 0.85, Z0 + 0.2);

  // ---------- TV wall ----------
  const tvX = -2.9;
  const consoleG = new THREE.Group();
  consoleG.add(at(rbox(2.4, 0.46, 0.44, 0.02, M.walnut, 2), 0, 0.33, 0));
  for (const lx of [-1.1, 1.1]) consoleG.add(at(box(0.04, 0.1, 0.04, M.black), lx, 0.05, 0));
  for (const dx of [-0.6, 0, 0.6]) consoleG.add(at(box(0.004, 0.36, 0.004, M.black), dx, 0.33, 0.222));
  consoleG.add(at(rbox(0.9, 0.07, 0.1, 0.03, M.black, 2), 0, 0.6, 0.02)); // soundbar
  at(consoleG, tvX, 0, Z0 + 0.24);
  scene.add(consoleG);
  const tvCanvas = document.createElement('canvas');
  tvCanvas.width = 640;
  tvCanvas.height = 360;
  const tvTex = new THREE.CanvasTexture(tvCanvas);
  tvTex.colorSpace = THREE.SRGBColorSpace;
  scene.add(at(rbox(1.96, 1.12, 0.045, 0.012, M.black, 2), tvX, 1.6, Z0 + 0.03));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.06), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }));
  scene.add(at(screen, tvX, 1.6, Z0 + 0.054));
  const tvLight = new THREE.PointLight(0x5fb6ff, 0.6, 5, 2);
  scene.add(at(tvLight, tvX, 1.5, Z0 + 0.8));
  // decor on console
  const vase = cyl(0.06, 0.09, 0.32, M.ceramic, 28);
  scene.add(at(vase, tvX - 0.85, 0.72, Z0 + 0.24));
  const bookStack = [0xc9823d, 0x2f5b58, 0xe7dfd0];
  bookStack.forEach((c, i) => scene.add(at(box(0.3 - i * 0.02, 0.04, 0.22, std(c)), tvX + 0.8, 0.58 + i * 0.04, Z0 + 0.24)));

  // ---------- bookshelf ----------
  const shelf = new THREE.Group();
  const sx0 = -1.35;
  const sw = 0.95;
  shelf.add(at(box(0.03, 2.1, 0.34, M.oak), -sw / 2, 1.05, 0));
  shelf.add(at(box(0.03, 2.1, 0.34, M.oak), sw / 2, 1.05, 0));
  const r = mulberry(4);
  const bookColors = [0x2f5b58, 0xc9823d, 0x7a2e2a, 0xe7dfd0, 0x3b4a6b, 0x9c8b6e, 0x1f2a2d, 0xd6b45a];
  for (let i = 0; i < 5; i++) {
    const y = 0.08 + i * 0.48;
    shelf.add(at(box(sw, 0.03, 0.34, M.oak), 0, y, 0));
    if (i === 4) break;
    let bx = -sw / 2 + 0.04;
    while (bx < sw / 2 - 0.08) {
      if (r() > 0.85) { bx += 0.12; continue; }
      const bw = 0.025 + r() * 0.035;
      const bh = 0.26 + r() * 0.12;
      const b = box(bw, bh, 0.22 + r() * 0.06, std(bookColors[Math.floor(r() * bookColors.length)], { roughness: 0.8 }));
      b.rotation.z = r() > 0.92 ? 0.25 : 0;
      shelf.add(at(b, bx + bw / 2, y + 0.015 + bh / 2, 0));
      bx += bw + 0.003;
    }
  }
  const smallPot = cyl(0.07, 0.055, 0.12, M.ceramic, 20);
  shelf.add(at(smallPot, 0.25, 2.03 + 0.06, 0));
  at(shelf, sx0 + sw / 2, 0, Z0 + 0.19);
  scene.add(shelf);
  addPlant(scene, 'long', new THREE.Vector3(sx0 + sw / 2 + 0.25, 2.1, Z0 + 0.19), 0.35, 7, 11);

  // ---------- rug, sofa, coffee table, armchair ----------
  const rugMesh = mesh(new THREE.BoxGeometry(3.8, 0.015, 2.8), M.rug, { cast: false });
  scene.add(at(rugMesh, tvX + 0.3, 0.008, -0.9));

  // One furniture family: the same fabric, cushions and tapered walnut legs
  // for the sofa, the armchair and the dining chairs.
  function seating(width, seats) {
    const g = new THREE.Group();
    const armW = 0.2;
    const inner = width - armW * 2;
    g.add(at(rbox(width, 0.3, 0.92, 0.05, M.sofa, 4), 0, 0.3, 0));
    g.add(at(rbox(width, 0.46, 0.2, 0.08, M.sofa, 5), 0, 0.66, 0.36));
    for (const sx of [-1, 1]) g.add(at(rbox(armW, 0.36, 0.92, 0.08, M.sofa, 5), sx * (width / 2 - armW / 2), 0.42, 0));
    const cw = inner / seats;
    for (let i = 0; i < seats; i++) {
      const cx = -inner / 2 + cw * (i + 0.5);
      g.add(at(rbox(cw - 0.02, 0.17, 0.72, 0.07, M.sofa, 5), cx, 0.53, -0.08));
      const back = rbox(cw - 0.03, 0.44, 0.18, 0.08, M.sofa, 5);
      back.rotation.x = -0.12;
      g.add(at(back, cx, 0.82, 0.21));
    }
    const legH = 0.15;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = cyl(0.022, 0.014, legH, M.walnut, 12);
      leg.rotation.z = lx * 0.12;
      leg.rotation.x = -lz * 0.12;
      g.add(at(leg, lx * (width / 2 - 0.1), legH / 2, lz * 0.36));
    }
    return g;
  }
  const sofa = seating(2.5, 2);
  const p1 = rbox(0.42, 0.4, 0.13, 0.08, M.pillowA, 5); p1.rotation.set(-0.25, 0.25, 0.1); sofa.add(at(p1, -0.78, 0.82, 0.08));
  const p2 = rbox(0.4, 0.38, 0.13, 0.08, M.pillowB, 5); p2.rotation.set(-0.25, -0.3, -0.12); sofa.add(at(p2, 0.8, 0.81, 0.08));
  // seat faces -z: towards the TV
  at(sofa, tvX + 0.3, 0, 0.55);
  scene.add(sofa);

  const table = new THREE.Group();
  table.add(at(rbox(1.25, 0.05, 0.68, 0.02, M.walnut, 2), 0, 0.42, 0));
  table.add(at(rbox(1.15, 0.02, 0.58, 0.01, M.walnut, 2), 0, 0.14, 0));
  for (const [lx, lz] of [[-0.56, -0.28], [0.56, -0.28], [-0.56, 0.28], [0.56, 0.28]]) table.add(at(box(0.03, 0.42, 0.03, M.black), lx, 0.21, lz));
  table.add(at(box(0.26, 0.05, 0.2, std(0x2f5b58)), -0.35, 0.47, 0.05));
  table.add(at(box(0.24, 0.035, 0.18, std(0xe7dfd0)), -0.35, 0.51, 0.05));
  at(table, tvX + 0.3, 0, -0.95);
  scene.add(table);
  addFlowers(scene, new THREE.Vector3(tvX + 0.55, 0.445, -0.95), 0);

  const chair = seating(0.98, 1);
  chair.add(at(rbox(0.36, 0.34, 0.12, 0.07, M.pillowB, 5).rotateX(-0.25), 0, 0.8, 0.1));
  chair.rotation.y = 1.3;
  at(chair, tvX + 2.55, 0, -0.85);
  scene.add(chair);

  // soft overhead light for the living area (no visible fixture)
  const roomLight = new THREE.PointLight(0xffc690, 5.5, 0, 2);
  // A point-light shadow is six extra renders; skip it on light devices.
  roomLight.castShadow = !LOW;
  roomLight.shadow.mapSize.set(1024, 1024);
  roomLight.shadow.bias = -0.002;
  roomLight.shadow.radius = 8;
  scene.add(at(roomLight, tvX + 0.6, H - 0.35, -0.2));

  // ---------- paintings on the accent wall with picture lights ----------
  function painting(tex, w, h, z, y) {
    const g = new THREE.Group();
    const fw = 0.07;
    const frameMat = M.gold;
    for (const sy of [-1, 1]) g.add(at(rbox(0.06, fw, w + fw * 2, 0.014, frameMat, 2), 0.01, sy * (h / 2 + fw / 2), 0));
    for (const sz of [-1, 1]) g.add(at(rbox(0.06, h, fw, 0.014, frameMat, 2), 0.01, 0, sz * (w / 2 + fw / 2)));
    g.add(at(box(0.02, h + 0.02, w + 0.02, std(0x3a2a18)), -0.01, 0, 0));
    const canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
    canvasMesh.rotation.y = Math.PI / 2;
    g.add(at(canvasMesh, 0.002, 0, 0));
    // brass picture light
    g.add(at(cyl(0.025, 0.025, w * 0.5, M.brass, 16).rotateX(Math.PI / 2), 0.14, h / 2 + 0.16, 0));
    g.add(at(cyl(0.008, 0.008, 0.16, M.brass, 8).rotateZ(Math.PI / 2), 0.07, h / 2 + 0.14, 0));
    // soft, even wash over the canvas rather than a hot spot at the top
    const spot = new THREE.SpotLight(0xffd8b0, 1.3, 3.5, 0.95, 1, 2);
    at(spot, 0.32, h / 2 + 0.14, 0);
    spot.target.position.set(-0.2, -h * 0.55, 0);
    g.add(spot, spot.target);
    at(g, X0 + 0.03, y, z);
    scene.add(g);
    return g;
  }
  // Both paintings use the same frame size; images are cover-cropped to fit.
  const PW = 1.3;
  const PH = 1.0;
  painting(TX.paintingTexture(TX.PAINTINGS.starry, () => TX.starryNight(), PW / PH), PW, PH, 0.3, 1.7);
  painting(TX.paintingTexture(TX.PAINTINGS.adam, () => TX.wheatField(), PW / PH), PW, PH, -1.8, 1.7);

  // ---------- plants ----------
  const bigPot = cyl(0.26, 0.2, 0.5, M.terracotta, 32);
  scene.add(at(bigPot, X0 + 0.5, 0.25, Z0 + 0.5));
  scene.add(at(cyl(0.24, 0.24, 0.02, M.soil, 24), X0 + 0.5, 0.49, Z0 + 0.5));
  addPlant(scene, 'monstera', new THREE.Vector3(X0 + 0.5, 0.5, Z0 + 0.5), 1.0, 16, 21);
  const figPot = cyl(0.2, 0.17, 0.42, M.ceramic, 32);
  scene.add(at(figPot, 2.62, 0.21, Z0 + 0.4));
  scene.add(at(cyl(0.012, 0.02, 1.1, M.walnut, 8), 2.62, 0.95, Z0 + 0.4));
  addPlant(scene, 'ficus', new THREE.Vector3(2.62, 1.25, Z0 + 0.4), 0.9, 30, 33);

  // ---------- dining corner ----------
  const dining = new THREE.Group();
  dining.add(at(cyl(0.55, 0.55, 0.04, M.oak, 48), 0, 0.75, 0));
  dining.add(at(cyl(0.05, 0.07, 0.72, M.black, 16), 0, 0.37, 0));
  dining.add(at(cyl(0.28, 0.3, 0.03, M.black, 32), 0, 0.015, 0));
  for (const a of [0.4, Math.PI + 0.4]) {
    const ch = new THREE.Group();
    ch.add(at(rbox(0.46, 0.1, 0.46, 0.04, M.sofa, 4), 0, 0.47, 0));
    const chBack = rbox(0.46, 0.42, 0.08, 0.04, M.sofa, 4);
    chBack.rotation.x = -0.1;
    ch.add(at(chBack, 0, 0.74, 0.2));
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = cyl(0.018, 0.012, 0.43, M.walnut, 10);
      leg.rotation.z = lx * 0.08;
      leg.rotation.x = -lz * 0.08;
      ch.add(at(leg, lx * 0.18, 0.215, lz * 0.18));
    }
    ch.rotation.y = a + Math.PI / 2;
    ch.position.set(Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75);
    dining.add(ch);
  }
  at(dining, 3.1, 0, 0.7);
  scene.add(dining);
  addFlowers(scene, new THREE.Vector3(3.1, 0.77, 0.7), 1);
  // pendant lamp over the dining table
  scene.add(at(cyl(0.004, 0.004, 1.2, M.black, 6), 3.1, H - 0.6, 0.7));
  const pendant = mesh(new THREE.ConeGeometry(0.22, 0.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x223534, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
  scene.add(at(pendant, 3.1, 1.72, 0.7));
  const pBulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b0, toneMapped: false }));
  scene.add(at(pBulb, 3.1, 1.63, 0.7));
  const pendantLight = new THREE.PointLight(0xffc27a, 4, 0, 2);
  scene.add(at(pendantLight, 3.1, 1.5, 0.7));

  // ---------- kitchen corner: stove, propane cylinder, natural-gas pipe ----------
  const kx0 = 3.0;
  const kx1 = X0 + W;
  const kw = kx1 - kx0;
  const kz = Z0 + 0.32;
  const backsplash = mesh(new THREE.PlaneGeometry(kw, 0.66), M.tile, { cast: false });
  scene.add(at(backsplash, kx0 + kw / 2, 1.24, Z0 + 0.005));
  const kitchen = new THREE.Group();
  kitchen.add(at(box(kw, 0.84, 0.6, M.cabinet), 0, 0.46, 0));
  kitchen.add(at(box(kw, 0.08, 0.6, M.black), 0, 0.04, 0.02));
  const nDoors = 3;
  for (let i = 0; i < nDoors; i++) {
    const dx = -kw / 2 + (i + 0.5) * (kw / nDoors);
    kitchen.add(at(rbox(kw / nDoors - 0.02, 0.76, 0.02, 0.008, std(0x344c49, { roughness: 0.5 }), 2), dx, 0.47, 0.305));
    kitchen.add(at(rbox(0.012, 0.012, 0.3, 0.005, M.brass, 2).rotateY(Math.PI / 2), dx, 0.78, 0.33));
  }
  kitchen.add(at(rbox(kw + 0.04, 0.04, 0.64, 0.01, M.counter, 2), 0, 0.9, 0.01));
  // cooktop with burners and grates
  const cook = new THREE.Group();
  cook.add(at(rbox(0.7, 0.012, 0.5, 0.005, M.glassBlack, 2), 0, 0, 0));
  for (const [bx, bz, br] of [[-0.17, -0.12, 0.07], [0.17, -0.12, 0.055], [-0.17, 0.12, 0.055], [0.17, 0.12, 0.07]]) {
    cook.add(at(cyl(br, br, 0.02, M.black, 24), bx, 0.012, bz));
    cook.add(at(cyl(br * 0.45, br * 0.45, 0.025, M.brass, 16), bx, 0.018, bz));
    for (const rot of [0, Math.PI / 2]) cook.add(at(box(br * 2.6, 0.012, 0.012, M.black), bx, 0.04, bz).rotateY(rot));
  }
  for (let i = 0; i < 4; i++) cook.add(at(cyl(0.022, 0.022, 0.03, M.chrome, 16).rotateX(Math.PI / 2), -0.25 + i * 0.1666, -0.01, 0.31));
  at(cook, -0.1, 0.927, 0);
  kitchen.add(cook);
  // range hood + upper cabinets
  const hood = new THREE.Group();
  hood.add(at(box(0.8, 0.06, 0.5, M.steel), 0, 0, 0));
  hood.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.4, 0.3, 4, 1), M.steel).rotateY(Math.PI / 4), 0, 0.18, -0.02));
  hood.add(at(box(0.26, 0.6, 0.26, M.steel), 0, 0.62, -0.1));
  at(hood, -0.1, 1.72, -0.03);
  kitchen.add(hood);
  for (const ux of [-kw / 2 + 0.3, kw / 2 - 0.3]) {
    kitchen.add(at(box(0.56, 0.7, 0.34, M.cabinet), ux, 2.0, -0.13));
    kitchen.add(at(rbox(0.012, 0.012, 0.18, 0.005, M.brass, 2).rotateY(Math.PI / 2), ux, 1.72, 0.05));
  }
  const underLed = new THREE.Mesh(new THREE.BoxGeometry(kw - 0.2, 0.01, 0.02), new THREE.MeshBasicMaterial({ color: 0xffe6c0, toneMapped: false }));
  kitchen.add(at(underLed, 0, 1.64, 0.02));
  at(kitchen, kx0 + kw / 2, 0, kz);
  scene.add(kitchen);
  const kitchenLight = new THREE.PointLight(0xffd6a0, 1.6, 0, 2);
  scene.add(at(kitchenLight, kx0 + kw / 2, 1.55, Z0 + 0.45));

  // natural gas (methane): yellow pipe along the wall, meter, valve, into the stove
  const pipeY = 2.62;
  const pipeZ = Z0 + 0.06;
  const dropX = kx1 - 0.22;
  const hpipe = cyl(0.028, 0.028, W - 0.4, M.pipe, 16);
  scene.add(at(hpipe.rotateZ(Math.PI / 2), 0.2, pipeY, pipeZ));
  scene.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 10), M.pipe), dropX, pipeY, pipeZ));
  scene.add(at(cyl(0.028, 0.028, pipeY - 0.98, M.pipe, 16), dropX, (pipeY + 0.98) / 2, pipeZ));
  for (let i = 0; i < 7; i++) scene.add(at(box(0.04, 0.07, 0.05, M.steel), X0 + 0.9 + i * 1.35, pipeY, Z0 + 0.03));
  const meter = new THREE.Group();
  meter.add(rbox(0.3, 0.36, 0.2, 0.03, std(0xd9dcde, { roughness: 0.45, metalness: 0.3 }), 3));
  meter.add(at(box(0.18, 0.06, 0.01, std(0x0c0f11)), 0, 0.07, 0.101));
  meter.add(at(box(0.16, 0.04, 0.005, new THREE.MeshBasicMaterial({ color: 0x9bf2c8 })), 0, 0.07, 0.106));
  at(meter, dropX - 0.02, 2.1, pipeZ + 0.1);
  scene.add(meter);
  const valve = new THREE.Group();
  valve.add(at(cyl(0.045, 0.045, 0.12, M.brass, 16), 0, 0, 0));
  const handle = at(rbox(0.2, 0.03, 0.035, 0.012, M.red, 2), 0.06, 0.02, 0.07);
  valve.add(handle);
  at(valve, dropX, 1.28, pipeZ);
  scene.add(valve);
  const methaneSource = new THREE.Vector3(dropX, 1.3, pipeZ + 0.12);

  // propane (balloon) cylinder right next to the gas pipe, hose to the stove
  const cylG = new THREE.Group();
  cylG.add(at(mesh(new THREE.CapsuleGeometry(0.17, 0.45, 12, 32), M.red), 0, 0.42, 0));
  cylG.add(at(cyl(0.175, 0.175, 0.07, std(0xf1efe9, { roughness: 0.6 }), 32), 0, 0.46, 0));
  cylG.add(at(cyl(0.12, 0.12, 0.1, M.red, 24), 0, 0.04, 0));
  cylG.add(at(mesh(new THREE.TorusGeometry(0.08, 0.015, 8, 24), M.red).rotateX(Math.PI / 2), 0, 0.86, 0));
  cylG.add(at(cyl(0.025, 0.03, 0.08, M.brass, 12), 0, 0.84, 0));
  cylG.add(at(cyl(0.045, 0.045, 0.05, M.chrome, 16).rotateZ(Math.PI / 2), 0.05, 0.9, 0));
  const cylPos = new THREE.Vector3(kx1 - 0.62, 0, Z0 + 0.95);
  at(cylG, cylPos.x, 0, cylPos.z);
  scene.add(cylG);
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(cylPos.x + 0.08, 0.9, cylPos.z), new THREE.Vector3(cylPos.x + 0.25, 0.75, cylPos.z - 0.1),
    new THREE.Vector3(cylPos.x + 0.3, 0.35, cylPos.z - 0.28), new THREE.Vector3(cylPos.x + 0.2, 0.2, kz + 0.3),
  ]);
  scene.add(mesh(new THREE.TubeGeometry(hoseCurve, 40, 0.012, 8), M.rubber));
  const propaneSource = new THREE.Vector3(cylPos.x + 0.05, 0.95, cylPos.z);

  // ---------- NAFAS unit next to the door ----------
  const device = createDevice();
  const S = 0.2;
  device.scale.setScalar(S);
  device.rotation.y = Math.PI / 2;
  const deviceCenter = new THREE.Vector3(X0 + 0.01, 2.2, door.z0 - 0.5);
  at(device, deviceCenter.x, deviceCenter.y, deviceCenter.z);
  scene.add(device);
  const ringCenter = deviceCenter.clone().add(new THREE.Vector3(0.07, 0, 0));
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const rm = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.135, 64), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    rm.rotation.y = Math.PI / 2;
    rm.visible = false;
    scene.add(at(rm, ringCenter.x + 0.02, ringCenter.y, ringCenter.z));
    rings.push(rm);
  }
  const alarmLight = new THREE.PointLight(0xff2d2d, 0, 5, 2);
  scene.add(at(alarmLight, ringCenter.x + 0.5, ringCenter.y, ringCenter.z));

  // ---------- gas and heat particles ----------
  function makeGas(color, count, size) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b, 0], i * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.PointsMaterial({ size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, toneMapped: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return { geo, pos, col, count, next: 0, acc: 0, p: Array.from({ length: count }, () => ({ alive: false })) };
  }
  const propaneGas = makeGas(0xb9a4ff, 500, 1.3);
  const methaneGas = makeGas(0xffc58a, 500, 1.3);
  const heatGas = makeGas(0xff9a5c, 160, 0.7);

  function spawn(g, src, kind) {
    const q = g.p[g.next];
    g.next = (g.next + 1) % g.count;
    Object.assign(q, { alive: true, age: 0, x: src.x + (Math.random() - 0.5) * 0.06, y: src.y, z: src.z + (Math.random() - 0.5) * 0.06 });
    const a = Math.random() * Math.PI * 2;
    if (kind === 'propane') Object.assign(q, { vx: Math.cos(a) * 0.3, vz: Math.sin(a) * 0.3, vy: -0.2, life: 12 + Math.random() * 8 });
    else if (kind === 'methane') Object.assign(q, { vx: -0.1 - Math.random() * 0.35, vz: 0.1 + Math.random() * 0.3, vy: 0.4, life: 12 + Math.random() * 8 });
    else Object.assign(q, { x: src.x + (Math.random() - 0.5) * 1.5, z: src.z + Math.random() * 0.15, vx: (Math.random() - 0.5) * 0.04, vy: 0.4 + Math.random() * 0.2, vz: 0.06, life: 2.5 + Math.random() * 1.5 });
  }
  function stepGas(g, dt, kind, level, rate, src, venting) {
    g.acc += dt * rate;
    while (g.acc > 1) { g.acc -= 1; spawn(g, src, kind); }
    let alive = 0;
    for (let i = 0; i < g.count; i++) {
      const q = g.p[i];
      if (!q.alive) { g.col[i * 4 + 3] = 0; continue; }
      alive++;
      q.age += dt * (venting ? 2.4 : 1);
      if (q.age > q.life) { q.alive = false; g.col[i * 4 + 3] = 0; continue; }
      if (kind === 'propane') {
        q.vy += (0.1 + (i % 7) * 0.04 - q.y) * dt * 0.9;
        q.vy *= 1 - dt * 1.3;
        q.vx *= 1 - dt * 0.12; q.vz *= 1 - dt * 0.12;
      } else if (kind === 'methane') {
        q.vy += (H - 0.18 - (i % 5) * 0.07 - q.y) * dt * 0.5;
        q.vy *= 1 - dt * 0.9;
        q.vx -= 0.05 * dt; q.vx *= 1 - dt * 0.08; q.vz *= 1 - dt * 0.1;
      } else q.vx += Math.sin(q.age * 6 + i) * dt * 0.15;
      if (venting && kind !== 'heat') { q.vz -= dt * 0.3; q.vx += ((win.x0 + win.x1) / 2 - q.x) * dt * 0.06; }
      q.x = Math.max(X0 + 0.15, Math.min(X0 + W - 0.1, q.x + q.vx * dt));
      q.y = Math.max(0.05, Math.min(H - 0.05, q.y + q.vy * dt));
      q.z = Math.max(Z0 + 0.15, Math.min(Z0 + D - 0.1, q.z + q.vz * dt));
      g.pos.set([q.x, q.y, q.z], i * 3);
      g.col[i * 4 + 3] = Math.min(1, q.age / 1.5) * Math.min(1, (q.life - q.age) / 2.5) * level;
    }
    g.geo.attributes.position.needsUpdate = true;
    g.geo.attributes.color.needsUpdate = true;
    return alive;
  }

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x9fc4d6, 0x3a2c22, 0.35));
  const moon = new THREE.DirectionalLight(0x9db8ff, 0.9);
  moon.position.set(2.5, 7, -10);
  moon.target.position.set(1, 0, 0.5);
  moon.castShadow = true;
  moon.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
  Object.assign(moon.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  moon.shadow.bias = -0.0004;
  moon.shadow.radius = 4;
  scene.add(moon, moon.target);
  const fill = new THREE.DirectionalLight(0xffe2c4, 0.55);
  fill.position.set(9, 8, 10);
  scene.add(fill);
  const warm = new THREE.PointLight(0xff6a2a, 0, 6, 2);
  scene.add(at(warm, heaterSource.x, 0.7, heaterSource.z + 0.5));

  // ---------- TV content ----------
  const tctx = tvCanvas.getContext('2d');
  function drawTV(t, st) {
    const w = 640;
    const h = 360;
    const grd = tctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#050606');
    grd.addColorStop(1, '#06163a');
    tctx.fillStyle = grd;
    tctx.fillRect(0, 0, w, h);
    tctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      tctx.beginPath();
      tctx.strokeStyle = ['#5eeaff', '#3b6bff', '#7a5cff'][i];
      tctx.lineWidth = 3;
      for (let x = 0; x <= w; x += 8) {
        const y = h * 0.66 + Math.sin(x / 70 + t * (0.5 + i * 0.2) + i) * (20 + i * 8);
        if (x === 0) tctx.moveTo(x, y); else tctx.lineTo(x, y);
      }
      tctx.stroke();
    }
    tctx.globalAlpha = 1;
    tctx.fillStyle = '#e6f6f4';
    tctx.font = '600 44px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
    tctx.fillText(`${st.temperature.toFixed(1)}°`, 40, 86);
    tctx.font = '500 20px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
    tctx.fillStyle = 'rgba(230,246,244,0.6)';
    tctx.fillText(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 40, 120);
    if (st.alarm) {
      tctx.fillStyle = `rgba(220,38,38,${0.75 + Math.sin(t * 10) * 0.2})`;
      tctx.fillRect(0, h - 64, w, 64);
      tctx.fillStyle = '#fff';
      tctx.font = '700 26px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
      tctx.fillText('NAFAS · ALERT', 40, h - 22);
    }
    tvTex.needsUpdate = true;
  }

  // ---------- controls ----------
  const controls = new OrbitControls(camera, canvasEl);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 1.2;
  controls.maxDistance = 20;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.42;
  controls.minAzimuthAngle = -0.3;
  controls.maxAzimuthAngle = 1.5;
  controls.screenSpacePanning = true;
  let tween = null;
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; tween = null; });
  function flyTo(pos, target, dur = 1.2) {
    tween = { start: performance.now(), dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
  }

  // click on the unit
  const ray = new THREE.Raycaster();
  let downAt = null;
  canvasEl.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  canvasEl.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const rc = canvasEl.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), camera);
    if (ray.intersectObject(device, true).length) onDeviceClick?.();
  });
  canvasEl.addEventListener('pointermove', (e) => {
    const rc = canvasEl.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1), camera);
    canvasEl.style.cursor = ray.intersectObject(device, true).length ? 'pointer' : '';
  });

  // ---------- post-processing ----------
  // The plain render pass shows the room at once; on capable devices ambient
  // occlusion (n8ao) is loaded afterwards and swapped in.
  const composer = new EffectComposer(renderer);
  const basePass = new RenderPass(scene, camera);
  composer.addPass(basePass);
  if (!LOW) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.6, 0.85));
  composer.addPass(new OutputPass());
  if (!LOW) {
    import('n8ao').then(({ N8AOPass }) => {
      const aoPass = new N8AOPass(scene, camera, 1, 1);
      aoPass.configuration.aoRadius = 0.6;
      aoPass.configuration.distanceFalloff = 0.3;
      aoPass.configuration.intensity = 2.2;
      aoPass.configuration.halfRes = true;
      aoPass.configuration.gammaCorrection = false;
      composer.insertPass(aoPass, 0);
      composer.removePass(basePass);
      composer.setSize(w, h);
    }).catch(() => { /* keep the plain render */ });
  }

  let w = 1;
  let h = 1;
  function homePos() {
    const k = Math.min(1.8, Math.max(1, 1.45 / (w / h)));
    return HOME.target.clone().add(HOME.pos.clone().sub(HOME.target).multiplyScalar(k));
  }
  function resize() {
    const rc = canvasEl.getBoundingClientRect();
    w = Math.max(1, rc.width);
    h = Math.max(1, rc.height);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 46 : 32;
    camera.updateProjectionMatrix();
    if (!userMoved && !tween) { camera.position.copy(homePos()); controls.update(); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvasEl);
  resize();

  let state = { temperature: 24, propane: 0, methane: 0, heater: false, heaterPower: 0, propaneLeak: false, methaneLeak: false, window: false, buzzer: 0, led: 0, running: false, alarm: false };
  let visible = true;
  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; });
  io.observe(canvasEl);

  let lastNow = performance.now();
  let elapsed = 0;
  let tvAcc = 1;
  let windowOpen = 0;
  let raf;
  let interacting = false;
  let settling = false;
  let gasAlive = 0;
  controls.addEventListener('start', () => { interacting = true; });
  controls.addEventListener('end', () => { interacting = false; });
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Frame pacing: full rate while something moves (30 fps on light
    // devices); a calm room only needs ~12 fps for the TV glow.
    const busy = tween || interacting || settling || state.running || state.heater || state.heaterPower > 0.01
      || state.propaneLeak || state.methaneLeak || state.buzzer > 0 || state.led > 0 || gasAlive > 0
      || Math.abs((state.window ? 1 : 0) - windowOpen) > 0.002;
    const gap = busy ? (LOW ? 1000 / 30 : 0) : 1000 / 12;
    if (now - lastNow < gap - 2) return;
    const dt = Math.min(Math.max(0, (now - lastNow) / 1000), 0.05);
    lastNow = now;
    elapsed += dt;
    const t = elapsed;
    if (tween) {
      const u = Math.min(1, (performance.now() - tween.start) / 1000 / tween.dur);
      const k = THREE.MathUtils.smootherstep(u, 0, 1);
      camera.position.lerpVectors(tween.p0, tween.p1, k);
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      if (u >= 1) tween = null;
    }
    settling = controls.update(); // true while damping still moves the camera
    if (!visible) return;

    const hp = state.heaterPower;
    radMat.emissiveIntensity = hp * 0.6;
    radMat.color.setRGB(0.95, 0.95 - hp * 0.15, 0.94 - hp * 0.3);
    heatLed.material.color.setHex(state.heater ? 0xff5a1f : 0x333333);
    warm.intensity = hp * 4;

    const prevOpen = windowOpen;
    windowOpen += ((state.window ? 1 : 0) - windowOpen) * Math.min(1, dt * 3);
    if (Math.abs(windowOpen - prevOpen) > 1e-4) {
      for (const s of sashes) s.pivot.rotation.y = -s.dir * windowOpen * 1.5;
      renderer.shadowMap.needsUpdate = true;
    }

    gasAlive = stepGas(propaneGas, dt, 'propane', 0.08 + Math.min(1, state.propane / 1200) * 0.3, state.propaneLeak ? 40 : 0, propaneSource, state.window)
      + stepGas(methaneGas, dt, 'methane', 0.08 + Math.min(1, state.methane / 1200) * 0.3, state.methaneLeak ? 40 : 0, methaneSource, state.window)
      + stepGas(heatGas, dt, 'heat', 0.12 * hp, hp > 0.3 ? 20 * hp : 0, heaterSource, false);

    const buzzing = state.buzzer > 0;
    if (state.led > 0) device.userData.setLed('alarm', 0.4 + state.led * 0.6);
    else if (state.running) device.userData.setLed('run', 0.55 + Math.sin(t * 2.2) * 0.35);
    else device.userData.setLed('off');
    alarmLight.intensity = buzzing ? 1.6 + Math.sin(t * 22) * 0.9 : state.led > 0 ? 0.6 * state.led : 0;
    rings.forEach((rm, i) => {
      const ph = (t * 1.2 + i / 3) % 1;
      const s = 1 + ph * 6;
      rm.scale.set(s, s, s);
      rm.material.opacity = buzzing ? (1 - ph) * 0.6 : Math.max(0, rm.material.opacity - dt * 2);
      rm.visible = rm.material.opacity > 0.01;
    });
    tvLight.intensity = 0.5 + Math.sin(t * 1.3) * 0.1 + (state.alarm ? 0.6 : 0);
    tvLight.color.setHex(state.alarm ? 0xff5050 : 0x5fb6ff);

    tvAcc += dt;
    if (tvAcc > 0.25) { tvAcc = 0; drawTV(t, state); }
    composer.render(dt);
  }
  // Compile every shader before the first frame without blocking the page
  // (uses KHR_parallel_shader_compile where the browser supports it).
  renderer.compileAsync(scene, camera).catch(() => {}).finally(() => { raf = requestAnimationFrame(frame); });

  return {
    update(s) { state = { ...state, ...s }; },
    focusDevice() {
      flyTo(new THREE.Vector3(deviceCenter.x + 2.4, deviceCenter.y + 0.35, deviceCenter.z + 0.9), deviceCenter.clone(), 1.3);
    },
    resetView() { userMoved = false; flyTo(homePos(), HOME.target.clone(), 1.1); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}

// ---------------------------------------------------------------------------

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const leafMats = {};
function leafMat(kind) {
  if (!leafMats[kind]) {
    leafMats[kind] = new THREE.MeshStandardMaterial({ map: TX.leaf(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  }
  return leafMats[kind];
}

// Leaves on stems radiating from `base`.
function addPlant(scene, kind, base, scale, count, seed) {
  const r = mulberry(seed);
  const stemMat = new THREE.MeshStandardMaterial({ color: kind === 'ficus' ? 0x4a3322 : 0x3f6b35, roughness: 0.8 });
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    let tip;
    if (kind === 'ficus') {
      tip = new THREE.Vector3(Math.cos(a) * r() * 0.45, r() * 0.95, Math.sin(a) * r() * 0.45).multiplyScalar(scale);
    } else {
      const reach = (0.25 + r() * 0.45) * scale;
      const up = (kind === 'long' ? 0.25 : 0.5 + r() * 0.6) * scale;
      tip = new THREE.Vector3(Math.cos(a) * reach, up, Math.sin(a) * reach);
      const stem = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(tip.x * 0.2, tip.y * 0.8, tip.z * 0.2), tip]);
      const sm = new THREE.Mesh(new THREE.TubeGeometry(stem, 10, 0.007 * scale + 0.004, 5), stemMat);
      sm.castShadow = true;
      group.add(sm);
    }
    const size = kind === 'monstera' ? (0.38 + r() * 0.2) * scale : kind === 'ficus' ? 0.2 * scale + r() * 0.05 : 0.22 * scale;
    const leafMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), leafMat(kind));
    leafMesh.castShadow = true;
    leafMesh.position.copy(tip);
    leafMesh.lookAt(tip.clone().multiplyScalar(2).add(new THREE.Vector3(0, 0.6, 0)));
    leafMesh.rotateX(-0.9 - r() * 0.5);
    leafMesh.rotateZ((r() - 0.5) * 0.8);
    leafMesh.translateY(size * 0.45);
    group.add(leafMesh);
  }
  group.position.copy(base);
  scene.add(group);
}

// A vase of tulips.
function addFlowers(scene, base, seed) {
  const r = mulberry(100 + seed);
  const g = new THREE.Group();
  const vaseMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe8e4, roughness: 0.05, transmission: 0.6, thickness: 0.05, transparent: true, opacity: 0.7 });
  const vasePts = [];
  for (let i = 0; i <= 10; i++) {
    const y = i / 10;
    vasePts.push(new THREE.Vector2(0.045 + Math.sin(y * Math.PI) * 0.035 - y * 0.015, y * 0.22));
  }
  const vase = new THREE.Mesh(new THREE.LatheGeometry(vasePts, 28), vaseMat);
  g.add(vase);
  const colors = seed ? [0xf2c94c, 0xf4a6a0, 0xffffff] : [0xd83a3a, 0xe8577a, 0xf2a93b];
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.7 });
  const petalPts = [];
  for (let i = 0; i <= 8; i++) {
    const y = i / 8;
    petalPts.push(new THREE.Vector2(Math.sin(y * Math.PI * 0.85) * 0.032 + 0.004, y * 0.06));
  }
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const tip = new THREE.Vector3(Math.cos(a) * (0.06 + r() * 0.07), 0.38 + r() * 0.14, Math.sin(a) * (0.06 + r() * 0.07));
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(tip.x * 0.3, 0.22, tip.z * 0.3), tip]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.004, 5), stemMat));
    const bloom = new THREE.Mesh(new THREE.LatheGeometry(petalPts, 12), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6, side: THREE.DoubleSide }));
    bloom.position.copy(tip);
    bloom.lookAt(tip.clone().multiplyScalar(3).add(new THREE.Vector3(0, 2, 0)));
    bloom.rotateX(Math.PI / 2);
    bloom.castShadow = true;
    g.add(bloom);
  }
  for (let i = 0; i < 4; i++) {
    const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.2), leafMat('long'));
    lf.position.set((r() - 0.5) * 0.08, 0.28, (r() - 0.5) * 0.08);
    lf.rotation.set((r() - 0.5) * 0.6, r() * Math.PI, (r() - 0.5) * 0.6);
    g.add(lf);
  }
  g.position.copy(base);
  scene.add(g);
}
