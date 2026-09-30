// The virtual living room. Receives simulation state every frame and turns it
// into visuals: glowing radiator, gas clouds (propane sinks, methane rises),
// open window, and the NAFAS device's LED/alarm rings.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createDevice, glowTexture } from './device.js';

const W = 7.2; // x extent
const D = 6.2; // z extent
const H = 3.1;
const X0 = -W / 2;
const Z0 = -D / 2;

function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const rb = (w, h, d, r, mat, seg = 4) => mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
const bx = (w, h, d, mat) => mesh(new THREE.BoxGeometry(w, h, d), mat);

export function createRoom(canvas, overlay) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const HOME = { pos: new THREE.Vector3(5.5, 4.7, 7.1), target: new THREE.Vector3(-0.35, 0.55, -0.45) };
  camera.position.copy(HOME.pos);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0xfdfbff, 0xe8dccb, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(3.5, 7.5, -9);
  sun.target.position.set(0.6, 0, 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xe9f0ff, 1.1);
  fill.position.set(8, 6, 8);
  scene.add(fill);
  const warm = new THREE.PointLight(0xff7a2f, 0, 7, 1.6);
  warm.position.set(1.2, 0.9, Z0 + 0.8);
  scene.add(warm);
  const alarmLight = new THREE.PointLight(0xff2d2d, 0, 6, 1.5);
  scene.add(alarmLight);

  // ---------- shell ----------
  const floorTex = tex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#e7d6bf';
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -((r * 173) % 400);
      while (x < w) {
        const len = 360 + ((r * 97 + x) % 240);
        const shade = 214 + ((r * 31 + Math.floor(x)) % 20);
        g.fillStyle = `rgb(${shade + 17},${shade},${shade - 30})`;
        g.fillRect(x + 2, r * rh + 2, len - 4, rh - 4);
        g.strokeStyle = 'rgba(150,120,90,0.08)';
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          const yy = r * rh + 8 + k * (rh / 6);
          g.moveTo(x + 6, yy);
          g.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len - 6, yy);
          g.stroke();
        }
        x += len;
      }
    }
  }, [2, 2]);
  const floor = mesh(new THREE.BoxGeometry(W, 0.16, D), [
    std(0xd8c7ae), std(0xd8c7ae), std(0xe7d6bf, { map: floorTex, roughness: 0.55 }), std(0xd8c7ae), std(0xcdb99d), std(0xd8c7ae),
  ], { cast: false });
  floor.position.y = -0.08;
  scene.add(floor);
  const base = rb(W + 0.5, 0.25, D + 0.5, 0.1, std(0xf1ede7), 3);
  base.position.y = -0.3;
  scene.add(base);

  const wallMat = std(0xf5f2ee, { roughness: 0.95 });
  const wallAccent = std(0xdfe6f2, { roughness: 0.95 });
  const T = 0.16;
  // Back wall (z = Z0) with a window opening x:[0.3,2.2], y:[1.0,2.4]
  const win = { x0: 0.25, x1: 2.25, y0: 1.0, y1: 2.45 };
  const backPieces = [
    [X0, win.x0, 0, H], [win.x1, X0 + W, 0, H], [win.x0, win.x1, 0, win.y0], [win.x0, win.x1, win.y1, H],
  ];
  for (const [xa, xb, ya, yb] of backPieces) {
    const p = bx(xb - xa, yb - ya, T, wallMat);
    p.position.set((xa + xb) / 2, (ya + yb) / 2, Z0 - T / 2);
    scene.add(p);
  }
  // Left wall (x = X0) with door opening z:[0.7,1.75], y:[0,2.15]
  const door = { z0: 0.75, z1: 1.8, h: 2.15 };
  const leftPieces = [[Z0, door.z0, 0, H], [door.z1, Z0 + D, 0, H], [door.z0, door.z1, door.h, H]];
  for (const [za, zb, ya, yb] of leftPieces) {
    const p = bx(T, yb - ya, zb - za, wallAccent);
    p.position.set(X0 - T / 2, (ya + yb) / 2, (za + zb) / 2);
    scene.add(p);
  }
  // Baseboards
  const bbMat = std(0xffffff, { roughness: 0.6 });
  const bb1 = bx(W, 0.1, 0.03, bbMat); bb1.position.set(0, 0.05, Z0 + 0.015); scene.add(bb1);
  const bb2 = bx(0.03, 0.1, door.z0 - Z0, bbMat); bb2.position.set(X0 + 0.015, 0.05, (Z0 + door.z0) / 2); scene.add(bb2);
  const bb3 = bx(0.03, 0.1, Z0 + D - door.z1, bbMat); bb3.position.set(X0 + 0.015, 0.05, (door.z1 + Z0 + D) / 2); scene.add(bb3);
  // Wall top caps (cutaway edge)
  const capMat = std(0xe4e0da);
  const c1 = bx(W + T, 0.02, T, capMat); c1.position.set(-T / 2, H + 0.01, Z0 - T / 2); scene.add(c1);
  const c2 = bx(T, 0.02, D, capMat); c2.position.set(X0 - T / 2, H + 0.01, 0); scene.add(c2);

  // ---------- door ----------
  const wood = std(0xb88a5e, { roughness: 0.55 });
  const frameMat = std(0xffffff, { roughness: 0.5 });
  const dw = door.z1 - door.z0;
  for (const [zz, len, yy, isTop] of [[door.z0, 0.07, door.h / 2, false], [door.z1, 0.07, door.h / 2, false], [(door.z0 + door.z1) / 2, dw + 0.14, door.h + 0.035, true]]) {
    const f = bx(0.22, isTop ? 0.07 : door.h, isTop ? len : 0.07, frameMat);
    f.position.set(X0 - 0.02, isTop ? yy : door.h / 2, zz);
    scene.add(f);
  }
  const doorPivot = new THREE.Group();
  doorPivot.position.set(X0 - 0.03, 0, door.z1 - 0.03);
  const panel = rb(0.05, door.h - 0.04, dw - 0.06, 0.015, wood, 2);
  panel.position.set(0, (door.h - 0.04) / 2, -(dw - 0.06) / 2);
  doorPivot.add(panel);
  for (const [yy, hh] of [[0.55, 0.7], [1.5, 0.85]]) {
    const inset = rb(0.012, hh, dw - 0.3, 0.005, std(0xa87b50, { roughness: 0.6 }), 1);
    inset.position.set(0.03, yy, -(dw - 0.06) / 2);
    doorPivot.add(inset);
  }
  const handle = rb(0.06, 0.03, 0.16, 0.012, std(0xd6d9de, { metalness: 1, roughness: 0.25 }), 2);
  handle.position.set(0.07, 1.02, -(dw - 0.06) + 0.14);
  doorPivot.add(handle);
  doorPivot.rotation.y = -0.18;
  scene.add(doorPivot);

  // ---------- window ----------
  const winFrame = std(0xffffff, { roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xdbeafe, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.28, metalness: 0 });
  const ww = win.x1 - win.x0;
  const wh = win.y1 - win.y0;
  const sill = rb(ww + 0.3, 0.05, 0.3, 0.02, winFrame, 2);
  sill.position.set((win.x0 + win.x1) / 2, win.y0 - 0.02, Z0 + 0.1);
  scene.add(sill);
  const outerFrame = [[ww + 0.08, 0.06, (win.x0 + win.x1) / 2, win.y1], [ww + 0.08, 0.06, (win.x0 + win.x1) / 2, win.y0], [0.06, wh, win.x0, (win.y0 + win.y1) / 2], [0.06, wh, win.x1, (win.y0 + win.y1) / 2]];
  for (const [fw, fh, fx, fy] of outerFrame) {
    const f = bx(fw, fh, T + 0.04, winFrame);
    f.position.set(fx, fy, Z0 - T / 2);
    scene.add(f);
  }
  // sky behind the window
  const skyTex = tex(256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#8ec5ff');
    grd.addColorStop(1, '#e0f0ff');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, r] of [[60, 80, 26], [90, 70, 32], [125, 84, 22], [190, 150, 18], [210, 144, 24]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(ww + 0.4, wh + 0.4), new THREE.MeshBasicMaterial({ map: skyTex }));
  sky.position.set((win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2, Z0 - T - 0.25);
  scene.add(sky);
  const sashes = [];
  for (const side of [0, 1]) {
    const pivot = new THREE.Group();
    const hingeX = side === 0 ? win.x0 + 0.03 : win.x1 - 0.03;
    pivot.position.set(hingeX, win.y0 + 0.03, Z0 - 0.02);
    const sw = ww / 2 - 0.04;
    const dir = side === 0 ? 1 : -1;
    const g = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.08, wh - 0.14), glass);
    pane.position.set(dir * sw / 2, (wh - 0.06) / 2, 0);
    g.add(pane);
    for (const [fw, fh, fx, fy] of [[sw, 0.05, sw / 2, 0.025], [sw, 0.05, sw / 2, wh - 0.085], [0.05, wh - 0.06, 0.025, (wh - 0.06) / 2], [0.05, wh - 0.06, sw - 0.025, (wh - 0.06) / 2]]) {
      const f = bx(fw, fh, 0.05, winFrame);
      f.position.set(dir * fx, fy, 0);
      g.add(f);
    }
    pivot.add(g);
    scene.add(pivot);
    sashes.push({ pivot, dir });
  }

  // ---------- TV + console ----------
  const console_ = rb(2.3, 0.45, 0.45, 0.04, std(0xc49a6c, { roughness: 0.5 }), 3);
  console_.position.set(-1.1, 0.26, Z0 + 0.27);
  scene.add(console_);
  for (const lx of [-2.05, -0.15]) {
    const leg = bx(0.05, 0.06, 0.05, std(0x3b3b3b));
    leg.position.set(lx, 0.02, Z0 + 0.27);
    scene.add(leg);
  }
  const doorLine = bx(0.005, 0.36, 0.005, std(0x8d6a45));
  doorLine.position.set(-1.1, 0.26, Z0 + 0.5);
  scene.add(doorLine);
  const tvScreenCanvas = document.createElement('canvas');
  tvScreenCanvas.width = 512;
  tvScreenCanvas.height = 288;
  const tvTex = new THREE.CanvasTexture(tvScreenCanvas);
  tvTex.colorSpace = THREE.SRGBColorSpace;
  const tv = rb(1.75, 1.0, 0.06, 0.02, std(0x14161a, { roughness: 0.3, metalness: 0.4 }), 2);
  tv.position.set(-1.1, 1.55, Z0 + 0.05);
  scene.add(tv);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.67, 0.92), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }));
  screen.position.set(-1.1, 1.55, Z0 + 0.082);
  scene.add(screen);
  // Speaker bar + small decor on console
  const vase = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 24), std(0x2f6bff, { roughness: 0.3 }));
  vase.position.set(-0.3, 0.63, Z0 + 0.27);
  scene.add(vase);
  const books = rb(0.35, 0.08, 0.24, 0.01, std(0xe86f4f), 1);
  books.position.set(-1.9, 0.53, Z0 + 0.27);
  scene.add(books);

  // ---------- rug + sofa + coffee table ----------
  const rug = mesh(new RoundedBoxGeometry(3.3, 0.02, 2.3, 2, 0.01), std(0xdfe7f3, { roughness: 1 }), { cast: false });
  rug.position.set(-0.9, 0.01, 0.05);
  scene.add(rug);
  const rugBorder = mesh(new RoundedBoxGeometry(3.0, 0.022, 2.0, 2, 0.01), std(0xcbd7ea, { roughness: 1 }), { cast: false });
  rugBorder.position.set(-0.9, 0.012, 0.05);
  scene.add(rugBorder);

  const sofa = new THREE.Group();
  const fabric = std(0x6f86a8, { roughness: 0.95 });
  const fabricLight = std(0x8298b8, { roughness: 0.95 });
  const sBase = rb(2.4, 0.42, 0.95, 0.12, fabric, 4); sBase.position.set(0, 0.3, 0); sofa.add(sBase);
  const sBack = rb(2.4, 0.62, 0.26, 0.12, fabric, 4); sBack.position.set(0, 0.72, 0.36); sofa.add(sBack);
  for (const sx of [-1.13, 1.13]) { const arm = rb(0.26, 0.58, 0.95, 0.12, fabric, 4); arm.position.set(sx, 0.42, 0); sofa.add(arm); }
  for (const sx of [-0.5, 0.5]) {
    const cush = rb(0.98, 0.16, 0.72, 0.07, fabricLight, 4); cush.position.set(sx, 0.58, -0.08); sofa.add(cush);
    const back = rb(0.95, 0.46, 0.2, 0.09, fabricLight, 4); back.position.set(sx, 0.86, 0.2); back.rotation.x = -0.12; sofa.add(back);
  }
  const pillow = rb(0.38, 0.36, 0.12, 0.06, std(0xf2c14e, { roughness: 1 }), 4);
  pillow.position.set(-0.78, 0.82, 0.08); pillow.rotation.set(-0.2, 0.3, 0.12); sofa.add(pillow);
  for (const [lx, lz] of [[-1.1, -0.38], [1.1, -0.38], [-1.1, 0.4], [1.1, 0.4]]) {
    const leg = mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 10), std(0x3a2d22)); leg.position.set(lx, 0.05, lz); sofa.add(leg);
  }
  sofa.position.set(-0.9, 0, 1.25);
  scene.add(sofa);

  const table = new THREE.Group();
  const top = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 48), std(0xd2ab7c, { roughness: 0.4 }));
  top.position.y = 0.42;
  table.add(top);
  const stem = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 16), std(0x2b2b2b, { metalness: 0.6, roughness: 0.4 }));
  stem.position.y = 0.2; table.add(stem);
  const foot = mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.03, 32), std(0x2b2b2b, { metalness: 0.6, roughness: 0.4 }));
  foot.position.y = 0.015; table.add(foot);
  // Lighter (propane source)
  const lighter = new THREE.Group();
  const lBody = rb(0.07, 0.14, 0.035, 0.012, std(0xef4444, { roughness: 0.3 }), 2);
  lBody.position.y = 0.07;
  const lTop = bx(0.07, 0.035, 0.035, std(0xd1d5db, { metalness: 1, roughness: 0.3 }));
  lTop.position.y = 0.16;
  lighter.add(lBody, lTop);
  lighter.position.set(0.12, 0.445, 0.05);
  lighter.rotation.y = 0.5;
  table.add(lighter);
  const mug = mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.11, 20), std(0xffffff, { roughness: 0.3 }));
  mug.position.set(-0.22, 0.5, -0.12); table.add(mug);
  table.position.set(-0.9, 0, -0.55);
  scene.add(table);
  const propaneSource = new THREE.Vector3(-0.9 + 0.12, 0.62, -0.55 + 0.05);

  // ---------- radiator (heater) under the window ----------
  const radiator = new THREE.Group();
  const finMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.35, metalness: 0.1, emissive: 0xff4d00, emissiveIntensity: 0 });
  const fins = 11;
  for (let i = 0; i < fins; i++) {
    const fin = rb(0.1, 0.62, 0.2, 0.045, finMat, 3);
    fin.position.set(-0.66 + i * 0.132, 0.46, 0);
    radiator.add(fin);
  }
  const pipeTop = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.45, 12), finMat); pipeTop.rotation.z = Math.PI / 2; pipeTop.position.y = 0.72; radiator.add(pipeTop);
  const pipeBot = pipeTop.clone(); pipeBot.position.y = 0.2; radiator.add(pipeBot);
  for (const lx of [-0.62, 0.62]) { const f = rb(0.08, 0.16, 0.34, 0.03, std(0x9ca3af), 2); f.position.set(lx, 0.08, 0); radiator.add(f); }
  const knob = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), std(0x374151));
  knob.rotation.z = Math.PI / 2; knob.position.set(0.76, 0.6, 0); radiator.add(knob);
  const heatLed = mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshBasicMaterial({ color: 0x555555 }));
  heatLed.position.set(0.76, 0.68, 0.06); radiator.add(heatLed);
  radiator.position.set((win.x0 + win.x1) / 2, 0, Z0 + 0.3);
  scene.add(radiator);
  const heaterSource = new THREE.Vector3((win.x0 + win.x1) / 2, 0.8, Z0 + 0.3);

  // ---------- gas pipe (methane source) ----------
  const pipeMat = std(0xf2c230, { roughness: 0.35, metalness: 0.2 });
  const pipeY = 2.72;
  const pipeZ = Z0 + 0.08;
  const px1 = X0 + W - 0.35;
  const hp = mesh(new THREE.CylinderGeometry(0.035, 0.035, W - 0.2, 14), pipeMat);
  hp.rotation.z = Math.PI / 2; hp.position.set(0.1 - 0.25, pipeY, pipeZ); scene.add(hp);
  const vp = mesh(new THREE.CylinderGeometry(0.035, 0.035, pipeY - 1.0, 14), pipeMat);
  vp.position.set(px1, (pipeY + 1.0) / 2, pipeZ); scene.add(vp);
  const elbow = mesh(new THREE.SphereGeometry(0.05, 16, 12), pipeMat); elbow.position.set(px1, pipeY, pipeZ); scene.add(elbow);
  const valveBody = rb(0.12, 0.14, 0.12, 0.03, std(0xd1d5db, { metalness: 1, roughness: 0.3 }), 2);
  valveBody.position.set(px1, 1.25, pipeZ); scene.add(valveBody);
  const valveHandle = rb(0.26, 0.04, 0.05, 0.015, std(0xdc2626, { roughness: 0.4 }), 2);
  valveHandle.position.set(px1 + 0.1, 1.3, pipeZ + 0.08); scene.add(valveHandle);
  // gas meter
  const meter = rb(0.36, 0.44, 0.2, 0.04, std(0xe5e7eb, { roughness: 0.5 }), 3);
  meter.position.set(px1 - 0.05, 1.75, pipeZ + 0.08); scene.add(meter);
  const meterWin = bx(0.22, 0.08, 0.01, std(0x111827)); meterWin.position.set(px1 - 0.05, 1.82, pipeZ + 0.185); scene.add(meterWin);
  for (let i = 0; i < 6; i++) {
    const clip = bx(0.05, 0.06, 0.05, std(0x9ca3af)); clip.position.set(X0 + 0.6 + i * 1.1, pipeY - 0.04, Z0 + 0.03); scene.add(clip);
  }
  const methaneSource = new THREE.Vector3(px1, 1.25, pipeZ + 0.12);

  // ---------- plant + lamp ----------
  const pot = mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 24), std(0xe9e2d6, { roughness: 0.7 }));
  pot.position.set(X0 + 0.45, 0.2, Z0 + 0.45); scene.add(pot);
  const leafMat = std(0x3f8f5a, { roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const leaf = mesh(new THREE.SphereGeometry(0.2, 12, 8), leafMat);
    leaf.scale.set(0.55, 1.4, 0.25);
    const a = (i / 9) * Math.PI * 2;
    leaf.position.set(X0 + 0.45 + Math.cos(a) * 0.14, 0.72 + (i % 3) * 0.14, Z0 + 0.45 + Math.sin(a) * 0.14);
    leaf.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.5);
    scene.add(leaf);
  }
  const lamp = new THREE.Group();
  const lampPole = mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8), std(0x222222, { metalness: 0.6 })); lampPole.position.y = 0.75; lamp.add(lampPole);
  const lampShade = mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 24, 1, true), std(0xf7efe2, { side: THREE.DoubleSide, roughness: 0.9 })); lampShade.position.y = 1.55; lamp.add(lampShade);
  const lampBase = mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 20), std(0x222222, { metalness: 0.6 })); lampBase.position.y = 0.015; lamp.add(lampBase);
  lamp.position.set(-2.95, 0, 2.55);
  scene.add(lamp);

  // Picture frame on the left wall
  const art = tex(256, 192, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#dbeafe'); grd.addColorStop(1, '#fde68a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f6bff'; g.beginPath(); g.arc(90, 110, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f97316'; g.fillRect(140, 50, 70, 90);
  });
  const picFrame = rb(0.04, 0.62, 0.82, 0.01, std(0x1f2937), 1);
  picFrame.position.set(X0 + 0.02, 1.75, -1.35); scene.add(picFrame);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.54), new THREE.MeshStandardMaterial({ map: art, roughness: 0.8 }));
  pic.rotation.y = Math.PI / 2; pic.position.set(X0 + 0.045, 1.75, -1.35); scene.add(pic);

  // ---------- NAFAS device on the wall next to the door ----------
  const device = createDevice({ exploded: false });
  const S = 0.27;
  device.scale.setScalar(S);
  device.rotation.y = Math.PI / 2; // front faces +x (into the room)
  device.rotation.x = 0;
  const devicePos = new THREE.Vector3(X0 + 0.02 + 0.8 * S, 2.3, door.z0 - 0.42);
  device.position.set(devicePos.x - 0.8 * S + 0.02, devicePos.y - 0.67 * S, devicePos.z);
  device.position.x = X0 + 0.8 * S + 0.005;
  scene.add(device);
  const bracket = rb(0.02, 0.3, 0.3, 0.01, std(0xe5e7eb), 1);
  bracket.position.set(X0 + 0.01, devicePos.y, devicePos.z);
  scene.add(bracket);
  const deviceCenter = new THREE.Vector3(X0 + 0.8 * S, devicePos.y, devicePos.z);

  // Alarm rings expanding from the device
  const rings = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.23, 48), ringMat.clone());
    r.rotation.y = Math.PI / 2;
    r.position.copy(deviceCenter).add(new THREE.Vector3(0.2, 0, 0));
    scene.add(r);
    rings.push(r);
  }
  alarmLight.position.copy(deviceCenter).add(new THREE.Vector3(0.6, 0, 0));

  // ---------- particles ----------
  function makeGas(color, count) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) { col[i * 4] = c.r; col[i * 4 + 1] = c.g; col[i * 4 + 2] = c.b; col[i * 4 + 3] = 0; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.PointsMaterial({ size: 1.5, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    const p = Array.from({ length: count }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1 }));
    return { geo, pos, col, p, count, next: 0, acc: 0 };
  }
  const propaneGas = makeGas(0x8b5cf6, 420);
  const methaneGas = makeGas(0xf97316, 420);
  const heatGas = makeGas(0xff8a3d, 160);
  heatGas.geo.attributes.color.array.fill(0);

  function spawn(g, src, kind) {
    const q = g.p[g.next];
    g.next = (g.next + 1) % g.count;
    q.alive = true;
    q.age = 0;
    q.x = src.x + (Math.random() - 0.5) * 0.08;
    q.y = src.y + (Math.random() - 0.5) * 0.05;
    q.z = src.z + (Math.random() - 0.5) * 0.08;
    const a = Math.random() * Math.PI * 2;
    if (kind === 'propane') {
      q.vx = Math.cos(a) * 0.25; q.vz = Math.sin(a) * 0.25; q.vy = -0.12; q.life = 9 + Math.random() * 6;
    } else if (kind === 'methane') {
      q.vx = -0.05 - Math.random() * 0.25; q.vz = 0.08 + Math.random() * 0.2; q.vy = 0.35; q.life = 10 + Math.random() * 6;
    } else {
      q.x = src.x + (Math.random() - 0.5) * 1.3; q.y = src.y; q.z = src.z + (Math.random() - 0.5) * 0.2;
      q.vx = (Math.random() - 0.5) * 0.05; q.vy = 0.35 + Math.random() * 0.2; q.vz = 0.08; q.life = 3 + Math.random() * 2;
    }
  }

  function stepGas(g, dt, kind, level, rate, src, venting) {
    g.acc += dt * rate;
    while (g.acc > 1) { g.acc -= 1; spawn(g, src, kind); }
    for (let i = 0; i < g.count; i++) {
      const q = g.p[i];
      if (!q.alive) { g.col[i * 4 + 3] = 0; continue; }
      q.age += dt * (venting ? 2.2 : 1);
      if (q.age > q.life) { q.alive = false; g.col[i * 4 + 3] = 0; continue; }
      if (kind === 'propane') {
        // heavier than air: sinks and spreads along the floor
        const floorY = 0.12 + (i % 7) * 0.05;
        q.vy += (floorY - q.y) * dt * 0.8;
        q.vy *= 1 - dt * 1.2;
        q.vx *= 1 - dt * 0.15; q.vz *= 1 - dt * 0.15;
      } else if (kind === 'methane') {
        // lighter than air: rises and spreads under the ceiling
        const ceilY = H - 0.2 - (i % 5) * 0.08;
        q.vy += (ceilY - q.y) * dt * 0.5;
        q.vy *= 1 - dt * 0.9;
        q.vx += -0.04 * dt; q.vx *= 1 - dt * 0.1; q.vz *= 1 - dt * 0.12;
      } else {
        q.vx += Math.sin(q.age * 6 + i) * dt * 0.15;
      }
      if (venting && kind !== 'heat') { q.vz -= dt * 0.25; q.vx += ((win.x0 + win.x1) / 2 - q.x) * dt * 0.05; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.x = Math.max(X0 + 0.15, Math.min(X0 + W - 0.1, q.x));
      q.z = Math.max(Z0 + 0.15, Math.min(Z0 + D - 0.1, q.z));
      q.y = Math.max(0.05, Math.min(H - 0.05, q.y));
      g.pos[i * 3] = q.x; g.pos[i * 3 + 1] = q.y; g.pos[i * 3 + 2] = q.z;
      const lifeK = Math.min(1, q.age / 1.2) * Math.min(1, (q.life - q.age) / 2);
      g.col[i * 4 + 3] = lifeK * level;
    }
    g.geo.attributes.position.needsUpdate = true;
    g.geo.attributes.color.needsUpdate = true;
  }

  // ---------- TV content ----------
  const tctx = tvScreenCanvas.getContext('2d');
  function drawTV(t, state) {
    const w = 512;
    const h = 288;
    const grd = tctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#0b1a3a');
    grd.addColorStop(1, '#1c3f8f');
    tctx.fillStyle = grd;
    tctx.fillRect(0, 0, w, h);
    tctx.globalAlpha = 0.35;
    for (let i = 0; i < 4; i++) {
      tctx.beginPath();
      tctx.strokeStyle = ['#60a5fa', '#a78bfa', '#34d399', '#f472b6'][i];
      tctx.lineWidth = 3;
      for (let x = 0; x <= w; x += 8) {
        const y = h * 0.62 + Math.sin(x / 60 + t * (0.6 + i * 0.2) + i) * (18 + i * 6);
        if (x === 0) tctx.moveTo(x, y); else tctx.lineTo(x, y);
      }
      tctx.stroke();
    }
    tctx.globalAlpha = 1;
    tctx.fillStyle = '#ffffff';
    tctx.font = '600 34px Manrope, sans-serif';
    tctx.fillText(`${state.temperature.toFixed(1)}°C`, 32, 70);
    tctx.font = '500 18px Manrope, sans-serif';
    tctx.fillStyle = 'rgba(255,255,255,0.7)';
    const d = new Date();
    tctx.fillText(`Toshkent · ${d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}`, 32, 102);
    if (state.alarm) {
      tctx.fillStyle = `rgba(239,68,68,${0.6 + Math.sin(t * 10) * 0.3})`;
      tctx.fillRect(0, h - 56, w, 56);
      tctx.fillStyle = '#fff';
      tctx.font = '700 22px Manrope, sans-serif';
      tctx.fillText('⚠ NAFAS: XAVF SIGNALI', 32, h - 20);
    }
    tvTex.needsUpdate = true;
  }

  // ---------- controls ----------
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 2.2;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.38;
  controls.minAzimuthAngle = -0.35;
  controls.maxAzimuthAngle = 1.45;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.update();
  let tween = null;
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; });
  function flyTo(pos, target, dur = 1.2) {
    tween = { start: performance.now(), dur, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
  }

  // ---------- overlay labels ----------
  const tag = document.createElement('div');
  tag.className = 'room-tag device-tag';
  tag.innerHTML = '<span class="led"></span><b>NAFAS</b><span class="val"></span>';
  overlay.appendChild(tag);
  const tagVal = tag.querySelector('.val');
  const srcTags = {
    heater: mkTag('Isitkich', 'heat'),
    propane: mkTag('Propan sizmoqda', 'propane'),
    methane: mkTag('Metan sizmoqda', 'methane'),
  };
  function mkTag(text, cls) {
    const el = document.createElement('div');
    el.className = `room-tag src-tag ${cls}`;
    el.textContent = text;
    overlay.appendChild(el);
    return el;
  }

  let w = 1;
  let h = 1;
  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1 ? 50 : 34;
    camera.updateProjectionMatrix();
    if (!userMoved && !tween) camera.position.copy(homePos());
  }
  // Narrow (portrait) panels need the camera further back to fit the room.
  function homePos() {
    const k = Math.min(1.9, Math.max(1, 1.35 / (w / h)));
    return HOME.target.clone().add(HOME.pos.clone().sub(HOME.target).multiplyScalar(k));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let state = {
    temperature: 24, propane: 0, methane: 0, heater: false, heaterPower: 0, propaneLeak: false, methaneLeak: false,
    window: false, buzzer: 0, led: 0, running: false, alarm: false,
  };
  let visible = true;
  const io = new IntersectionObserver((e) => { visible = e[0].isIntersecting; });
  io.observe(canvas);

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let tvAcc = 0;
  let windowOpen = 0;
  let raf;
  function place(el, world, dy = 0) {
    tmp.copy(world).project(camera);
    const x = (tmp.x * 0.5 + 0.5) * w;
    const y = (-tmp.y * 0.5 + 0.5) * h + dy;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    el.style.visibility = tmp.z < 1 ? 'visible' : 'hidden';
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (tween) {
      const u = Math.min(1, (performance.now() - tween.start) / 1000 / tween.dur);
      const k = THREE.MathUtils.smootherstep(u, 0, 1);
      camera.position.lerpVectors(tween.p0, tween.p1, k);
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      if (u >= 1) tween = null;
    }
    controls.update();
    if (!visible) return;

    // heater glow
    const hp = state.heaterPower;
    finMat.emissiveIntensity = hp * 0.55;
    finMat.color.setRGB(0.96, 0.96 - hp * 0.12, 0.96 - hp * 0.25);
    heatLed.material.color.setHex(state.heater ? 0xff5a1f : 0x555555);
    warm.intensity = hp * 3 + Math.max(0, state.temperature - 30) * 0.08;

    // window sashes
    windowOpen += ((state.window ? 1 : 0) - windowOpen) * Math.min(1, dt * 3);
    for (const s of sashes) s.pivot.rotation.y = -s.dir * windowOpen * 1.15;

    // gases
    const pl = Math.min(1, state.propane / 900);
    const ml = Math.min(1, state.methane / 900);
    stepGas(propaneGas, dt, 'propane', 0.22 + pl * 0.55, state.propaneLeak ? 38 : 0, propaneSource, state.window);
    stepGas(methaneGas, dt, 'methane', 0.22 + ml * 0.55, state.methaneLeak ? 38 : 0, methaneSource, state.window);
    stepGas(heatGas, dt, 'heat', 0.18 * hp, hp > 0.3 ? 22 * hp : 0, heaterSource, false);

    // device LED + alarm
    const led = state.led;
    const buzzing = state.buzzer > 0;
    if (led > 0) device.userData.setLed('red', 0.4 + led * 0.6);
    else device.userData.setLed(state.running ? 'blue' : 'off', 0.85 + Math.sin(t * 2) * 0.15);
    alarmLight.intensity = buzzing ? 2.2 + Math.sin(t * 22) * 1.2 : led > 0 ? 0.8 * led : 0;
    rings.forEach((r, i) => {
      const ph = (t * 1.3 + i / 3) % 1;
      const s = 1 + ph * 5;
      r.scale.set(s, s, s);
      r.material.opacity = buzzing ? (1 - ph) * 0.55 : Math.max(0, r.material.opacity - dt * 2);
    });

    tvAcc += dt;
    if (tvAcc > 0.2) { tvAcc = 0; drawTV(t, state); }
    renderer.render(scene, camera);

    // labels
    place(tag, deviceCenter.clone().add(new THREE.Vector3(0.05, 0.28, 0)));
    tag.classList.toggle('alarm', buzzing || led > 0);
    tag.classList.toggle('off', !state.running);
    tagVal.textContent = state.running ? (buzzing ? 'SIGNAL!' : 'ishlamoqda') : 'o‘chiq';
    place(srcTags.heater, heaterSource.clone().add(new THREE.Vector3(0, 0.25, 0.2)));
    srcTags.heater.classList.toggle('on', state.heater);
    srcTags.heater.textContent = `Isitkich · ${state.heater ? 'yoqilgan' : 'o‘chiq'}`;
    place(srcTags.propane, propaneSource.clone().add(new THREE.Vector3(0, 0.3, 0)));
    srcTags.propane.classList.toggle('on', state.propaneLeak);
    place(srcTags.methane, methaneSource.clone().add(new THREE.Vector3(-0.1, 0.3, 0.1)));
    srcTags.methane.classList.toggle('on', state.methaneLeak);
  }
  drawTV(0, state);
  frame();

  return {
    update(s) { state = { ...state, ...s }; },
    focusDevice() {
      flyTo(new THREE.Vector3(deviceCenter.x + 2.3, deviceCenter.y + 0.5, deviceCenter.z + 1.3), deviceCenter.clone(), 1.3);
    },
    resetView() { flyTo(homePos(), HOME.target.clone(), 1.1); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}
