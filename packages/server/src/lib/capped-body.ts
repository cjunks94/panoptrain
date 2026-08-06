/**
 * Reads a fetch Response body into memory while enforcing a hard byte ceiling
 * *during* the read (#130).
 *
 * `res.arrayBuffer()` cannot be used for this: it buffers the entire body
 * before returning, so a size check on its result runs only after the
 * allocation has already happened. `Content-Length` is a hint, not a
 * guarantee — it may be absent entirely under chunked transfer encoding, or
 * simply not match the bytes that follow. Checking it alone therefore leaves
 * the process exposed to an endpoint that misbehaves or has been substituted,
 * which is precisely the case the ceiling exists to bound.
 *
 * Streaming and counting as we go means the read aborts partway through
 * instead of after the damage is done.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    throw new Error("Response has no body to read");
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      // Cancel so the connection is torn down rather than left draining.
      await reader.cancel().catch(() => {});
      throw new Error(`Response body exceeded ${maxBytes} bytes (read ${total} so far)`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
