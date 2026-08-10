const JPEG_START_FIRST_BYTE = 0xff;
const JPEG_START_SECOND_BYTE = 0xd8;
const JPEG_END_FIRST_BYTE = 0xff;
const JPEG_END_SECOND_BYTE = 0xd9;
const DEFAULT_INITIAL_CAPACITY_BYTES = 64 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const OVERSIZED_FRAME_RECOVERY_BYTES = 1024;

function markerIndex(
  bytes: Uint8Array,
  first: number,
  second: number,
  start: number,
  end: number,
): number {
  for (let index = start; index < end - 1; index += 1) {
    if (bytes[index] === first && bytes[index + 1] === second) return index;
  }
  return -1;
}

/**
 * Incrementally extracts JPEG frames without copying the buffered prefix for
 * every network chunk. Capacity grows geometrically, and scanning resumes from
 * the previous marker boundary.
 */
export class MjpegFrameBuffer {
  private bytes = new Uint8Array(DEFAULT_INITIAL_CAPACITY_BYTES);
  private frameStart: number | null = null;
  private length = 0;
  private scanOffset = 0;

  public constructor(
    private readonly maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
  ) {}

  public get bufferedBytes(): number {
    return this.length;
  }

  public push(chunk: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer>[] {
    if (chunk.length === 0) return [];

    this.ensureCapacity(this.length + chunk.length);
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;

    const frames: Uint8Array<ArrayBuffer>[] = [];
    while (this.length > 0) {
      if (this.frameStart === null) {
        const start = markerIndex(
          this.bytes,
          JPEG_START_FIRST_BYTE,
          JPEG_START_SECOND_BYTE,
          this.scanOffset,
          this.length,
        );
        if (start < 0) {
          const retainedBytes =
            this.bytes[this.length - 1] === JPEG_START_FIRST_BYTE ? 1 : 0;
          this.discardPrefix(this.length - retainedBytes);
          this.scanOffset = 0;
          break;
        }
        this.frameStart = start;
        this.scanOffset = start + 2;
      }

      const end = markerIndex(
        this.bytes,
        JPEG_END_FIRST_BYTE,
        JPEG_END_SECOND_BYTE,
        this.scanOffset,
        this.length,
      );
      if (end < 0) {
        this.scanOffset = Math.max(this.frameStart + 2, this.length - 1);
        if (this.frameStart > 0) {
          const discardedBytes = this.frameStart;
          this.discardPrefix(discardedBytes);
          this.frameStart = 0;
          this.scanOffset -= discardedBytes;
        }
        break;
      }

      frames.push(this.bytes.slice(this.frameStart, end + 2));
      this.discardPrefix(end + 2);
      this.frameStart = null;
      this.scanOffset = 0;
    }

    if (this.length > this.maxBufferedBytes) {
      const retainedBytes = Math.min(
        OVERSIZED_FRAME_RECOVERY_BYTES,
        this.maxBufferedBytes,
        this.length,
      );
      this.bytes.copyWithin(0, this.length - retainedBytes, this.length);
      this.length = retainedBytes;
      this.frameStart = null;
      this.scanOffset = 0;
    }

    return frames;
  }

  private discardPrefix(consumed: number): void {
    if (consumed <= 0) return;
    this.bytes.copyWithin(0, consumed, this.length);
    this.length -= consumed;
  }

  private ensureCapacity(requiredBytes: number): void {
    if (requiredBytes <= this.bytes.length) return;

    let capacity = this.bytes.length;
    while (capacity < requiredBytes) capacity *= 2;
    const expanded = new Uint8Array(capacity);
    expanded.set(this.bytes.subarray(0, this.length));
    this.bytes = expanded;
  }
}
