/**
 * Сжатие фото перед загрузкой: длинная сторона ≤ maxSide, JPEG ~75%.
 * Кадр с телефона 3–8 МБ превращается в ~150–300 КБ — критично для
 * Free tier (1 ГБ Storage) и мобильного интернета в мастерской.
 * Если сжатие не даёт выигрыша или файл не декодируется как картинка —
 * возвращаем оригинал.
 */
export async function compressImage(file: File, maxSide = 1920, quality = 0.75): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
