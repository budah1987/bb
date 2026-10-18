import { describe, expect, it } from "vitest";
import { isAuthorizedDesktopUpdateSender } from "../src/desktop-update-sender.js";

function createSender() {
  const mainFrame = { url: "https://bb.example.com/thread/123" };
  const sender = { id: 42, mainFrame };
  return {
    applicationUrl: "https://bb.example.com/",
    applicationWindowWebContentsIds: new Set([sender.id]),
    appLoaded: true,
    sender,
    senderFrame: mainFrame,
    window: { webContents: sender },
  };
}

describe("desktop update IPC sender", () => {
  it("allows the current application window main frame on the application origin", () => {
    expect(isAuthorizedDesktopUpdateSender(createSender())).toBe(true);
  });

  it("rejects embedded frames, unowned windows, and stale window ownership", () => {
    const sender = createSender();
    expect(
      isAuthorizedDesktopUpdateSender({
        ...sender,
        senderFrame: { url: sender.senderFrame.url },
      }),
    ).toBe(false);
    expect(
      isAuthorizedDesktopUpdateSender({
        ...sender,
        applicationWindowWebContentsIds: new Set(),
      }),
    ).toBe(false);
    expect(
      isAuthorizedDesktopUpdateSender({
        ...sender,
        window: {
          webContents: { id: sender.sender.id, mainFrame: sender.senderFrame },
        },
      }),
    ).toBe(false);
  });

  it("rejects navigated, switched, and local-view senders", () => {
    const sender = createSender();
    sender.senderFrame.url = "https://other.example.com/";
    expect(isAuthorizedDesktopUpdateSender(sender)).toBe(false);
    sender.senderFrame.url = "https://bb.example.com.evil.test/";
    expect(isAuthorizedDesktopUpdateSender(sender)).toBe(false);
    sender.senderFrame.url = "https://bb.example.com/thread/123";
    expect(
      isAuthorizedDesktopUpdateSender({
        ...sender,
        applicationUrl: "https://other.example.com/",
      }),
    ).toBe(false);
    expect(
      isAuthorizedDesktopUpdateSender({ ...sender, appLoaded: false }),
    ).toBe(false);
    expect(
      isAuthorizedDesktopUpdateSender({
        ...sender,
        applicationUrl: "data:text/html,loading",
      }),
    ).toBe(false);
  });
});
