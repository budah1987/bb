export function savePngScreenshot(args: {
  dataBase64: string;
  deviceName: string;
}): void {
  const safeDeviceName = args.deviceName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  const link = document.createElement("a");
  link.download = `${safeDeviceName || "ios-simulator"}-${Date.now()}.png`;
  link.href = `data:image/png;base64,${args.dataBase64}`;
  document.body.append(link);
  link.click();
  link.remove();
}
