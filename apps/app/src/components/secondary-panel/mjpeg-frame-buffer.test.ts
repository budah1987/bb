import { describe, expect, it } from "vitest";
import { MjpegFrameBuffer } from "./mjpeg-frame-buffer";

describe("MjpegFrameBuffer", () => {
  it("extracts a frame whose markers cross chunk boundaries", () => {
    const buffer = new MjpegFrameBuffer();

    expect(buffer.push(new Uint8Array([0, 0xff]))).toEqual([]);
    expect(buffer.push(new Uint8Array([0xd8, 1, 2, 0xff]))).toEqual([]);
    expect(buffer.push(new Uint8Array([0xd9, 0]))).toEqual([
      new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    ]);
    expect(buffer.bufferedBytes).toBe(0);
  });

  it("extracts multiple frames and discards multipart noise", () => {
    const buffer = new MjpegFrameBuffer();

    const frames = buffer.push(
      new Uint8Array([
        10, 11, 0xff, 0xd8, 1, 0xff, 0xd9, 12, 0xff, 0xd8, 2, 0xff, 0xd9, 13,
      ]),
    );

    expect(frames).toEqual([
      new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]),
      new Uint8Array([0xff, 0xd8, 2, 0xff, 0xd9]),
    ]);
    expect(buffer.bufferedBytes).toBe(0);
  });

  it("bounds an incomplete oversized frame", () => {
    const buffer = new MjpegFrameBuffer(16);
    const oversized = new Uint8Array(32);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;

    expect(buffer.push(oversized)).toEqual([]);
    expect(buffer.bufferedBytes).toBe(16);
  });
});
