import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const PREVIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const providerSchema = z.enum(["paper", "magicpath"]);
export type DesignProvider = z.infer<typeof providerSchema>;

const publishPreviewParameters = z
  .object({
    provider: providerSchema,
    title: z.string().trim().min(1).max(160),
    originalUrl: z.string().trim().url().max(2_000),
    localPath: z.string().trim().min(1).max(4_096),
  })
  .strict();

type PublishPreviewInput = z.infer<typeof publishPreviewParameters>;

export type PreviewMetadata = {
  id: string;
  provider: DesignProvider;
  title: string;
  originalUrl: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
};

const previewMetadataSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  title: z.string(),
  originalUrl: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});

export const rpcContract = defineRpcContract({
  getPreview: {
    input: z.object({ id: z.string().regex(PREVIEW_ID_PATTERN) }).strict(),
    output: z.object({ preview: previewMetadataSchema.nullable() }),
  },
});

type PreviewRow = {
  id: string;
  provider: DesignProvider;
  title: string;
  original_url: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  image_data: Buffer;
  created_at: number;
};

const mimeTypeByExtension: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const extensionByMimeType: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isAllowedOriginalUrl(
  provider: DesignProvider,
  value: string,
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (provider === "paper") {
      return hostname === "paper.design" || hostname.endsWith(".paper.design");
    }
    return hostname === "magicpath.ai" || hostname.endsWith(".magicpath.ai");
  } catch {
    return false;
  }
}

function providerForOriginalUrl(value: string): DesignProvider | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "paper.design" || hostname.endsWith(".paper.design")) {
      return "paper";
    }
    if (hostname === "magicpath.ai" || hostname.endsWith(".magicpath.ai")) {
      return "magicpath";
    }
    return null;
  } catch {
    return null;
  }
}

function resolveMimeType(
  value: string | undefined,
  filePath: string,
): string | null {
  const declared = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (declared && extensionByMimeType[declared]) return declared;
  return mimeTypeByExtension[extname(filePath).toLowerCase()] ?? null;
}

function resolvePreviewReadRoot(
  provider: DesignProvider,
  workspacePath: string,
  localPath: string,
): string {
  const absolutePath = resolve(localPath);
  const workspaceRelativePath = relative(workspacePath, absolutePath);
  const isInWorkspace =
    workspaceRelativePath === "" ||
    (workspaceRelativePath !== ".." &&
      !workspaceRelativePath.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ) &&
      !isAbsolute(workspaceRelativePath));
  if (isInWorkspace) return workspacePath;

  const parentDirectory = dirname(absolutePath);
  if (provider === "paper" && parentDirectory.endsWith("/Downloads")) {
    return parentDirectory;
  }

  throw new Error(
    "Preview images must be inside the thread workspace; Paper exports may also be direct files in a Downloads folder.",
  );
}

function toMetadata(row: PreviewRow): PreviewMetadata {
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    originalUrl: row.original_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function makeDownloadName(title: string, mimeType: string): string {
  const stem =
    title
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "design-preview";
  return `${stem}.${extensionByMimeType[mimeType] ?? "png"}`;
}

function quoteDirectiveValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeReturnPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://bb.local");
    if (parsed.origin !== "https://bb.local") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function renderViewerHtml(preview: PreviewRow, returnPath: string): string {
  const title = escapeHtml(preview.title);
  const imageUrl = `/api/v1/plugins/design-canvas/http/preview?id=${encodeURIComponent(preview.id)}`;
  const fallbackPath = escapeHtml(returnPath);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${title} · bb preview</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; margin: 0; background: Canvas; color: CanvasText; }
      body { min-height: 100dvh; display: grid; grid-template-rows: auto 1fr; }
      header {
        position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px;
        min-height: calc(60px + env(safe-area-inset-top)); padding: env(safe-area-inset-top) 12px 0;
        border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); background: Canvas;
      }
      #return-link {
        min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 12px;
        border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 10px;
        color: CanvasText; text-decoration: none; font-size: 15px; font-weight: 600;
      }
      #return-link:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
      .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
      main {
        min-height: 0; overflow: auto; display: flex; justify-content: center; align-items: flex-start;
        padding: 12px max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      }
      img { display: block; width: auto; max-width: 100%; height: auto; object-fit: contain; }
      @media (min-width: 900px) { main { padding: 24px; } }
      @media (pointer: coarse) { #return-link { min-height: 48px; padding-inline: 14px; } }
    </style>
  </head>
  <body>
    <header>
      <a id="return-link" href="${fallbackPath}" aria-label="Return to the bb conversation">
        <span aria-hidden="true">←</span><span>Return to conversation</span>
      </a>
      <div class="title">${title}</div>
    </header>
    <main><img src="${imageUrl}" alt="${title}"></main>
    <script>
      document.getElementById("return-link").addEventListener("click", function (event) {
        if (window.opener && !window.opener.closed) {
          event.preventDefault();
          window.close();
          return;
        }
        if (window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      });
    </script>
  </body>
</html>`;
}

function parsePublishArguments(argv: string[]): PublishPreviewInput {
  if (argv[0] !== "publish") {
    throw new Error(
      "Usage: bb design-preview publish --provider <paper|magicpath> --title <title> --url <provider-url> --path <absolute-image-path>",
    );
  }

  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Every publish flag requires a value.");
    }
    values.set(flag, value);
  }

  return publishPreviewParameters.parse({
    provider: values.get("--provider"),
    title: values.get("--title"),
    originalUrl: values.get("--url"),
    localPath: values.get("--path"),
  });
}

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS artboards (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('paper', 'magicpath')),
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      UNIQUE(provider, url)
    )`,
    `CREATE TABLE IF NOT EXISTS design_previews (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('paper', 'magicpath')),
      title TEXT NOT NULL,
      original_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      image_data BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS design_previews_sha_url_idx
      ON design_previews (sha256, original_url)`,
  ]);

  const selectPreview = db.prepare(
    `SELECT id, provider, title, original_url, mime_type, size_bytes, sha256,
            image_data, created_at
       FROM design_previews
      WHERE id = ?`,
  );
  const selectLatestPreviewByUrl = db.prepare(
    `SELECT id, provider, title, original_url, mime_type, size_bytes, sha256,
            image_data, created_at
       FROM design_previews
      WHERE original_url = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  );

  async function publishPreview(
    input: PublishPreviewInput,
    context: { threadId: string; signal?: AbortSignal },
  ): Promise<{ id: string; directive: string }> {
    const { provider, title, originalUrl, localPath } = input;
    if (!isAllowedOriginalUrl(provider, originalUrl)) {
      throw new Error(
        provider === "paper"
          ? "originalUrl must be an https://paper.design URL."
          : "originalUrl must be an https://magicpath.ai URL.",
      );
    }

    const thread = await bb.sdk.threads.get({
      threadId: context.threadId,
      signal: context.signal,
    });
    if (!thread.environmentId)
      throw new Error("This thread has no workspace environment.");

    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
      signal: context.signal,
    });
    if (!environment.path)
      throw new Error("This thread has no workspace path.");

    const readRoot = resolvePreviewReadRoot(
      provider,
      environment.path,
      localPath,
    );
    const file = await bb.sdk.files.read({
      hostId: environment.hostId,
      path: localPath,
      rootPath: readRoot,
      signal: context.signal,
    });
    if (file.sizeBytes > MAX_PREVIEW_BYTES) {
      throw new Error("Design previews must be 10 MB or smaller.");
    }

    const mimeType = resolveMimeType(file.mimeType, localPath);
    if (!mimeType) {
      throw new Error("Use a PNG, JPEG, WebP, AVIF, or GIF preview image.");
    }

    const bytes = Buffer.from(
      file.content,
      file.contentEncoding === "base64" ? "base64" : "utf8",
    );
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PREVIEW_BYTES) {
      throw new Error("Design previews must be between 1 byte and 10 MB.");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = db
      .prepare(
        `SELECT id, provider, title, original_url, mime_type, size_bytes, sha256,
                image_data, created_at
           FROM design_previews
          WHERE sha256 = ? AND original_url = ? AND provider = ? AND title = ?
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get(sha256, originalUrl, provider, title) as PreviewRow | undefined;

    const id = existing?.id ?? randomUUID();
    if (!existing) {
      db.prepare(
        `INSERT INTO design_previews
           (id, provider, title, original_url, mime_type, size_bytes, sha256,
            image_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        provider,
        title,
        originalUrl,
        mimeType,
        bytes.byteLength,
        sha256,
        bytes,
        Date.now(),
      );
    }

    return {
      id,
      directive: `::design-preview{id="${quoteDirectiveValue(id)}"}`,
    };
  }

  bb.rpc.register(rpcContract, {
    getPreview({ id }) {
      const row = selectPreview.get(id) as PreviewRow | undefined;
      return { preview: row ? toMetadata(row) : null };
    },
  });

  bb.http.route(
    "GET",
    "/preview",
    (context) => {
      const id = context.req.query("id") ?? "";
      if (!PREVIEW_ID_PATTERN.test(id))
        return context.text("Preview not found", 404);

      const row = selectPreview.get(id) as PreviewRow | undefined;
      if (!row) return context.text("Preview not found", 404);

      const etag = `"${row.sha256}"`;
      if (context.req.header("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }

      const headers = new Headers({
        "cache-control": "private, max-age=31536000, immutable",
        "content-type": row.mime_type,
        "content-length": String(row.size_bytes),
        "x-content-type-options": "nosniff",
        etag,
      });
      if (context.req.query("download") === "1") {
        headers.set(
          "content-disposition",
          `attachment; filename="${makeDownloadName(row.title, row.mime_type)}"`,
        );
      }
      return new Response(new Uint8Array(row.image_data), { headers });
    },
    { auth: "local" },
  );

  bb.http.route(
    "GET",
    "/open",
    (context) => {
      const originalUrl = context.req.query("url") ?? "";
      if (!providerForOriginalUrl(originalUrl)) {
        return context.text("Unsupported design URL", 404);
      }

      const preview = selectLatestPreviewByUrl.get(originalUrl) as
        | PreviewRow
        | undefined;
      const returnPath = safeReturnPath(context.req.query("returnTo"));
      const location = preview
        ? `/api/v1/plugins/design-canvas/http/viewer?id=${encodeURIComponent(preview.id)}&returnTo=${encodeURIComponent(returnPath)}`
        : originalUrl;
      return new Response(null, {
        status: 302,
        headers: {
          "cache-control": "no-store",
          location,
        },
      });
    },
    { auth: "local" },
  );

  bb.http.route(
    "GET",
    "/viewer",
    (context) => {
      const id = context.req.query("id") ?? "";
      if (!PREVIEW_ID_PATTERN.test(id))
        return context.text("Preview not found", 404);

      const preview = selectPreview.get(id) as PreviewRow | undefined;
      if (!preview) return context.text("Preview not found", 404);

      const returnPath = safeReturnPath(context.req.query("returnTo"));
      return context.html(renderViewerHtml(preview, returnPath), 200, {
        "cache-control": "private, no-store",
        "content-security-policy":
          "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
    },
    { auth: "local" },
  );

  bb.agents.registerTool({
    name: "design_canvas_publish_preview",
    description:
      "Persist a Paper or MagicPath raster preview in bb and return the message directive that renders it on desktop and mobile.",
    instructions:
      "Call this after Paper or MagicPath design work. Pass an absolute PNG, JPEG, WebP, AVIF, or GIF path inside the current workspace. A Paper export directly inside a Downloads folder is also accepted. Include the returned ::design-preview directive verbatim in the final response.",
    experimental_statusLabels: {
      pending: "Publishing mobile design preview",
      completed: "Published mobile design preview",
    },
    parameters: publishPreviewParameters,
    async execute(parameters, context) {
      const { directive } = await publishPreview(parameters, context);
      return [
        "Mobile design preview published.",
        "Include this directive verbatim on its own line in your final response:",
        directive,
      ].join("\n");
    },
  });

  bb.cli.register({
    name: "design-preview",
    summary:
      "Publish Paper and MagicPath images as mobile-viewable bb previews",
    commands: [
      {
        name: "publish",
        summary: "Store a workspace image and return its bb message directive",
        usage:
          "bb design-preview publish --provider <paper|magicpath> --title <title> --url <provider-url> --path <absolute-image-path>",
      },
    ],
    async run(argv, context) {
      if (!context.threadId) {
        return {
          exitCode: 2,
          stderr:
            "Run this command from a bb thread so its workspace can be resolved.\n",
        };
      }
      try {
        const input = parsePublishArguments(argv);
        const { directive } = await publishPreview(input, {
          threadId: context.threadId,
          signal: context.signal,
        });
        return { exitCode: 0, stdout: `${directive}\n` };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });

  bb.agents.configure(() => ({
    tools: ["design_canvas_publish_preview"],
    skills: [],
    instructions: [
      "When you create or edit a design in Paper or MagicPath, the final response must include a mobile-viewable raster preview in bb.",
      "For Paper: export the finished artboard as PNG, JPEG, or WebP, then call design_canvas_publish_preview with the exported file path. Direct files in Downloads are accepted.",
      "For MagicPath: download the component's previewImageUrl into the current workspace, then call design_canvas_publish_preview.",
      "Include the tool's ::design-preview directive verbatim on its own line. Do not put the raw Paper or MagicPath URL in response prose when a preview is available; the card already provides Original as a secondary editing action.",
    ].join("\n"),
  }));
}
