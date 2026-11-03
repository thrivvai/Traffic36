import { getStore } from "@netlify/blobs";

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Where payment screenshots are kept. Private: only the API reads them, after checking who's asking. */
export interface ProofStore {
  put(key: string, data: ArrayBuffer, contentType: ImageType): Promise<void>;
  get(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
}

export function blobProofStore(): ProofStore {
  const store = () => getStore({ name: "payment-proofs", consistency: "strong" });
  return {
    async put(key, data, contentType) {
      await store().set(key, data, { metadata: { contentType } });
    },
    async get(key) {
      const blob = await store().getWithMetadata(key, { type: "arrayBuffer" });
      if (!blob) return null;
      const contentType = typeof blob.metadata.contentType === "string" ? blob.metadata.contentType : "application/octet-stream";
      return { data: blob.data, contentType };
    },
  };
}

/**
 * The real type of an uploaded image, read from its first bytes. The browser's claimed type is
 * ignored, so a file renamed to .png can't slip through.
 */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
