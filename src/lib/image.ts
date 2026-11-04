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
