// Pure-TypeScript image header inspection (no native dependencies).
//
// Reads the container header and dimensions for JPEG/PNG/WebP without
// decoding pixels. The client already normalizes uploads before sending
// (max 1200px, JPEG 0.88, max 4 MB), so the server only needs to confirm
// the bytes are a real, single-frame image of the declared format.
//
// Throws Error("INVALID_FORMAT") for a bad/unknown header or a format
// mismatch, Error("TOO_SMALL") when a side is under 24px, and
// Error("TOO_MANY_PIXELS") when width * height exceeds 24M pixels —
// the same failure classes the old native-decoder checks produced, so
// callers can map every failure to INVALID_IMAGE (415) as before.

export type ImageFormat = "image/jpeg" | "image/png" | "image/webp";

export interface ImageDimensions {
  format: ImageFormat;
  width: number;
  height: number;
}

export const MAX_IMAGE_PIXELS = 24_000_000;
export const MIN_IMAGE_SIDE = 24;

function fail(message: string): never {
  throw new Error(message);
}

function u16be(b: Buffer, o: number): number {
  return b.readUInt16BE(o);
}
function u32be(b: Buffer, o: number): number {
  return b.readUInt32BE(o);
}
function u16le(b: Buffer, o: number): number {
  return b.readUInt16LE(o);
}
function u24le(b: Buffer, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function u32le(b: Buffer, o: number): number {
  return b.readUInt32LE(o);
}

function checkSize(width: number, height: number): void {
  if (!width || !height || width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) fail("TOO_SMALL");
  if (width * height > MAX_IMAGE_PIXELS) fail("TOO_MANY_PIXELS");
}

// JPEG: SOI (FF D8), then length-prefixed segments until a SOF0/1/2
// marker gives width/height. Stops at SOS/EOI (no SOF before the scan
// data means the file is not a decodable still image).
function jpegDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("INVALID_FORMAT");
  let pos = 2;
  for (;;) {
    if (pos + 1 >= bytes.length) fail("INVALID_FORMAT");
    if (bytes[pos] !== 0xff) fail("INVALID_FORMAT");
    let marker = bytes[pos + 1];
    // Skip 0xFF fill bytes before the marker code.
    while (marker === 0xff) {
      pos += 1;
      if (pos + 1 >= bytes.length) fail("INVALID_FORMAT");
      marker = bytes[pos + 1];
    }
    pos += 2; // pos now points at the segment length field (standalone markers have none)
    if (marker === 0xd8) continue; // SOI (tolerate a repeat)
    if (marker === 0xd9 || marker === 0xda) fail("INVALID_FORMAT"); // EOI / SOS before any SOF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone, no length
    if (pos + 2 > bytes.length) fail("INVALID_FORMAT");
    const length = u16be(bytes, pos);
    if (length < 2 || pos + length > bytes.length) fail("INVALID_FORMAT");
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // SOF: precision (1), height (2), width (2).
      if (length < 7) fail("INVALID_FORMAT");
      const height = u16be(bytes, pos + 3);
      const width = u16be(bytes, pos + 5);
      checkSize(width, height);
      return { format: "image/jpeg", width, height };
    }
    pos += length;
  }
}

// PNG: 8-byte signature, IHDR chunk gives width/height. Scan on to the
// first IDAT chunk: an acTL chunk before it means animated APNG, which
// is rejected (multi-frame, like the old animated: false option).
function pngDimensions(bytes: Buffer): ImageDimensions {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || !signature.every((v, i) => bytes[i] === v)) fail("INVALID_FORMAT");
  let pos = 8;
  let dims: ImageDimensions | null = null;
  for (;;) {
    if (pos + 8 > bytes.length) fail("INVALID_FORMAT");
    const length = u32be(bytes, pos);
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (pos + 12 + length > bytes.length) fail("INVALID_FORMAT");
    if (type === "IHDR") {
      if (length !== 13) fail("INVALID_FORMAT");
      const width = u32be(bytes, pos + 8);
      const height = u32be(bytes, pos + 12);
      checkSize(width, height);
      dims = { format: "image/png", width, height };
    } else if (type === "acTL") {
      fail("MULTI_FRAME");
    } else if (type === "IDAT" || type === "IEND") {
      if (!dims) fail("INVALID_FORMAT");
      return dims;
    }
    pos += 12 + length;
  }
}

// WebP: RIFF....WEBP, then chunks. The first chunk decides the format:
// VP8X (extended, check the animation flag), VP8 (lossy), VP8L (lossless).
function webpDimensions(bytes: Buffer): ImageDimensions {
  if (
    bytes.length < 12 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP"
  ) {
    fail("INVALID_FORMAT");
  }
  let pos = 12;
  if (pos + 8 > bytes.length) fail("INVALID_FORMAT");
  const type = bytes.toString("latin1", pos, pos + 4);
  const size = u32le(bytes, pos + 4);
  const start = pos + 8;
  if (start + size > bytes.length) fail("INVALID_FORMAT");
  if (type === "VP8X") {
    if (size < 10) fail("INVALID_FORMAT");
    if (bytes[start] & 0x02) fail("MULTI_FRAME"); // animation flag
    const width = u24le(bytes, start + 4) + 1;
    const height = u24le(bytes, start + 7) + 1;
    checkSize(width, height);
    return { format: "image/webp", width, height };
  }
  if (type === "VP8 ") {
    if (size < 10) fail("INVALID_FORMAT");
    if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) {
      fail("INVALID_FORMAT");
    }
    const width = u16le(bytes, start + 6) & 0x3fff;
    const height = u16le(bytes, start + 8) & 0x3fff;
    checkSize(width, height);
    return { format: "image/webp", width, height };
  }
  if (type === "VP8L") {
    if (size < 5) fail("INVALID_FORMAT");
    if (bytes[start] !== 0x2f) fail("INVALID_FORMAT");
    const bits = u32le(bytes, start + 1);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    checkSize(width, height);
    return { format: "image/webp", width, height };
  }
  fail("INVALID_FORMAT");
}

export function inspectImageHeader(bytes: Buffer): ImageDimensions {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes);
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return pngDimensions(bytes);
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return webpDimensions(bytes);
  }
  fail("INVALID_FORMAT");
}
