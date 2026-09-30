// Procedural 3D model of the NAFAS Nano device, modelled after the product
// sheet: white rounded body, blue status LED, vent slots, and the internal
// stack (DHT22, CO2/gas sensors, PCB with ESP32, battery) for the exploded view.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = {};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function glowTexture() {
  if (cache.glow) return cache.glow;
  cache.glow = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  return cache.glow;
}

function materials() {
  if (cache.mats) return cache.mats;
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf5f6f8, roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, sheen: 0.3, sheenColor: 0xffffff,
  });
  const whiteMatte = new THREE.MeshPhysicalMaterial({ color: 0xeceef1, roughness: 0.6, clearcoat: 0.2 });
  const slot = new THREE.MeshStandardMaterial({ color: 0x8e97a3, roughness: 0.85 });
  const slotDeep = new THREE.MeshStandardMaterial({ color: 0x4b525c, roughness: 0.9 });
  const pcb = new THREE.MeshStandardMaterial({ color: 0x1d6b45, roughness: 0.55, metalness: 0.05 });
  const chip = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.2 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xd5d9de, roughness: 0.28, metalness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a948, roughness: 0.3, metalness: 1 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xc27a47, roughness: 0.35, metalness: 1 });
  const battery = new THREE.MeshPhysicalMaterial({ color: 0x86c98f, roughness: 0.45, clearcoat: 0.4 });
  const led = new THREE.MeshStandardMaterial({ color: 0x2f6bff, emissive: 0x2f6bff, emissiveIntensity: 2.2, roughness: 0.2 });
  const wire = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
  const logo = canvasTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,130,145,0.55)';
    g.font = '600 64px "DM Serif Display", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('NAFAS', w / 2, h / 2 + 4);
  });
  const logoMat = new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false });
  const dhtTex = canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#f2f3f5';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9aa3ad';
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) g.fillRect(14 + x * 22, 14 + y * 20, 12, 10);
  });
  const dht = new THREE.MeshStandardMaterial({ map: dhtTex, roughness: 0.6 });
  const mesh = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9aa1a8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8ebee';
    g.lineWidth = 2;
    for (let i = 0; i < w; i += 8) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
    }
  });
  const meshMat = new THREE.MeshStandardMaterial({ map: mesh, roughness: 0.4, metalness: 0.8 });
  cache.mats = { white, whiteMatte, slot, slotDeep, pcb, chip, silver, gold, copper, battery, led, wire, logoMat, dht, meshMat };
  return cache.mats;
}

function rbox(w, h, d, r, mat, seg = 5) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true;
  return m;
}

// Flat plate with rounded corners in plan view (y-up, centred).
function roundedPlate(w, d, r, h) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const z = -d / 2;
  s.moveTo(x + r, z);
  s.lineTo(x + w - r, z);
  s.quadraticCurveTo(x + w, z, x + w, z + r);
  s.lineTo(x + w, z + d - r);
  s.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  s.lineTo(x + r, z + d);
  s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r);
  s.quadraticCurveTo(x, z, x + r, z);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  g.translate(0, h / 2, 0);
  return g;
}

// Assembled body is 1.6 x 1.34 x 1.6 with its base at y = 0.
export function createDevice({ exploded = true } = {}) {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'nafas-device';
  const parts = [];
  const add = (name, obj, assembled, explodedY, label) => {
    obj.position.copy(assembled);
    root.add(obj);
    parts.push({ name, obj, a: assembled.clone(), e: new THREE.Vector3(assembled.x, explodedY, assembled.z), label });
    return obj;
  };

  // --- bottom housing with vents ---
  const housing = new THREE.Group();
  const shell = rbox(1.6, 1.0, 1.6, 0.2, M.white, 6);
  shell.position.y = 0.5;
  housing.add(shell);
  // vent slots on the four sides (lower half)
  const slotGeo = new THREE.BoxGeometry(0.075, 0.26, 0.02);
  for (let side = 0; side < 4; side++) {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(slotGeo, i % 2 ? M.slot : M.slot);
      s.position.set(-0.52 + i * 0.13, 0.3, 0.802);
      g.add(s);
    }
    g.rotation.y = (side * Math.PI) / 2;
    housing.add(g);
  }
  // base foot ring
  const foot = rbox(1.4, 0.05, 1.4, 0.02, M.slotDeep, 2);
  foot.position.y = 0.02;
  housing.add(foot);
  // USB-C port on the back
  const usb = rbox(0.22, 0.08, 0.04, 0.035, M.slotDeep, 3);
  usb.position.set(0, 0.2, -0.8);
  housing.add(usb);
  // engraved logo on front
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.155), M.logoMat);
  logo.position.set(0, 0.62, 0.803);
  housing.add(logo);
  add('housing', housing, new THREE.Vector3(0, 0, 0), -0.25, { text: 'Pastki korpus + ventil', tone: 'slate' });

  // --- internal stack ---
  const batteryG = new THREE.Group();
  const bat = rbox(1.05, 0.26, 0.62, 0.08, M.battery, 4);
  batteryG.add(bat);
  const batCap = box(0.08, 0.14, 0.3, M.silver);
  batCap.position.x = 0.56;
  batteryG.add(batCap);
  add('battery', batteryG, new THREE.Vector3(0, 0.3, 0), 1.25, { text: 'Li-ion 3000 mAh', tone: 'green' });

  const pcbG = new THREE.Group();
  const board = box(1.36, 0.05, 1.3, M.pcb);
  pcbG.add(board);
  const module = new THREE.Group();
  const modBase = box(0.55, 0.04, 0.42, M.chip);
  const shield = rbox(0.44, 0.07, 0.34, 0.015, M.silver, 2);
  shield.position.y = 0.055;
  module.add(modBase, shield);
  module.position.set(0.12, 0.045, -0.05);
  pcbG.add(module);
  for (const [x, z, w, d] of [[-0.42, 0.3, 0.2, 0.2], [-0.45, -0.3, 0.16, 0.12], [0.5, 0.42, 0.12, 0.12], [-0.12, 0.42, 0.18, 0.08]]) {
    const c = box(w, 0.04, d, M.chip);
    c.position.set(x, 0.045, z);
    pcbG.add(c);
  }
  for (let i = 0; i < 6; i++) {
    const cap = cyl(0.035, 0.035, 0.1, M.silver, 16);
    cap.position.set(-0.55 + (i % 3) * 0.1, 0.075, 0.02 + Math.floor(i / 3) * 0.1);
    pcbG.add(cap);
  }
  const hdr = box(0.5, 0.06, 0.06, M.chip);
  hdr.position.set(0.2, 0.05, 0.55);
  pcbG.add(hdr);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), M.wire);
  wire.position.set(-0.6, 0.2, -0.45);
  wire.rotation.z = 0.2;
  pcbG.add(wire);
  const led = cyl(0.03, 0.03, 0.03, M.led, 12);
  led.position.set(0.4, 0.04, 0.6);
  pcbG.add(led);
  add('pcb', pcbG, new THREE.Vector3(0, 0.55, 0), 1.9, { text: 'ESP32 mikrokontroller', tone: 'dark' });

  const mqG = new THREE.Group();
  const mqBase = cyl(0.23, 0.26, 0.12, M.copper);
  const mqMesh = cyl(0.19, 0.2, 0.2, M.meshMat);
  mqMesh.position.y = 0.16;
  const mqTop = cyl(0.19, 0.19, 0.02, M.silver);
  mqTop.position.y = 0.27;
  mqG.add(mqBase, mqMesh, mqTop);
  add('mq', mqG, new THREE.Vector3(-0.35, 0.72, 0.2), 2.5, { text: 'MQ-2 / MQ-4 gaz sensori', tone: 'orange' });

  const co2G = new THREE.Group();
  const co2 = rbox(0.62, 0.22, 0.38, 0.03, M.gold, 2);
  const win = cyl(0.09, 0.09, 0.05, M.silver);
  win.rotation.z = Math.PI / 2;
  win.position.x = 0.33;
  co2G.add(co2, win);
  add('co2', co2G, new THREE.Vector3(0.28, 0.76, -0.2), 3.0, { text: 'MH-Z19 CO₂ sensori', tone: 'blue' });

  const dhtG = new THREE.Group();
  const dhtBody = rbox(0.34, 0.12, 0.42, 0.03, M.dht, 2);
  const tab = box(0.16, 0.02, 0.14, M.whiteMatte);
  tab.position.z = -0.26;
  dhtG.add(dhtBody, tab);
  add('dht', dhtG, new THREE.Vector3(0.35, 0.72, 0.4), 3.45, { text: 'DHT22 harorat / namlik', tone: 'teal' });

  // --- top cap with LED ---
  const capG = new THREE.Group();
  const cap = rbox(1.6, 0.4, 1.6, 0.2, M.white, 6);
  capG.add(cap);
  // dark parting line between cap and housing
  const seam = new THREE.Mesh(roundedPlate(1.56, 1.56, 0.18, 0.03), M.slotDeep);
  seam.position.y = -0.215;
  capG.add(seam);
  const ledPill = rbox(0.05, 0.11, 0.02, 0.012, M.led, 2);
  ledPill.position.set(0, 0.02, 0.805);
  capG.add(ledPill);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x3d7bff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(0.3, 0.3, 1);
  glow.position.set(0, 0.02, 0.84);
  capG.add(glow);
  // top grille
  for (let i = 0; i < 5; i++) {
    const s = rbox(0.5, 0.012, 0.03, 0.01, M.slot, 2);
    s.position.set(0, 0.2, -0.24 + i * 0.12);
    capG.add(s);
  }
  add('cap', capG, new THREE.Vector3(0, 1.215, 0), 4.05, { text: 'Yuqori qopqoq', tone: 'slate' });

  const ledState = { mat: M.led.clone(), glow };
  ledPill.material = ledState.mat;
  glow.material = glow.material.clone();

  root.userData = {
    parts,
    // 0 = assembled, 1 = exploded. Parts move with a slight stagger.
    setExplode(t) {
      const n = parts.length;
      parts.forEach((p, i) => {
        const order = p.name === 'housing' ? 0 : i / n;
        const k = THREE.MathUtils.smoothstep(t, order * 0.35, order * 0.35 + 0.65);
        p.obj.position.lerpVectors(p.a, p.e, k);
        p.obj.rotation.y = (p.name === 'housing' ? 0 : 1) * k * 0.08 * (i % 2 ? 1 : -1);
      });
    },
    // Status LED: 'blue' (normal), 'red' (alarm), 'off'
    setLed(color, intensity = 1) {
      const c = color === 'red' ? 0xff3b3b : color === 'amber' ? 0xffa629 : 0x2f6bff;
      ledState.mat.color.setHex(c);
      ledState.mat.emissive.setHex(c);
      ledState.mat.emissiveIntensity = color === 'off' ? 0 : 2.4 * intensity;
      ledState.glow.material.color.setHex(c);
      ledState.glow.material.opacity = color === 'off' ? 0 : 0.7 * intensity;
    },
  };
  if (!exploded) parts.forEach((p) => { if (!['housing', 'cap'].includes(p.name)) p.obj.visible = false; });
  return root;
}
