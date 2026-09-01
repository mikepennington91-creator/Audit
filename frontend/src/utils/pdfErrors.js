// Axios returns error bodies as Blobs when the PDF request uses responseType: blob.
export async function pdfErrorMessage(error, fallback = 'Failed to download PDF') {
  try {
    let data = error.response?.data;
    if (typeof data?.text === 'function') data = await data.text();
    if (typeof data === 'string') data = JSON.parse(data);
    if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail;
  } catch {
    // Non-JSON proxy/server errors still need a useful, stable message.
  }
  return fallback;
}
