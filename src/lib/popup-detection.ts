export type PopupType = "distorted_text" | "sentence_choice" | "unknown";
export type PopupBounds = { x: number; y: number; width: number; height: number };
export type PopupDetection = { bounds: PopupBounds; typeHint: PopupType; kind: "blue" | "light"; alreadyFramed: boolean };
type Region = PopupBounds & { count: number };

function components(mask: Uint8Array, width: number, height: number, minArea: number): Region[] {
  const seen = new Uint8Array(mask.length); const queue = new Int32Array(mask.length); const regions: Region[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let start = 0; let end = 1; queue[0] = seed; seen[seed] = 1;
    let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    while (start < end) {
      const at = queue[start++]; const x = at % width; const y = (at / width) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x && mask[at - 1] && !seen[at - 1]) { seen[at - 1] = 1; queue[end++] = at - 1; }
      if (x + 1 < width && mask[at + 1] && !seen[at + 1]) { seen[at + 1] = 1; queue[end++] = at + 1; }
      if (y && mask[at - width] && !seen[at - width]) { seen[at - width] = 1; queue[end++] = at - width; }
      if (y + 1 < height && mask[at + width] && !seen[at + width]) { seen[at + width] = 1; queue[end++] = at + width; }
    }
    if (end >= minArea) regions.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, count: end });
  }
  return regions;
}

function layout(data: Uint8ClampedArray, width: number, region: PopupBounds): { type: PopupType; hasText: boolean } {
  const rw = region.width;
  const rh = region.height;
  const yStart = Math.round(region.y + rh * 0.10);
  const yEnd = Math.round(region.y + rh * 0.96);
  const x1 = Math.round(region.x + rw * 0.08);
  const x2 = Math.round(region.x + rw * 0.92);
  const span = Math.max(1, x2 - x1);

  // Dynamically sample the card's dominant background color from the top section
  let sumR = 0, sumG = 0, sumB = 0, samples = 0;
  for (let s = 0; s < 12; s++) {
    const x = Math.round(region.x + rw * 0.15 + (s / 12) * rw * 0.7);
    const y = Math.round(region.y + rh * 0.12);
    const idx = (y * width + x) * 4;
    sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2];
    samples++;
  }
  const cr = samples ? sumR / samples : 40;
  const cg = samples ? sumG / samples : 80;
  const cb = samples ? sumB / samples : 140;

  // Track wide horizontal contrast bars (>= 60% of card width)
  let separateBars = 0;
  let inBar = false;
  let maxBarHeight = 0;
  let currentBarHeight = 0;
  let textRows = 0;

  for (let y = yStart; y < yEnd; y++) {
    let contrastPixels = 0;
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 4;
      const diff = Math.abs(data[idx] - cr) + Math.abs(data[idx + 1] - cg) + Math.abs(data[idx + 2] - cb);
      if (diff > 42) contrastPixels++;
    }

    const ratio = contrastPixels / span;
    const isWideBar = ratio > 0.58;

    if (isWideBar) {
      if (!inBar) {
        separateBars++;
        inBar = true;
        currentBarHeight = 0;
      }
      currentBarHeight++;
      if (currentBarHeight > maxBarHeight) maxBarHeight = currentBarHeight;
    } else {
      inBar = false;
    }

    if (ratio > 0.012) textRows++;
  }

  // 3+ separate option bars: sentence_choice (Dạng 2 - Chọn câu)
  if (separateBars >= 3) return { type: "sentence_choice", hasText: true };
  // 1 or 2 prominent wide blocks with height >= 6% of card: distorted_text (Dạng 1 - Chữ biến dạng)
  if (maxBarHeight >= Math.max(3, rh * 0.055)) return { type: "distorted_text", hasText: true };
  return { type: "unknown", hasText: textRows > rh * 0.015 };
}

// Universal color-agnostic layout detector.
// Works for ANY card color (Blue, Charcoal, Purple, Brown, Green, Light)
// and ANY captcha box color (Lime green, Magenta, Pink, Cyan, Yellow, Orange, White).
export function detectPopupPixels(data: Uint8ClampedArray, width: number, height: number): PopupDetection | null {
  if (width < 40 || height < 40 || data.length !== width * height * 4) return null;

  const totalPixels = width * height;
  const blue = new Uint8Array(totalPixels);
  const dark = new Uint8Array(totalPixels);
  const purple = new Uint8Array(totalPixels);
  const warm = new Uint8Array(totalPixels);
  const green = new Uint8Array(totalPixels);
  const light = new Uint8Array(totalPixels);

  for (let p = 0; p < totalPixels; p++) {
    const i = p * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    // Blue / Navy cards
    blue[p] = Number(b > 50 && b > r * 1.15 && b > g * 1.05 && r < 185);
    // Dark grey / Charcoal / Black cards
    dark[p] = Number(Math.max(r, g, b) < 100 && Math.max(r, g, b) - Math.min(r, g, b) < 35);
    // Purple / Violet cards
    purple[p] = Number(r > 55 && b > 65 && r > g * 1.15 && b > g * 1.15);
    // Warm / Brown / Red cards
    warm[p] = Number(r > 60 && r > b * 1.15 && r > g * 1.05 && b < 120);
    // Dark Green / Forest cards
    green[p] = Number(g > 55 && g > r * 1.15 && g > b * 1.05);
    // Light / Cream / Grey cards
    light[p] = Number(Math.min(r, g, b) > 130 && Math.max(r, g, b) - Math.min(r, g, b) < 95);
  }

  const minimum = Math.max(160, Math.round(totalPixels * 0.005));
  const masks = [
    ["blue", blue],
    ["dark", dark],
    ["purple", purple],
    ["warm", warm],
    ["green", green],
    ["light", light]
  ] as const;

  const candidates: (PopupDetection & { score: number })[] = [];

  for (const [kind, mask] of masks) {
    for (const region of components(mask, width, height, minimum)) {
      const ratio = region.width / region.height;
      const area = region.width * region.height;
      const fraction = area / totalPixels;
      const fill = region.count / area;

      if (region.width < 50 || region.height < 50 || ratio < 0.45 || ratio > 2.8 || fraction < 0.012) continue;
      if (fill < (kind === "light" ? 0.65 : 0.28)) continue;

      const hint = layout(data, width, region);
      if (!hint.hasText) continue;
      if (hint.type === "unknown" && fraction < 0.04) continue;

      const padX = Math.max(3, Math.round(region.width * 0.025));
      const padY = Math.max(4, Math.round(region.height * 0.035));
      const x = Math.max(0, region.x - padX);
      const y = Math.max(0, region.y - padY);
      const right = Math.min(width, region.x + region.width + padX);
      const bottom = Math.min(height, region.y + region.height + padY);

      candidates.push({
        bounds: { x, y, width: right - x, height: bottom - y },
        typeHint: hint.type,
        kind: kind === "blue" ? "blue" : "light",
        alreadyFramed: fraction > 0.82,
        score: (kind === "blue" ? 25 : 0) + (hint.type !== "unknown" ? 10 : 0) + Math.sqrt(fraction) * 2 + fill
      });
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  return { bounds: best.bounds, typeHint: best.typeHint, kind: best.kind, alreadyFramed: best.alreadyFramed };
}
