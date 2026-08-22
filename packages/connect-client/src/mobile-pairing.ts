import { deriveConnectBaseUrl } from "./credential.js";

/** Payload encoded by bb's mobile-pairing QR code. */
export interface MobilePairingPayload {
  code: string;
  serverUrl: string;
  apex: string;
  expiresAt: number;
}

/** Build a complete enrollment payload from a freshly minted machine code. */
export function mobilePairingPayload(machineCode: {
  code: string;
  serverUrl: string;
  expiresAt: number;
}): MobilePairingPayload {
  return {
    code: machineCode.code,
    serverUrl: machineCode.serverUrl,
    apex: deriveConnectBaseUrl(machineCode.serverUrl),
    expiresAt: machineCode.expiresAt,
  };
}

/** Encode the enrollment payload for the mobile app's QR scanner. */
export function encodeMobilePairingPayload(
  payload: MobilePairingPayload,
): string {
  return JSON.stringify({
    code: payload.code,
    serverUrl: payload.serverUrl,
    apex: payload.apex,
    expiresAt: payload.expiresAt,
  });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parse a scanned mobile-pairing payload, ignoring unknown future fields. */
export function parseMobilePairingPayload(
  text: string,
): MobilePairingPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.code !== "string" ||
    record.code.length === 0 ||
    !isHttpUrl(record.serverUrl) ||
    !isHttpUrl(record.apex) ||
    typeof record.expiresAt !== "number" ||
    !Number.isInteger(record.expiresAt)
  ) {
    return null;
  }
  return {
    code: record.code,
    serverUrl: record.serverUrl,
    apex: record.apex,
    expiresAt: record.expiresAt,
  };
}
