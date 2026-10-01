// NAFAS Nano wall unit: a soft rounded square with a circular perforated
// grille and a light ring. The ring is the only status indicator:
// off = not running, slow teal breathing = running, red = alarm LED pin.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { canvas, toTexture } from './textures.js';

let glowTex;
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = toTexture(c);
  return glowTex;
}

function grilleTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#2b3236';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#0e1214';
  for (let ring = 1; ring < 12; ring++) {
    const rad = ring * 20;
    const n = Math.floor(ring * 7.5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.2;
      g.beginPath();
      g.arc(256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad, 3.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#e9ecee';
  g.beginPath(); g.arc(256, 256, 13, 0, Math.PI * 2); g.fill();
  return toTexture(c);
}

// Unit size: 1 x 1 x 0.32, back face at z = 0, front facing +z.
export function createDevice() {
  const root = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf1f2f0, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5, sheen: 0.4, sheenColor: 0xffffff });
  const body = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 0.3, 8, 0.14), white);
  body.position.z = 0.15;
  body.castShadow = true;
  root.add(body);

  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.41, 0.03, 64), new THREE.MeshPhysicalMaterial({ color: 0xdfe3e4, roughness: 0.35, metalness: 0.2, clearcoat: 0.6 }));
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = 0.305;
  root.add(bezel);
  const grille = new THREE.Mesh(new THREE.CircleGeometry(0.34, 64), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.6, metalness: 0.4 }));
  grille.position.z = 0.322;
  root.add(grille);

  const ringMat = new THREE.MeshStandardMaterial({ color: 0x0f1a1c, emissive: 0xc6f432, emissiveIntensity: 0, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.016, 12, 96), ringMat);
  ring.position.z = 0.323;
  root.add(ring);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xc6f432, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(1.5, 1.5, 1);
  glow.position.z = 0.4;
  root.add(glow);

  // side vents
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.8 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.34, 0.03), ventMat);
      v.position.set(side * 0.501, 0, 0.08 + i * 0.045);
      root.add(v);
    }
  }

  const red = new THREE.Color(0xff3b3b);
  const teal = new THREE.Color(0xb8f03a);
  root.userData = {
    hit: body,
    // mode: 'off' | 'run' | 'alarm'; k = 0..1 brightness
    setLed(mode, k = 1) {
      const c = mode === 'alarm' ? red : teal;
      ringMat.emissive.copy(c);
      ringMat.color.set(mode === 'off' ? 0x151c1e : c).multiplyScalar(0.2);
      ringMat.emissiveIntensity = mode === 'off' ? 0 : 2.6 * k;
      glow.material.color.copy(c);
      glow.material.opacity = mode === 'off' ? 0 : 0.55 * k;
    },
  };
  return root;
}
