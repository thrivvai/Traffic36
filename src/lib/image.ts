const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 4.5 * 1024 * 1024; // the server takes 5 MB; leave room for the form around it
const MAX_SIDE = 2400;

/**
 * Gets a payment screenshot ready to upload. Screenshots usually pass straight through. Large
 * photos, and formats the server doesn't take (like iPhone HEIC photos), are redrawn as a JPEG
 * small enough to send quickly on a phone connection.
 */
export async function prepareImage(file: File): Promise<File> {
  if (ACCEPTED.includes(file.type) && file.size <= MAX_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("We can't read that file. Upload a screenshot as a PNG or JPG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("We couldn't prepare that image. Try a different screenshot.");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

export type PhotoCheck = { dark: boolean; blurry: boolean; small: boolean };

const ID_MAX_SIDE = 2000;

/**
 * Gets a license photo or selfie ready to send. Always redrawn as a JPEG: that keeps the upload
 * small on a phone connection and strips hidden data like the GPS location a camera stamps on
 * photos. Also measures brightness and sharpness, so the renter can retake a bad shot before
 * the host has to reject it.
 */
export async function prepareIdPhoto(file: File): Promise<{ file: File; check: PhotoCheck }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("We can't read that file. Take the photo again, or choose a JPG or PNG.");
  }
  const scale = Math.min(1, ID_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const small = Math.max(bitmap.width, bitmap.height) < 900;
  bitmap.close();
  const check = { ...measure(canvas), small };
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("We couldn't prepare that photo. Try taking it again.");
  return { file: new File([blob], "photo.jpg", { type: "image/jpeg" }), check };
}

/** Average brightness and edge sharpness (variance of the Laplacian) on a small grayscale copy. */
function measure(source: HTMLCanvasElement): { dark: boolean; blurry: boolean } {
  const w = 320;
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w]! + gray[i + w]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const variance = n ? lapSq / n - (lapSum / n) ** 2 : 0;
  // Conservative cut-offs: these only suggest a retake, they never block the upload.
  return { dark: sum / (w * h) < 55, blurry: variance < 18 };
}
