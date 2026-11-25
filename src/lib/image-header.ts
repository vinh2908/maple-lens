import { AppError } from "./api-errors";
import { ACCEPTED_TYPES } from "./contracts";

/**
 * Pure TypeScript magic-bytes validation for JPEG, PNG, and WebP.
 * Throws AppError("INVALID_IMAGE", ..., 415) if bytes do not match fileType.
 */
export function assertValidImageHeader(bytes: Uint8Array, fileType: string): void {
  if (!ACCEPTED_TYPES.includes(fileType)) {
    throw new AppError("INVALID_IMAGE_TYPE", "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.", 415);
  }
  if (fileType === "image/jpeg") {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new AppError("INVALID_IMAGE", "Ảnh hỏng hoặc không đúng định dạng JPEG.", 415);
    }
    return;
  }
  if (fileType === "image/png") {
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
      bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
    ) {
      throw new AppError("INVALID_IMAGE", "Ảnh hỏng hoặc không đúng định dạng PNG.", 415);
    }
    return;
  }
  if (fileType === "image/webp") {
    if (
      bytes.length < 12 ||
      bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
      bytes[8] !== 0x57 || bytes[9] !== 0x45 || bytes[10] !== 0x42 || bytes[11] !== 0x50
    ) {
      throw new AppError("INVALID_IMAGE", "Ảnh hỏng hoặc không đúng định dạng WebP.", 415);
    }
  }
}
