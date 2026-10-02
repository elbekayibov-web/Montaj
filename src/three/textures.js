// Procedural canvas textures for the room. Everything is generated at load
// time so the site has no binary assets to host.

import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e6) / 1e6;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function toTexture(c, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// Oak planks with grain, knots and per-plank tone variation.
export function woodFloor() {
  const [c, g] = canvas(2048, 2048);
  const [rc, rg] = canvas(512, 512); // roughness
  const r = rng(7);
  g.fillStyle = '#5e4632';
  g.fillRect(0, 0, 2048, 2048);
  rg.fillStyle = '#d0d0d0';
  rg.fillRect(0, 0, 512, 512);
  const rows = 10;
  const rh = 2048 / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * 900;
    while (x < 2048) {
      const len = 700 + r() * 700;
      const y = row * rh;
      const tone = r() * 22;
      const base = [124 + tone, 98 + tone * 0.85, 74 + tone * 0.6];
      const grd = g.createLinearGradient(x, y, x + len, y + rh);
      grd.addColorStop(0, `rgb(${base[0]},${base[1]},${base[2]})`);
      grd.addColorStop(1, `rgb(${base[0] - 14},${base[1] - 12},${base[2] - 8})`);
      g.fillStyle = grd;
      g.fillRect(x + 1.5, y + 1.5, len - 3, rh - 3);
      // grain
      g.save();
      g.beginPath();
      g.rect(x + 1.5, y + 1.5, len - 3, rh - 3);
      g.clip();
      for (let k = 0; k < 38; k++) {
        const yy = y + r() * rh;
        g.strokeStyle = `rgba(${r() > 0.5 ? '60,35,18' : '210,170,120'},${0.05 + r() * 0.1})`;
        g.lineWidth = 0.6 + r() * 2.2;
        g.beginPath();
        g.moveTo(x, yy);
        const amp = 2 + r() * 6;
        for (let px = 0; px <= len; px += 40) g.lineTo(x + px, yy + Math.sin(px / (60 + r() * 50) + k) * amp);
        g.stroke();
      }
      if (r() > 0.6) {
        const kx = x + r() * len;
        const ky = y + rh * (0.3 + r() * 0.4);
        for (let ring = 0; ring < 6; ring++) {
          g.strokeStyle = `rgba(70,40,20,${0.25 - ring * 0.035})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.ellipse(kx, ky, 6 + ring * 7, 3 + ring * 3, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.restore();
      // seams are rougher
      const rv = Math.round(150 + r() * 50);
      rg.fillStyle = `rgb(${rv},${rv},${rv})`;
      rg.fillRect((x / 4) + 0.5, y / 4 + 0.5, len / 4 - 1, rh / 4 - 1);
      x += len;
    }
  }
  // gap shading
  g.fillStyle = 'rgba(30,18,10,0.55)';
  for (let row = 0; row <= rows; row++) g.fillRect(0, row * rh - 1.5, 2048, 3);
  const map = toTexture(c, { repeat: [3, 3] });
  const rough = toTexture(rc, { repeat: [3, 3], srgb: false });
  return { map, rough };
}

export function plaster(color = '#d9d4cc', seed = 3) {
  const [c, g] = canvas(1024, 1024);
  const r = rng(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) {
    const a = r() * 0.05;
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    const s = 1 + r() * 5;
    g.fillRect(r() * 1024, r() * 1024, s, s);
  }
  return toTexture(c, { repeat: [3, 2] });
}

// Kitchen backsplash: glossy subway tiles.
export function tiles() {
  const [c, g] = canvas(1024, 1024);
  const r = rng(11);
  g.fillStyle = '#b9c3c2';
  g.fillRect(0, 0, 1024, 1024);
  const tw = 128;
  const th = 64;
  for (let y = 0; y < 1024; y += th) {
    const off = (y / th) % 2 ? tw / 2 : 0;
    for (let x = -tw; x < 1024 + tw; x += tw) {
      const l = 226 + r() * 14;
      const grd = g.createLinearGradient(0, y, 0, y + th);
      grd.addColorStop(0, `rgb(${l},${l + 3},${l + 2})`);
      grd.addColorStop(1, `rgb(${l - 12},${l - 9},${l - 10})`);
      g.fillStyle = grd;
      g.fillRect(x + off + 3, y + 3, tw - 6, th - 6);
    }
  }
  return toTexture(c, { repeat: [2, 1.5] });
}

// Wool rug with a border and a subtle geometric field.
export function rug() {
  const [c, g] = canvas(1024, 768);
  const r = rng(5);
  g.fillStyle = '#233c3f';
  g.fillRect(0, 0, 1024, 768);
  g.fillStyle = '#d8cdb8';
  g.fillRect(40, 40, 944, 688);
  g.fillStyle = '#2d4b4f';
  g.fillRect(70, 70, 884, 628);
  g.strokeStyle = 'rgba(216,205,184,0.55)';
  g.lineWidth = 3;
  for (let x = 110; x < 930; x += 76) {
    for (let y = 110; y < 670; y += 76) {
      g.beginPath();
      g.moveTo(x, y - 24); g.lineTo(x + 24, y); g.lineTo(x, y + 24); g.lineTo(x - 24, y); g.closePath();
      g.stroke();
    }
  }
  // fibre noise
  for (let i = 0; i < 60000; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`;
    g.fillRect(r() * 1024, r() * 768, 1, 2 + r() * 3);
  }
  return toTexture(c);
}

export function fabric(color, seed = 9) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`;
    g.fillRect(0, y, 512, 1);
  }
  for (let x = 0; x < 512; x += 3) {
    g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
    g.fillRect(x, 0, 1, 512);
  }
  return toTexture(c, { repeat: [2, 2] });
}

// Leaf sprites with alpha. kind: 'monstera' | 'ficus' | 'long'
export function leaf(kind) {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  const green = kind === 'ficus' ? ['#2f5a2a', '#4a7a36'] : kind === 'long' ? ['#2d6b3f', '#58965a'] : ['#1f4f2f', '#3b7d4a'];
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, green[1]);
  grd.addColorStop(1, green[0]);
  g.fillStyle = grd;
  g.beginPath();
  if (kind === 'long') {
    g.moveTo(128, 250);
    g.bezierCurveTo(160, 170, 150, 60, 128, 6);
    g.bezierCurveTo(106, 60, 96, 170, 128, 250);
  } else if (kind === 'ficus') {
    g.moveTo(128, 250);
    g.bezierCurveTo(230, 190, 220, 40, 128, 10);
    g.bezierCurveTo(36, 40, 26, 190, 128, 250);
  } else {
    g.moveTo(128, 250);
    g.bezierCurveTo(250, 220, 250, 40, 128, 14);
    g.bezierCurveTo(6, 40, 6, 220, 128, 250);
  }
  g.fill();
  // midrib + veins
  g.strokeStyle = 'rgba(190,220,160,0.55)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(128, 250); g.lineTo(128, 16); g.stroke();
  g.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const y = 40 + i * 22;
    g.beginPath(); g.moveTo(128, y + 14); g.quadraticCurveTo(170, y + 4, 210 - Math.abs(i - 4) * 8, y - 6); g.stroke();
    g.beginPath(); g.moveTo(128, y + 14); g.quadraticCurveTo(86, y + 4, 46 + Math.abs(i - 4) * 8, y - 6); g.stroke();
  }
  if (kind === 'monstera') {
    // characteristic splits and holes
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      const y = 60 + i * 30;
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.moveTo(128 + dir * 40, y + 10);
        g.lineTo(128 + dir * 140, y - 6);
        g.lineTo(128 + dir * 140, y + 8);
        g.lineTo(128 + dir * 42, y + 16);
        g.fill();
        g.beginPath();
        g.ellipse(128 + dir * 24, y + 4, 4, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  const t = toTexture(c);
  return t;
}

// ---------------------------------------------------------------------------
// Van Gogh style paintings (fallback when the real image cannot be loaded).

function strokeField(g, w, h, r, { count, field, color, len = [8, 18], width = [2.5, 5.5], region }) {
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    if (region && !region(x, y)) continue;
    let px = x;
    let py = y;
    const L = len[0] + r() * (len[1] - len[0]);
    g.strokeStyle = color(x, y, r);
    g.lineWidth = width[0] + r() * (width[1] - width[0]);
    g.beginPath();
    g.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      const a = field(px, py);
      px += Math.cos(a) * L / 4;
      py += Math.sin(a) * L / 4;
      g.lineTo(px, py);
    }
    g.stroke();
  }
}

export function starryNight(w = 1024, h = 810) {
  const [c, g] = canvas(w, h);
  const r = rng(1889);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#15306e');
  sky.addColorStop(0.6, '#2a53a0');
  sky.addColorStop(1, '#1d3570');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const swirls = [
    { x: 0.42 * w, y: 0.3 * h, s: 1.0, rad: 0.2 * w },
    { x: 0.62 * w, y: 0.36 * h, s: -0.8, rad: 0.14 * w },
    { x: 0.24 * w, y: 0.22 * h, s: 0.6, rad: 0.12 * w },
  ];
  const stars = [
    [0.08, 0.16, 26], [0.3, 0.1, 22], [0.53, 0.07, 18], [0.66, 0.2, 20], [0.78, 0.08, 16],
    [0.2, 0.42, 22], [0.52, 0.5, 18], [0.36, 0.52, 14], [0.7, 0.46, 18], [0.93, 0.3, 16],
  ];
  const field = (x, y) => {
    let vx = 1;
    let vy = Math.sin(x / 90 + y / 140) * 0.35;
    for (const s of swirls) {
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy) + 1;
      const k = s.s * Math.exp(-d / s.rad) * 3.2;
      vx += (-dy / d) * k;
      vy += (dx / d) * k;
    }
    for (const [sx, sy, sr] of stars) {
      const dx = x - sx * w;
      const dy = y - sy * h;
      const d = Math.hypot(dx, dy) + 1;
      const k = Math.exp(-d / (sr * 2.2)) * 3;
      vx += (-dy / d) * k;
      vy += (dx / d) * k;
    }
    return Math.atan2(vy, vx);
  };
  const skyColors = ['#1e3f8f', '#2c5cb3', '#3f6fc4', '#5d86cf', '#86a7d8', '#b9cde0', '#dfe4c6'];
  strokeField(g, w, h, r, {
    count: 26000, field,
    region: (x, y) => y < h * 0.72,
    color: (x, y, rr) => {
      let near = 0;
      for (const s of swirls) near = Math.max(near, Math.exp(-Math.abs(Math.hypot(x - s.x, y - s.y) - s.rad * 0.55) / 30));
      const i = Math.min(skyColors.length - 1, Math.floor(rr() * 3.2 + near * 4));
      return skyColors[i];
    },
  });
  // stars and moon with halos
  const halo = (x, y, rad, colors) => {
    colors.forEach((col, i) => {
      g.strokeStyle = col;
      g.lineWidth = rad * 0.28;
      g.beginPath();
      g.arc(x, y, rad * (1.9 - i * 0.45), 0, Math.PI * 2);
      g.stroke();
    });
    g.fillStyle = '#fff7c2';
    g.beginPath(); g.arc(x, y, rad * 0.5, 0, Math.PI * 2); g.fill();
  };
  for (const [sx, sy, sr] of stars) halo(sx * w, sy * h, sr, ['rgba(214,226,200,0.55)', 'rgba(242,222,120,0.8)', 'rgba(250,236,160,0.95)']);
  const mx = 0.88 * w;
  const my = 0.13 * h;
  halo(mx, my, 34, ['rgba(236,190,70,0.65)', 'rgba(246,206,86,0.9)', 'rgba(252,226,120,1)']);
  g.fillStyle = '#e59b2d';
  g.beginPath(); g.arc(mx + 10, my - 4, 20, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fbe38a';
  g.beginPath(); g.arc(mx - 2, my + 2, 18, 0, Math.PI * 2); g.fill();

  // hills
  const hills = (x) => h * 0.7 - Math.sin(x / 160) * 22 - Math.sin(x / 57 + 1) * 8;
  g.fillStyle = '#1b2d52';
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) g.lineTo(x, hills(x));
  g.lineTo(w, h); g.fill();
  strokeField(g, w, h, r, {
    count: 7000, field: (x, y) => Math.sin(x / 70 + y / 40) * 0.5,
    region: (x, y) => y > hills(x),
    color: (x, y, rr) => ['#1b2f5a', '#2a4378', '#344f80', '#1f3a4a', '#3b5a6e'][Math.floor(rr() * 5)],
  });
  // village
  for (let i = 0; i < 26; i++) {
    const x = w * 0.3 + r() * w * 0.62;
    const y = h * 0.8 + r() * h * 0.12;
    const bw = 18 + r() * 22;
    const bh = 14 + r() * 16;
    g.fillStyle = ['#2b3c5d', '#3a4a60', '#22324d'][i % 3];
    g.fillRect(x, y - bh, bw, bh);
    g.fillStyle = '#131f38';
    g.beginPath(); g.moveTo(x - 3, y - bh); g.lineTo(x + bw / 2, y - bh - 10); g.lineTo(x + bw + 3, y - bh); g.fill();
    if (r() > 0.4) { g.fillStyle = '#f2c94c'; g.fillRect(x + bw * 0.3, y - bh * 0.6, 5, 5); }
  }
  // church spire
  g.fillStyle = '#1b2944';
  g.beginPath(); g.moveTo(w * 0.62, h * 0.8); g.lineTo(w * 0.635, h * 0.62); g.lineTo(w * 0.65, h * 0.8); g.fill();
  // cypress
  const cyp = (y) => w * (0.14 + Math.sin(y / 60) * 0.012);
  strokeField(g, w, h, r, {
    count: 9000,
    field: (x, y) => -Math.PI / 2 + Math.sin(y / 30 + x / 20) * 0.5,
    region: (x, y) => {
      const t = y / h;
      const half = w * (0.02 + 0.075 * Math.pow(Math.min(1, t * 1.1), 1.3));
      return y > h * 0.06 && Math.abs(x - cyp(y)) < half;
    },
    color: (x, y, rr) => ['#15241a', '#1f3322', '#2b3f1e', '#3b3a1c', '#0f1a14'][Math.floor(rr() * 5)],
    len: [10, 26], width: [3, 7],
  });
  return c;
}

// Second painting fallback: a wheat field under a turbulent sky.
export function wheatField(w = 1024, h = 640) {
  const [c, g] = canvas(w, h);
  const r = rng(1890);
  g.fillStyle = '#6f9fcf';
  g.fillRect(0, 0, w, h);
  const field = (x, y) => Math.sin(x / 80) * 0.8 + Math.cos(y / 50) * 0.6;
  strokeField(g, w, h, r, {
    count: 14000, field, region: (x, y) => y < h * 0.45,
    color: (x, y, rr) => ['#9cc3e6', '#dfe9ee', '#6b9bd0', '#f4f1e0', '#8fb2d8'][Math.floor(rr() * 5)],
  });
  g.fillStyle = '#3d5a3a';
  g.fillRect(0, h * 0.44, w, h * 0.12);
  strokeField(g, w, h, r, {
    count: 5000, field: () => -0.2, region: (x, y) => y > h * 0.43 && y < h * 0.56,
    color: (x, y, rr) => ['#3f6b3b', '#5b7f3a', '#2d4a30', '#6e8b4a'][Math.floor(rr() * 4)],
  });
  g.fillStyle = '#d9a93a';
  g.fillRect(0, h * 0.55, w, h * 0.45);
  strokeField(g, w, h, r, {
    count: 16000, field: (x, y) => -Math.PI / 2 + Math.sin(x / 40 + y / 30) * 0.6, region: (x, y) => y > h * 0.55,
    color: (x, y, rr) => ['#e8b93c', '#f2cf5b', '#c98f2a', '#a8742a', '#f6dc86'][Math.floor(rr() * 5)],
    len: [10, 22],
  });
  strokeField(g, w, h, r, {
    count: 5000,
    field: (x, y) => -Math.PI / 2 + Math.sin(y / 25) * 0.6,
    region: (x, y) => Math.abs(x - w * 0.72) < w * (0.01 + 0.05 * (y / h)) && y > h * 0.12 && y < h * 0.8,
    color: (x, y, rr) => ['#1d3322', '#26402a', '#324b25'][Math.floor(rr() * 3)],
    len: [10, 24], width: [3, 6],
  });
  return c;
}

// Try the real painting from Wikimedia Commons (public domain); fall back to
// the generated one if the network or the host's CSP blocks it.
export function paintingTexture(url, fallback, aspect = 1) {
  if (!url) return toTexture(fallback());
  // A plain dark canvas until the image arrives; the generated painting is
  // only drawn if the download fails, which keeps start-up fast.
  const [blank, bg] = canvas(4, 4);
  bg.fillStyle = '#2a2620';
  bg.fillRect(0, 0, 4, 4);
  const tex = toTexture(blank);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    tex.dispose(); // the GPU copy has the placeholder's size; re-upload at the new one
    tex.image = img;
    // cover-crop the real image into the frame
    const ia = img.width / img.height;
    if (ia > aspect) { tex.repeat.set(aspect / ia, 1); tex.offset.set((1 - aspect / ia) / 2, 0); }
    else { tex.repeat.set(1, ia / aspect); tex.offset.set(0, (1 - ia / aspect) / 2); }
    tex.needsUpdate = true;
  };
  img.onerror = () => {
    tex.dispose();
    tex.image = fallback();
    tex.needsUpdate = true;
  };
  img.src = url;
  return tex;
}

export const PAINTINGS = {
  starry: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/960px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg',
  adam: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg/960px-Michelangelo_-_Creation_of_Adam_%28cropped%29.jpg',
};

// Night sky used as the scene background (equirectangular, at infinity).
export function nightSkyDome() {
  const w = 2048;
  const h = 1024;
  const [c, g] = canvas(w, h);
  const r = rng(42);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#020406');
  grd.addColorStop(0.3, '#050a10');
  grd.addColorStop(0.47, '#0d1a26');
  grd.addColorStop(0.5, '#1b2530');
  grd.addColorStop(0.53, '#07090b');
  grd.addColorStop(1, '#030405');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // faint milky band
  for (let i = 0; i < 4000; i++) {
    const x = r() * w;
    const y = h * 0.18 + Math.sin(x / w * Math.PI * 2) * h * 0.08 + (r() - 0.5) * h * 0.12;
    g.fillStyle = `rgba(170,190,220,${r() * 0.05})`;
    g.fillRect(x, y, 2, 2);
  }
  for (let i = 0; i < 1400; i++) {
    const y = Math.pow(r(), 1.4) * h * 0.47;
    const a = 0.15 + r() * 0.7 * (1 - y / (h * 0.5));
    g.fillStyle = `rgba(${220 + r() * 35},${225 + r() * 30},255,${a})`;
    const sz = r() > 0.97 ? 2 : 1;
    g.fillRect(r() * w, y, sz, sz);
  }
  const tex = toTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
