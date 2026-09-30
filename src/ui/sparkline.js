// Tiny area sparkline with an optional dashed threshold line and a hover
// readout. One series per card, so the card title names it (no legend).

export function createSparkline(wrap, { color, format, threshold }) {
  const canvas = wrap.querySelector('canvas');
  const tip = wrap.querySelector('.spark-tip');
  const ctx = canvas.getContext('2d');
  let data = [];
  let hover = -1;
  let thr = threshold;

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    let lo = Math.min(...data);
    let hi = Math.max(...data);
    if (thr != null) { lo = Math.min(lo, thr); hi = Math.max(hi, thr); }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.15;
    lo -= pad; hi += pad;
    const x = (i) => (i / (data.length - 1)) * (w - 4) + 2;
    const y = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);

    if (thr != null) {
      ctx.strokeStyle = 'rgba(229,56,59,.45)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y(thr)); ctx.lineTo(w, y(thr)); ctx.stroke();
      ctx.setLineDash([]);
    }
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `${color}33`);
    grd.addColorStop(1, `${color}00`);
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(x(data.length - 1), h);
    ctx.lineTo(x(0), h);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const idx = hover >= 0 ? hover : data.length - 1;
    ctx.beginPath();
    ctx.arc(x(idx), y(data[idx]), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (hover >= 0) {
      ctx.strokeStyle = 'rgba(11,18,32,.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(idx), 0); ctx.lineTo(x(idx), h); ctx.stroke();
      const secsAgo = ((data.length - 1 - idx) * 0.5).toFixed(0);
      tip.textContent = `${format(data[idx])} · ${secsAgo === '0' ? 'hozir' : `${secsAgo}s oldin`}`;
      tip.style.left = `${Math.max(40, Math.min(w - 40, x(idx)))}px`;
      tip.style.opacity = '1';
    } else tip.style.opacity = '0';
  }

  wrap.addEventListener('pointermove', (e) => {
    if (data.length < 2) return;
    const r = canvas.getBoundingClientRect();
    hover = Math.round(((e.clientX - r.left) / r.width) * (data.length - 1));
    hover = Math.max(0, Math.min(data.length - 1, hover));
    draw();
  });
  wrap.addEventListener('pointerleave', () => { hover = -1; draw(); });

  return {
    set(values, threshold) {
      data = values;
      if (threshold !== undefined) thr = threshold;
      if (hover >= data.length) hover = -1;
      draw();
    },
  };
}
