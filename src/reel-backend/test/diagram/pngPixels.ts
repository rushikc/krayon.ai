import { inflateSync } from "node:zlib";

export function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePngRgba(buf: Buffer): { width: number; height: number; raw: Buffer } {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a png");
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported png bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const idats: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") idats.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src]!;
    src += 1;
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const dest = y * stride;
    const prev = y === 0 ? null : raw.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i += 1) {
      const x = row[i]!;
      const a = i >= bpp ? raw[dest + i - bpp]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= bpp ? prev[i - bpp]! : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 255;
      else if (filter === 2) val = (x + b) & 255;
      else if (filter === 3) val = (x + Math.floor((a + b) / 2)) & 255;
      else if (filter === 4) val = (x + paeth(a, b, c)) & 255;
      else if (filter !== 0) throw new Error(`png filter ${filter}`);
      raw[dest + i] = val;
    }
  }
  return { width, height, raw };
}

/** Decode 8-bit RGBA PNG. Returns [r,g,b,a] at each corner. */
export function pngCornerRgba(buf: Buffer): {
  width: number;
  height: number;
  tl: [number, number, number, number];
  tr: [number, number, number, number];
  bl: [number, number, number, number];
  br: [number, number, number, number];
} {
  const { width, height, raw } = decodePngRgba(buf);
  const stride = width * 4;
  const px = (x: number, y: number): [number, number, number, number] => {
    const i = y * stride + x * 4;
    return [raw[i]!, raw[i + 1]!, raw[i + 2]!, raw[i + 3]!];
  };
  return {
    width,
    height,
    tl: px(0, 0),
    tr: px(width - 1, 0),
    bl: px(0, height - 1),
    br: px(width - 1, height - 1),
  };
}

export function inkTouchesRightOrBottom(buf: Buffer): boolean {
  const { width, height, raw } = decodePngRgba(buf);
  const stride = width * 4;
  const ink = (x: number, y: number) => {
    const i = y * stride + x * 4;
    return !isWhite([raw[i]!, raw[i + 1]!, raw[i + 2]!, raw[i + 3]!]);
  };
  for (let y = 0; y < height; y += 1) {
    if (ink(width - 1, y)) return true;
  }
  for (let x = 0; x < width; x += 1) {
    if (ink(x, height - 1)) return true;
  }
  return false;
}

export function isWhite(rgba: [number, number, number, number]): boolean {
  return rgba[0] >= 250 && rgba[1] >= 250 && rgba[2] >= 250;
}
