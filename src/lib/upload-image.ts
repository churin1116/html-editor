// Newly inserted images are capped at this display width (natural width wins
// when smaller). Users can drag the corner handle to resize afterwards.
export const DEFAULT_IMAGE_WIDTH = 670;

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload-image", { method: "POST", body: form });
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}

// Measure the image's natural size locally (object URL, no network) so the
// insert can pick min(natural, DEFAULT_IMAGE_WIDTH) — small icons shouldn't
// be blown up to the cap. Returns null when the file can't be decoded.
export function measureImageFile(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Trim the last dotted extension off an image filename for use as alt text.
// "diagram.png" → "diagram", "no-extension" → "no-extension".
export function stripImageExtension(name: string | undefined | null): string {
  if (!name) return "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

export function extractImageFilesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith("image/")) out.push(f);
    }
  }
  if (out.length === 0 && dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f?.type.startsWith("image/")) out.push(f);
      }
    }
  }
  return out;
}
