import { maybeCompressImage } from "@/lib/image-transform";
import { isAllowedImageMime, isR2Configured, uploadImageToR2 } from "@/lib/r2";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const COMPRESS_THRESHOLD = 1 * 1024 * 1024;

export async function POST(req: Request) {
  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error:
          "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL in .env.local",
      },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  if (!isAllowedImageMime(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 },
    );
  }

  try {
    const original = new Uint8Array(await file.arrayBuffer());
    const { bytes, mime } = await maybeCompressImage(original, file.type, COMPRESS_THRESHOLD);
    const { url, key } = await uploadImageToR2(bytes, mime);
    return NextResponse.json({ url, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
