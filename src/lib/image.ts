// Client-side image helpers: read a File as a data URL and downscale/compress
// it to a JPEG base64 string before uploading. Keeps avatar/bill uploads small.

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImage(
  file: File,
  max = 1800
): Promise<{ base64: string; mimeType: string }> {
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });

    let { width, height } = img;
    if (Math.max(width, height) > max) {
      const scale = max / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, width, height);

    const out = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = out.split(",")[1] ?? "";
    if (!base64) throw new Error("empty canvas output");
    return { base64, mimeType: "image/jpeg" };
  } catch {
    const dataUrl = await readAsDataUrl(file);
    return { base64: dataUrl.split(",")[1] ?? "", mimeType: file.type || "image/jpeg" };
  }
}
