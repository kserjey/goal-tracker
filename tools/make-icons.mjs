/**
 * Generates the PWA icons from code so they are reproducible and reviewable.
 * The mark mirrors `.cell.on` in styles.css: a light check on the dark --done
 * colour. Run: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x3a, 0x30, 0x30];   // --done (light theme)
const INK = [0xf0, 0xe8, 0xd8];  // --done-ink
const SS = 4;                    // supersampling factor

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** Coverage of the check mark at unit coords, 0..1 */
const inCheck = (x, y) => {
  const w = 0.085;
  return distSeg(x, y, 0.26, 0.52, 0.43, 0.69) < w || distSeg(x, y, 0.43, 0.69, 0.75, 0.33) < w;
};

/** Rounded-rect test in unit coords with corner radius r (0 = square). */
const inRect = (x, y, r) => {
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
};

function render(size, radius) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, ink = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / size, uy = (y + (sy + 0.5) / SS) / size;
          if (!inRect(ux, uy, radius)) continue;
          bg++;
          if (inCheck(ux, uy)) ink++;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const a = bg / n;                       // shape coverage
      const k = bg ? ink / bg : 0;            // ink within the shape
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - k) + INK[c] * k);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TBL = null;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TBL[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TBL[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const out = [
  ['public/icon-192.png', 192, 0.22],
  ['public/icon-512.png', 512, 0.22],
  // Maskable must be full-bleed: the OS applies its own (possibly circular) mask.
  ['public/icon-maskable-512.png', 512, 0],
];
for (const [path, size, radius] of out) {
  writeFileSync(path, png(size, render(size, radius)));
  console.log('wrote', path, size);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#3a3030"/>
<path d="M26 52 L43 69 L75 33" fill="none" stroke="#f0e8d8" stroke-width="8.5"
 stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
writeFileSync('public/icon.svg', svg);
console.log('wrote public/icon.svg');
