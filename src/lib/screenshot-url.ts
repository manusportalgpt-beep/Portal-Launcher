export function screenshotBytesToDataUrl(bytes: number[], fileName: string): string {
  const mime = /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : 'image/png';
  const data = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...data.subarray(offset, Math.min(offset + chunkSize, data.length))));
  }
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}
