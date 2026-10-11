// An image ready to send: its type, base64 bytes, and a data URL to preview it with.
export type ComposerImage = {
  readonly id: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  readonly data: string;
  readonly url: string;
};

const SUPPORTED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
// The Messages API scales anything larger down to this long edge anyway.
const MAX_EDGE = 1568;
// Keeps the base64 form under the API's 5 MB per-image limit.
const MAX_BYTES = 3_750_000;

const isSupported = (type: string): type is ComposerImage["mediaType"] =>
  SUPPORTED.has(type);

const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unreadable image")),
    );
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });

// Redraws the image no larger than MAX_EDGE as WebP, which keeps transparency.
const shrink = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
};

const tooBig = async (file: File) => {
  if (file.size > MAX_BYTES) return true;
  const bitmap = await createImageBitmap(file);
  const big = Math.max(bitmap.width, bitmap.height) > MAX_EDGE;
  bitmap.close();
  return big;
};

// Reads a pasted, dropped, or picked file as an image to send, or undefined if it isn't one.
export const readImage = async (
  file: File,
): Promise<ComposerImage | undefined> => {
  if (!isSupported(file.type)) return undefined;
  const blob = (await tooBig(file)) ? await shrink(file) : file;
  const mediaType = isSupported(blob.type) ? blob.type : file.type;
  const url = await dataUrlOf(blob);
  return {
    id: crypto.randomUUID(),
    mediaType,
    data: url.slice(url.indexOf(",") + 1),
    url,
  };
};

export const imageFiles = (files: FileList | null | undefined) =>
  Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
