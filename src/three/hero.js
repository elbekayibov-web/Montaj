// Landing scene: the NAFAS Nano on a soft pedestal. Drag to rotate; scrolling
// drives the exploded view (0 = assembled, 1 = exploded).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createDevice } from './device.js';

export function createHero(canvas, labelLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(4.6, 3.4, 6.2);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
  key.shadow.radius = 8;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec1ff, 1.3);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe7f5, 0.6));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pivot = new THREE.Group();
  scene.add(pivot);
  const device = createDevice();
  device.position.y = 0;
  pivot.add(device);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.45;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.9;
  controls.target.set(0, 0.7, 0);
  let idleTimer;
  controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener('end', () => { idleTimer = setTimeout(() => { controls.autoRotate = true; }, 3500); });

  // Labels for exploded parts (HTML pills + SVG leader lines)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('hero-lines');
  labelLayer.appendChild(svg);
  const labels = device.userData.parts.filter((p) => p.label).map((p) => {
    const el = document.createElement('div');
    el.className = `part-pill tone-${p.label.tone}`;
    el.innerHTML = `<span class="dot"></span>${p.label.text}`;
    labelLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(line);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3.5');
    svg.appendChild(dot);
    return { part: p, el, line, dot };
  });

  let progress = 0;
  let shown = 0;
  let visible = true;
  let w = 1;
  let h = 1;

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the device comfortably framed on narrow screens.
    camera.fov = w / h < 0.8 ? 42 : 30;
    camera.updateProjectionMatrix();
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const v = new THREE.Vector3();
  const clock = new THREE.Clock();
  let raf;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    shown += (progress - shown) * Math.min(1, dt * 6);
    device.userData.setExplode(shown);
    // Lift the camera target while exploding so the whole stack stays framed.
    controls.target.y = 0.7 + shown * 1.25;
    // OrbitControls clamps the radius, so this is how the framing distance is set.
    const dist = (w / h < 0.8 ? 9.4 : 7.9) + shown * 5.2;
    controls.minDistance = dist;
    controls.maxDistance = dist;
    controls.autoRotateSpeed = 0.9 * (1 - shown * 0.7);
    controls.update();
    pivot.position.y = Math.sin(clock.elapsedTime * 1.2) * 0.03;
    device.userData.setLed('blue', 0.75 + Math.sin(clock.elapsedTime * 2.2) * 0.25);
    renderer.render(scene, camera);

    const show = THREE.MathUtils.smoothstep(shown, 0.45, 0.85);
    const side = w > 720 ? 1 : 0;
    for (const L of labels) {
      L.part.obj.getWorldPosition(v);
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const lx = side ? Math.min(w - 16, x + w * 0.2) : x;
      const ly = side ? y : y;
      L.el.style.opacity = String(show);
      L.el.style.transform = side
        ? `translate(${lx}px, ${ly}px) translate(0, -50%)`
        : `translate(${Math.min(w - 16, x + 70)}px, ${ly}px) translate(0, -50%)`;
      L.line.setAttribute('x1', x); L.line.setAttribute('y1', y);
      L.line.setAttribute('x2', side ? lx : Math.min(w - 16, x + 70)); L.line.setAttribute('y2', ly);
      L.line.style.opacity = String(show * 0.8);
      L.dot.setAttribute('cx', x); L.dot.setAttribute('cy', y);
      L.dot.style.opacity = String(show);
    }
  }
  frame();

  const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }, { threshold: 0 });
  io.observe(canvas);

  return {
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); },
  };
}
