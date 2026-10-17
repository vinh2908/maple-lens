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
  const rowStart = Math.round(region.y + region.height * .12); const rowEnd = Math.round(region.y + region.height * .96);
  const x1 = Math.round(region.x + region.width * .1); const x2 = Math.round(region.x + region.width * .9);
  let lightRuns = 0; let inLight = false; let magentaRows = 0; let textRows = 0;
  for (let y = rowStart; y < rowEnd; y++) {
    let light = 0; let magenta = 0; let contrast = 0;
    for (let x = x1; x < x2; x++) {
      const i = (y * width + x) * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      if (r > 135 && g > 145 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 100) light++;
      if (r > 95 && b > 75 && r > g * 1.35 && b > g * 1.25) magenta++;
      if (r > 160 && g > 160 && b > 160) contrast++;
    }
    const span = Math.max(1, x2 - x1); const bar = light / span > .58;
    if (bar && !inLight) lightRuns++; inLight = bar;
    if (magenta / span > .22) magentaRows++;
    if (contrast / span > .015) textRows++;
  }
  if (magentaRows > Math.max(3, region.height * .035)) return { type: "distorted_text", hasText: true };
  if (lightRuns >= 3) return { type: "sentence_choice", hasText: true };
  return { type: "unknown", hasText: textRows > region.height * .025 };
}

// Conservative image-layout detector, not OCR. It never guesses Korean characters.
// Pixel work runs on a <=720 px image; the returned crop is applied to the original.
export function detectPopupPixels(data: Uint8ClampedArray, width: number, height: number): PopupDetection | null {
  if (width < 40 || height < 40 || data.length !== width * height * 4) return null;
  const blue = new Uint8Array(width * height); const light = new Uint8Array(width * height);
  for (let p = 0; p < blue.length; p++) {
    const i = p * 4; const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    blue[p] = Number(b > 65 && b > r * 1.25 && b > g * 1.12 && r < 170);
    light[p] = Number(Math.min(r, g, b) > 140 && Math.max(r, g, b) - Math.min(r, g, b) < 95);
  }
  const minimum = Math.max(180, Math.round(width * height * .006));
  const candidates: (PopupDetection & { score: number })[] = [];
  for (const [kind, mask] of [["blue", blue], ["light", light]] as const) {
    for (const region of components(mask, width, height, minimum)) {
      const ratio = region.width / region.height; const area = region.width * region.height;
      const fraction = area / (width * height); const fill = region.count / area;
      if (region.width < 55 || region.height < 55 || ratio < .45 || ratio > 3.1 || fraction < .012) continue;
      if (kind === "blue" && fill < .35 || kind === "light" && fill < .68) continue;
      const hint = layout(data, width, region);
      if (kind === "blue" && (!hint.hasText || hint.type === "unknown" && fraction < .65)) continue;
      if (kind === "light") {
        let dark = 0; let total = 0;
        for (let y = region.y + 2; y < region.y + region.height - 2; y += 2) for (let x = region.x + 2; x < region.x + region.width - 2; x += 2) {
          const at = (y * width + x) * 4; total++;
          if ((data[at] + data[at + 1] + data[at + 2]) / 3 < 115) dark++;
        }
        if (!total || dark / total < .012 || dark / total > .32 || fraction > .9) continue;
      }
      const padding = Math.max(3, Math.round(Math.min(region.width, region.height) * .025));
      const x = Math.max(0, region.x - padding); const y = Math.max(0, region.y - padding);
      const right = Math.min(width, region.x + region.width + padding); const bottom = Math.min(height, region.y + region.height + padding);
      candidates.push({ bounds: { x, y, width: right - x, height: bottom - y }, typeHint: hint.type, kind, alreadyFramed: fraction > .86,
        score: (kind === "blue" ? 4 : 0) + (hint.type !== "unknown" ? 4 : 0) + Math.sqrt(fraction) + fill });
    }
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  return { bounds: best.bounds, typeHint: best.typeHint, kind: best.kind, alreadyFramed: best.alreadyFramed };
}
