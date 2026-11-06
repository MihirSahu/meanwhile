import { LineDecoder } from "./scene-schema";
import { SceneBuffer } from "./playback";

/** Decode through each record boundary so invalid UTF-8 cannot erase prior records. */
export class SceneStreamDecoder {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private lines = new LineDecoder();

  *push(chunk: Uint8Array | undefined, flush = false): Generator<unknown> {
    if (chunk) {
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start);
        const end = newline === -1 ? chunk.length : newline + 1;
        yield* this.lines.push(
          this.decoder.decode(chunk.subarray(start, end), { stream: true }),
        );
        start = end;
      }
    }
    if (flush) yield* this.lines.push(this.decoder.decode(), true);
  }
}

/** Cancellation guards every commit, including chunks already queued by fetch. */
export async function readSceneStream(
  response: Response,
  buffer: SceneBuffer,
  signal: AbortSignal,
  onCommit: () => void,
) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "The scene could not be started. Please try again.",
    );
  }
  if (!response.body)
    throw new Error("The scene provider returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new SceneStreamDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      for (const message of decoder.push(value, done)) {
        signal.throwIfAborted();
        buffer.ingest(message);
        onCommit();
      }
      if (done) break;
    }
    if (!buffer.complete)
      throw new Error(
        "The stream ended early. You can replay the available portion or try again.",
      );
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
