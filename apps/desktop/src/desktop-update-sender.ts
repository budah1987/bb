interface UpdateSenderFrame {
  url: string;
}

interface UpdateSenderWebContents {
  id: number;
  mainFrame: UpdateSenderFrame | null;
}

interface UpdateSenderWindow {
  webContents: UpdateSenderWebContents;
}

interface AuthorizeDesktopUpdateSenderArgs {
  applicationUrl: string | null;
  applicationWindowWebContentsIds: ReadonlySet<number>;
  appLoaded: boolean;
  sender: UpdateSenderWebContents;
  senderFrame: UpdateSenderFrame | null;
  window: UpdateSenderWindow | null;
}

export function isAuthorizedDesktopUpdateSender(
  args: AuthorizeDesktopUpdateSenderArgs,
): boolean {
  if (
    !args.appLoaded ||
    args.applicationUrl === null ||
    args.window?.webContents !== args.sender ||
    !args.applicationWindowWebContentsIds.has(args.sender.id) ||
    args.senderFrame === null ||
    args.senderFrame !== args.sender.mainFrame
  ) {
    return false;
  }

  try {
    const expected = new URL(args.applicationUrl);
    const actual = new URL(args.senderFrame.url);
    return (
      (expected.protocol === "http:" || expected.protocol === "https:") &&
      actual.origin === expected.origin
    );
  } catch {
    return false;
  }
}
