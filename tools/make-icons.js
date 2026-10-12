// Genera le icone PNG dell'estensione (lente bianca su quadrato verde Agria) senza dipendenze:
// disegno con sovracampionamento per i bordi morbidi, PNG scritto a mano con zlib di Node.
//   node tools/make-icons.js

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
const GREEN = [59, 106, 58];
const WHITE = [255, 255, 255];
const SAMPLES = 4;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit per canale
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// coordinate da 0 a 1
const inRoundedSquare = (x, y, r = 0.22) => {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
};
const inLens = (x, y) => {
  const ring = Math.abs(Math.hypot(x - 0.43, y - 0.43) - 0.2) <= 0.055;
  // manico: segmento da (0.58,0.58) a (0.77,0.77) con raggio 0.065
  const t = Math.min(Math.max(((x - 0.58) + (y - 0.58)) / (2 * 0.19), 0), 1);
  const handle = Math.hypot(x - (0.58 + 0.19 * t), y - (0.58 + 0.19 * t)) <= 0.065;
  return ring || handle;
};

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y)) continue;
          const color = inLens(x, y) ? WHITE : GREEN;
          covered += 1;
          for (let c = 0; c < 3; c += 1) sum[c] += color[c];
        }
      }
      const i = (py * size + px) * 4;
      if (covered) for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(sum[c] / covered);
      rgba[i + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return rgba;
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(OUT, `icon-${size}.png`), png(size, draw(size)));
  console.log(`icons/icon-${size}.png`);
}
