import sharp from "sharp";

const MAX_DIMENSION = 2560;
const WEBP_QUALITY = 85;

const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

export async function maybeCompressImage(
  bytes: Uint8Array,
  mime: string,
  threshold: number,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (bytes.length <= threshold) return { bytes, mime };
  if (!COMPRESSIBLE.has(mime)) return { bytes, mime };

  try {
    const out = await sharp(bytes, { animated: false })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    if (out.length >= bytes.length) return { bytes, mime };
    return { bytes: new Uint8Array(out), mime: "image/webp" };
  } catch {
    return { bytes, mime };
  }
}
