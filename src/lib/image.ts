import { ACCEPTED_TYPES, MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES } from "./contracts";
import { detectPopupPixels, type PopupDetection } from "./popup-detection";

export type PixelCrop = { x: number; y: number; width: number; height: number };

const MAX_OUTPUT_DIM = 850;
const SCAN_DIM = 640;
const JPEG_QUALITY = 0.82;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không đọc được ảnh. Hãy chọn lại ảnh JPEG, PNG hoặc WebP."));
    image.src = src;
  });
}

export function canvasBlob(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Không xuất được ảnh. Hãy giảm kích thước và thử lại.")),
      "image/jpeg",
      quality
    )
  );
}

/**
 * Single-pass fast pipeline: validates, detects popup on a 640px scan canvas,
 * and encodes the cropped (or full) image once at <= 850px JPEG quality 0.82.
 */
export async function prepareAndCropFile(file: File): Promise<{ blob: Blob; detection: PopupDetection | null; elapsedMs: number }> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Chỉ hỗ trợ JPEG, PNG và WebP. Với ảnh HEIC trên iPhone, hãy xuất ảnh sang JPEG hoặc chụp bằng nút camera.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Ảnh gốc vượt quá 15 MB. Hãy chọn ảnh nhỏ hơn.");
  }

  const started = performance.now();
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const nw = image.naturalWidth;
    const nh = image.naturalHeight;
    if (nw * nh > 40_000_000) {
      throw new Error("Ảnh vượt quá 40 megapixel. Hãy giảm kích thước trước khi chọn.");
    }

    // 1. Scan for popup on a fast 640px canvas
    let detection: PopupDetection | null = null;
    const scanScale = Math.min(1, SCAN_DIM / Math.max(nw, nh));
    const scanW = Math.max(1, Math.round(nw * scanScale));
    const scanH = Math.max(1, Math.round(nh * scanScale));
    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = scanW;
    scanCanvas.height = scanH;
    const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    if (!scanCtx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
    scanCtx.drawImage(image, 0, 0, scanW, scanH);
    try {
      const pixels = scanCtx.getImageData(0, 0, scanW, scanH);
      detection = detectPopupPixels(pixels.data, pixels.width, pixels.height);
    } catch {
      detection = null;
    }

    // 2. Compute exact source crop rectangle in original coordinates
    let sx = 0, sy = 0, sw = nw, sh = nh;
    if (detection && !detection.alreadyFramed) {
      const rx = nw / scanW;
      const ry = nh / scanH;
      const b = detection.bounds;
      sx = Math.max(0, Math.floor(b.x * rx));
      sy = Math.max(0, Math.floor(b.y * ry));
      sw = Math.min(nw - sx, Math.max(1, Math.ceil(b.width * rx)));
      sh = Math.min(nh - sy, Math.max(1, Math.ceil(b.height * ry)));
    }

    // 3. Draw cropped region ONCE onto output canvas capped at MAX_OUTPUT_DIM
    const outScale = Math.min(1, MAX_OUTPUT_DIM / Math.max(sw, sh));
    const outCanvas = document.createElement("canvas");
    outCanvas.width = Math.max(1, Math.round(sw * outScale));
    outCanvas.height = Math.max(1, Math.round(sh * outScale));
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
    outCtx.drawImage(image, sx, sy, sw, sh, 0, 0, outCanvas.width, outCanvas.height);

    const blob = await canvasBlob(outCanvas, JPEG_QUALITY);
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("Ảnh sau xử lý vượt quá 4 MB. Hãy chọn vùng nhỏ hơn.");
    }
    return { blob, detection, elapsedMs: Math.round(performance.now() - started) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareFile(file: File): Promise<Blob> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Chỉ hỗ trợ JPEG, PNG và WebP. Với ảnh HEIC trên iPhone, hãy xuất ảnh sang JPEG hoặc chụp bằng nút camera.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Ảnh gốc vượt quá 15 MB. Hãy chọn ảnh nhỏ hơn.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Ảnh vượt quá 40 megapixel. Hãy giảm kích thước trước khi chọn.");
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh.");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, JPEG_QUALITY);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Ảnh sau xử lý vượt quá 4 MB. Hãy chọn vùng nhỏ hơn.");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

export async function cropImage(src: string, crop: PixelCrop, rotation: number): Promise<Blob> {
  const image = await loadImage(src);
  const radians = rotation * Math.PI / 180;
  const rotated = document.createElement("canvas");
  rotated.width = Math.round(Math.abs(Math.cos(radians) * image.width) + Math.abs(Math.sin(radians) * image.height));
  rotated.height = Math.round(Math.abs(Math.sin(radians) * image.width) + Math.abs(Math.cos(radians) * image.height));
  const ctx = rotated.getContext("2d");
  if (!ctx) throw new Error("Không thể xử lý ảnh.");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, rotated.width, rotated.height);
  ctx.translate(rotated.width / 2, rotated.height / 2); ctx.rotate(radians);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(crop.width, crop.height));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(crop.width * scale));
  output.height = Math.max(1, Math.round(crop.height * scale));
  output.getContext("2d")!.drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  return canvasBlob(output, JPEG_QUALITY);
}

export async function autoCropPopup(blob: Blob): Promise<{ blob: Blob; detection: PopupDetection | null; elapsedMs: number }> {
  const started = performance.now(); const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url); const scale = Math.min(1, SCAN_DIM / Math.max(image.width, image.height));
    const scan = document.createElement("canvas"); scan.width = Math.round(image.width * scale); scan.height = Math.round(image.height * scale);
    const context = scan.getContext("2d", { willReadFrequently: true });
    if (!context) return { blob, detection: null, elapsedMs: Math.round(performance.now() - started) };
    context.drawImage(image, 0, 0, scan.width, scan.height);
    const pixels = context.getImageData(0, 0, scan.width, scan.height);
    const detection = detectPopupPixels(pixels.data, pixels.width, pixels.height);
    if (!detection || detection.alreadyFramed) return { blob, detection, elapsedMs: Math.round(performance.now() - started) };
    const sx = image.width / scan.width; const sy = image.height / scan.height;
    const bounds = detection.bounds;
    const result = await cropImage(url, { x: Math.floor(bounds.x * sx), y: Math.floor(bounds.y * sy), width: Math.min(image.width - Math.floor(bounds.x * sx), Math.ceil(bounds.width * sx)), height: Math.min(image.height - Math.floor(bounds.y * sy), Math.ceil(bounds.height * sy)) }, 0);
    return { blob: result, detection, elapsedMs: Math.round(performance.now() - started) };
  } catch {
    return { blob, detection: null, elapsedMs: Math.round(performance.now() - started) };
  } finally { URL.revokeObjectURL(url); }
}
