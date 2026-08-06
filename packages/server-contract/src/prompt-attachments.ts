/**
 * Formats that the prompt composer can send as project-scoped attachments.
 * Keep this list intentionally small: every accepted format is persisted and
 * made available to the agent, so accepting arbitrary binaries creates a
 * storage and parsing surface without improving the composer.
 */
export const PROMPT_ATTACHMENT_EXTENSIONS = [
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".csv",
  ".sql",
  ".md",
  ".markdown",
  ".txt",
  ".log",
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

export type PromptAttachmentExtension =
  (typeof PROMPT_ATTACHMENT_EXTENSIONS)[number];

const PROMPT_ATTACHMENT_IMAGE_EXTENSIONS = new Set<PromptAttachmentExtension>([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const PROMPT_ATTACHMENT_MIME_TYPES = new Map<
  string,
  "localFile" | "localImage"
>([
  ["image/png", "localImage"],
  ["image/jpeg", "localImage"],
  ["image/webp", "localImage"],
  ["text/html", "localFile"],
  ["text/css", "localFile"],
  ["text/javascript", "localFile"],
  ["application/javascript", "localFile"],
  ["application/json", "localFile"],
  ["application/ld+json", "localFile"],
  ["application/toml", "localFile"],
  ["application/xml", "localFile"],
  ["text/xml", "localFile"],
  ["application/sql", "localFile"],
  ["text/csv", "localFile"],
  ["application/csv", "localFile"],
  ["text/markdown", "localFile"],
  ["text/plain", "localFile"],
  ["application/pdf", "localFile"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "localFile",
  ],
]);

/** The value used by the native file input's `accept` attribute. */
export const PROMPT_ATTACHMENT_ACCEPT = PROMPT_ATTACHMENT_EXTENSIONS.join(",");

/** A concise explanation shown when a file is rejected by the composer. */
export const PROMPT_ATTACHMENT_FORMAT_SUMMARY =
  "HTML, CSS, JavaScript, TypeScript, JSON, JSONL, YAML, TOML, XML, CSV, SQL, Markdown, text, PDF, DOCX, PNG, JPG, and WebP";

export type PromptAttachmentKind = "localFile" | "localImage";

function normalizedExtension(name: string): string {
  const lastSegment = name.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex > 0 ? lastSegment.slice(dotIndex).toLowerCase() : "";
}

function normalizedMimeType(mimeType: string | null | undefined): string {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * Resolves the attachment kind from the filename first, then from a known MIME
 * type. Filename matching keeps clipboard and drag/drop uploads working when
 * the browser supplies an empty or generic MIME type.
 */
export function promptAttachmentKind(input: {
  name: string;
  mimeType?: string | null;
}): PromptAttachmentKind | null {
  const extension = normalizedExtension(input.name);
  if ((PROMPT_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return PROMPT_ATTACHMENT_IMAGE_EXTENSIONS.has(
      extension as PromptAttachmentExtension,
    )
      ? "localImage"
      : "localFile";
  }

  // A known MIME type can identify clipboard payloads whose synthetic name has
  // no extension. Once a real but unsupported extension is present, reject it
  // instead of letting a misleading MIME type bypass the filename policy.
  if (extension.length > 0) {
    return null;
  }

  return (
    PROMPT_ATTACHMENT_MIME_TYPES.get(normalizedMimeType(input.mimeType)) ?? null
  );
}

export function isSupportedPromptAttachment(input: {
  name: string;
  mimeType?: string | null;
}): boolean {
  return promptAttachmentKind(input) !== null;
}
