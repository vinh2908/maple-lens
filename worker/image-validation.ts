import { AppError } from "../src/lib/api-errors";

// The UI always normalizes PNG/WebP/camera input to JPEG before upload.
// Read marker structure and dimensions without decoding untrusted pixels in the Worker.
export function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new AppError("INVALID_IMAGE", "Ảnh JPEG bị hỏng hoặc không đúng định dạng. Hãy chọn lại ảnh.", 415);
  }
  let at = 2;
  while (at + 4 < bytes.length) {
    if (bytes[at++] !== 0xff) break;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes[at] * 256 + bytes[at + 1];
    if (length < 2 || at + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) break;
      const height = bytes[at + 3] * 256 + bytes[at + 4];
      const width = bytes[at + 5] * 256 + bytes[at + 6];
      if (width < 24 || height < 24 || width * height > 24_000_000) throw new AppError("INVALID_IMAGE", "Ảnh quá nhỏ hoặc vượt quá 24 megapixel.", 415);
      return { width, height };
    }
    at += length;
  }
  throw new AppError("INVALID_IMAGE", "Không đọc được cấu trúc JPEG. Hãy chọn ảnh khác.", 415);
}
