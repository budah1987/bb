import { describe, expect, it } from "vitest";
import {
  isSupportedPromptAttachment,
  promptAttachmentKind,
  PROMPT_ATTACHMENT_ACCEPT,
} from "@bb/server-contract";

describe("prompt attachment policy", () => {
  it("accepts the supported source, document, and image formats", () => {
    expect(
      isSupportedPromptAttachment({ name: "page.HTML", mimeType: "" }),
    ).toBe(true);
    expect(
      isSupportedPromptAttachment({
        name: "brief.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
    expect(
      promptAttachmentKind({ name: "screenshot.webp", mimeType: "" }),
    ).toBe("localImage");
    expect(promptAttachmentKind({ name: "report.pdf", mimeType: "" })).toBe(
      "localFile",
    );
  });

  it("uses a known MIME type when clipboard metadata has no extension", () => {
    expect(
      promptAttachmentKind({ name: "clipboard", mimeType: "text/html" }),
    ).toBe("localFile");
    expect(
      promptAttachmentKind({ name: "clipboard", mimeType: "image/png" }),
    ).toBe("localImage");
  });

  it("rejects archives and executable formats", () => {
    expect(
      isSupportedPromptAttachment({
        name: "bundle.zip",
        mimeType: "application/zip",
      }),
    ).toBe(false);
    expect(
      isSupportedPromptAttachment({
        name: "tool.exe",
        mimeType: "application/octet-stream",
      }),
    ).toBe(false);
    expect(
      isSupportedPromptAttachment({
        name: "payload.bin",
        mimeType: "text/plain",
      }),
    ).toBe(false);
    expect(PROMPT_ATTACHMENT_ACCEPT).toContain(".html");
    expect(PROMPT_ATTACHMENT_ACCEPT).not.toContain(".zip");
  });
});
