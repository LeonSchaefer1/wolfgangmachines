// All textures are painted procedurally on canvases at startup (no image downloads, tiny APK).
import * as THREE from 'three';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

/** paints wood grain running horizontally into the given rect */
function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hue: number, sat: number, light: number, r: () => number, density = 1) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, hsl(hue, sat, light + 3));
  grad.addColorStop(0.5, hsl(hue + 1, sat, light));
  grad.addColorStop(1, hsl(hue - 1, sat + 2, light - 4));
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  // long wavy fibres
  const n = Math.round((h / 3.2) * density);
  for (let i = 0; i < n; i++) {
    const yy = y + r() * h;
    const amp = 1 + r() * 3;
    const ph = r() * 6.28;
    const fq = 0.004 + r() * 0.01;
    const dark = r() < 0.7;
    g.strokeStyle = dark ? hsl(hue - 4, sat + 8, light - 10 - r() * 12, 0.1 + r() * 0.16) : hsl(hue + 4, sat, light + 9, 0.1 + r() * 0.14);
    g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath();
    for (let xx = x - 4; xx <= x + w + 4; xx += 12) {
      const v = yy + Math.sin(xx * fq + ph) * amp + Math.sin(xx * fq * 2.7 + ph * 1.7) * amp * 0.35;
      if (xx <= x) g.moveTo(xx, v);
      else g.lineTo(xx, v);
    }
    g.stroke();
  }
  // fine pores
  for (let i = 0; i < (w * h) / 260; i++) {
    g.fillStyle = hsl(hue - 6, sat, light - 22, 0.06 + r() * 0.1);
    g.fillRect(x + r() * w, y + r() * h, 3 + r() * 10, 0.7);
  }
  g.restore();
}

/** The big workshop wall: light horizontal boards with a soft vignette. */
export function wallTexture(): THREE.Texture {
  const W = 1536;
  const H = 864;
  const [c, g] = canvas(W, H);
  const r = rng(7);
  const rows = 6;
  const rh = H / rows;
  for (let i = 0; i < rows; i++) {
    const shade = (r() - 0.5) * 5;
    // boards are staggered like a real wall
    let x = -r() * 500;
    while (x < W) {
      const bw = 520 + r() * 520;
      grain(g, x, i * rh, bw, rh, 34 + r() * 4, 44 + r() * 6, 71 + shade + (r() - 0.5) * 4, r, 0.9);
      // knot now and then
      if (r() < 0.35) {
        const kx = x + bw * (0.2 + r() * 0.6);
        const ky = i * rh + rh * (0.25 + r() * 0.5);
        for (let k = 7; k > 0; k--) {
          g.strokeStyle = hsl(28, 45, 40 + k * 2, 0.16);
          g.lineWidth = 1.5;
          g.beginPath();
          g.ellipse(kx, ky, k * 5.5, k * 2.6, 0, 0, 6.3);
          g.stroke();
        }
        g.fillStyle = hsl(24, 45, 30, 0.5);
        g.beginPath();
        g.ellipse(kx, ky, 5, 3, 0, 0, 6.3);
        g.fill();
      }
      // butt joint
      g.fillStyle = 'rgba(60,35,10,0.35)';
      g.fillRect(x + bw - 1.5, i * rh, 2.5, rh);
      g.fillStyle = 'rgba(255,240,210,0.25)';
      g.fillRect(x + bw + 1, i * rh, 1.5, rh);
      x += bw;
    }
    // seam between rows: dark groove + light edge
    g.fillStyle = 'rgba(55,30,8,0.5)';
    g.fillRect(0, i * rh - 2, W, 3.5);
    g.fillStyle = 'rgba(255,244,220,0.35)';
    g.fillRect(0, i * rh + 1.5, W, 2);
  }
  // vignette keeps the eye on the middle of the wall
  const v = g.createRadialGradient(W / 2, H * 0.46, H * 0.25, W / 2, H / 2, W * 0.66);
  v.addColorStop(0, 'rgba(60,30,0,0)');
  v.addColorStop(1, 'rgba(60,30,0,0.38)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return tex(c);
}

/** Darker wood for planks, seesaws, crates. Tiles horizontally. */
export function plankTexture(hue = 26, sat = 52, light = 46, seed = 3): THREE.Texture {
  const [c, g] = canvas(512, 128);
  grain(g, 0, 0, 512, 128, hue, sat, light, rng(seed), 1.3);
  const t = tex(c, true);
  return t;
}

export function crateTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  // diagonal slats
  for (let i = 0; i < 4; i++) grain(g, 0, i * 64, 256, 64, 32, 50, 58 + (r() - 0.5) * 6, r, 1.2);
  g.strokeStyle = 'rgba(60,35,10,0.5)';
  g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.stroke();
  }
  // frame
  const frame = (x: number, y: number, w: number, h: number) => {
    grain(g, x, y, w, h, 28, 55, 44, r, 1.4);
    g.strokeStyle = 'rgba(40,20,5,0.6)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  frame(0, 0, 256, 34);
  frame(0, 222, 256, 34);
  g.save();
  g.translate(0, 256);
  g.rotate(-Math.PI / 2);
  frame(0, 0, 256, 34);
  frame(0, 222, 256, 34);
  g.restore();
  // nails
  for (const [x, y] of [
    [17, 17],
    [239, 17],
    [17, 239],
    [239, 239],
  ]) {
    g.fillStyle = '#5b4a3a';
    g.beginPath();
    g.arc(x, y, 5, 0, 6.3);
    g.fill();
    g.fillStyle = '#b9a58e';
    g.beginPath();
    g.arc(x - 1, y - 1, 2.5, 0, 6.3);
    g.fill();
  }
  return tex(c);
}

/** equirect basketball skin */
export function basketballTexture(): THREE.Texture {
  const [c, g] = canvas(512, 256);
  const r = rng(5);
  g.fillStyle = '#e0761f';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,50,0,0.16)' : 'rgba(255,170,90,0.14)';
    g.fillRect(r() * 512, r() * 256, 1.6, 1.6);
  }
  g.strokeStyle = '#1d1512';
  g.lineWidth = 7;
  g.lineCap = 'round';
  // equator and two meridians
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(512, 128);
  g.stroke();
  for (const x of [0, 256, 512]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  // the two curved seams
  for (const cx of [128, 384]) {
    g.beginPath();
    for (let y = 0; y <= 256; y += 4) {
      const x = cx + Math.sin((y / 256) * Math.PI) * 0 + Math.cos((y / 256) * Math.PI * 2) * 46;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return tex(c);
}

/** equirect beach ball: six coloured gores and white caps */
export function beachballTexture(): THREE.Texture {
  const [c, g] = canvas(512, 256);
  const cols = ['#e8433f', '#ffffff', '#f6c21c', '#ffffff', '#2f8de0', '#ffffff'];
  for (let i = 0; i < 6; i++) {
    g.fillStyle = cols[i];
    g.fillRect((i * 512) / 6, 0, 512 / 6 + 1, 256);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 26);
  g.fillRect(0, 230, 512, 26);
  return tex(c);
}

/** steel ball: subtle brushed look with an engraved W so rolling is visible */
export function steelTexture(): THREE.Texture {
  const [c, g] = canvas(256, 128);
  const r = rng(9);
  g.fillStyle = '#e9edf2';
  g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '90,100,115' : '255,255,255'},${0.05 + r() * 0.07})`;
    g.fillRect(r() * 256, r() * 128, 20 + r() * 60, 1);
  }
  g.fillStyle = 'rgba(70,82,98,0.75)';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('W', 64, 66);
  g.fillText('W', 192, 66);
  g.strokeStyle = 'rgba(70,82,98,0.55)';
  g.lineWidth = 3;
  for (const x of [64, 192]) {
    g.beginPath();
    g.ellipse(x, 64, 22, 34, 0, 0, 6.3);
    g.stroke();
  }
  return tex(c);
}

/** conveyor belt rubber with chevrons, tiles along u */
export function beltTexture(): THREE.Texture {
  const [c, g] = canvas(128, 64);
  g.fillStyle = '#2b2f36';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#f2b824';
  g.lineWidth = 7;
  g.lineJoin = 'miter';
  for (let i = 0; i < 2; i++) {
    const x = i * 64 + 14;
    g.beginPath();
    g.moveTo(x, 8);
    g.lineTo(x + 22, 32);
    g.lineTo(x, 56);
    g.stroke();
  }
  return tex(c, true);
}

/** soft radial blob used for glows, dust and halos */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** soft rounded rectangle, stretched behind player parts as a halo */
export function haloTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.filter = 'blur(10px)';
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(26, 26, 76, 76, 22);
  g.fill();
  return new THREE.CanvasTexture(c);
}

/** streaks for the wind zone of a fan, scrolls along u */
export function windTexture(): THREE.Texture {
  const [c, g] = canvas(256, 128);
  const r = rng(21);
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 16; i++) {
    const y = 10 + r() * 108;
    const x = r() * 256;
    const len = 50 + r() * 70;
    const edge = 1 - Math.abs(y - 64) / 64;
    for (const off of [0, -256, 256]) {
      const gr = g.createLinearGradient(x + off, 0, x + off + len, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.7, `rgba(255,255,255,${0.75 * edge})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(x + off, y, len, 2.2 + r() * 2, 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** tiny contact shadow / dust puff */
export function puffTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** five-pointed star for fireworks and the win effect */
export function starTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  g.fillStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 ? 10 : 24;
    g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}
