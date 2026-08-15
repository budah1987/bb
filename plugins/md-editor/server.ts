import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import path from "node:path";
import { promisify } from "node:util";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"] as const;
const TEXT_EXTENSIONS = [
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".sql",
  ".ini",
  ".conf",
  ".env",
  ".properties",
  ".diff",
  ".patch",
] as const;
const FILE_OPENER_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  ...TEXT_EXTENSIONS,
] as const;
const GITHUB_CLI_CANDIDATES = [
  "gh",
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
];

const openerSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
  })
  .strict();

const fileReadSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().nonnegative().optional(),
    sha256: z.string(),
    isMarkdown: z.boolean(),
    readOnly: z.boolean(),
  })
  .strict();

const fileWriteSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("written"),
      sha256: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("conflict"),
      currentSha256: z.string().nullable(),
    })
    .strict(),
]);

export const rpcContract = defineRpcContract({
  openFile: {
    input: z
      .object({
        source: openerSourceSchema,
        path: z.string().min(1),
      })
      .strict(),
    output: fileReadSchema,
  },
  saveFile: {
    input: z
      .object({
        source: openerSourceSchema,
        path: z.string().min(1),
        content: z.string(),
        expectedSha256: z.string().min(1),
      })
      .strict(),
    output: fileWriteSchema,
  },
});

type OpenerSource = z.infer<typeof openerSourceSchema>;

type GithubFileTarget = {
  repo: string;
  path: string;
  ref: string | null;
};

type ResolvedFile =
  | {
      kind: "local";
      path: string;
      rootPath: string;
      hostId?: string;
      github?: GithubFileTarget;
    }
  | {
      kind: "github";
      github: GithubFileTarget;
    };

const githubContentsSchema = z
  .object({
    type: z.string(),
    encoding: z.string(),
    content: z.string(),
    path: z.string(),
  })
  .passthrough();

function isMarkdownPath(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

function isSupportedTextPath(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return FILE_OPENER_EXTENSIONS.some((extension) =>
    lowerPath.endsWith(extension),
  );
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function normalizeGithubPath(filePath: string): string {
  const slashPath = filePath.replaceAll("\\", "/");
  if (
    slashPath.startsWith("/") ||
    /^[a-zA-Z]:\//u.test(slashPath) ||
    slashPath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("The GitHub file path must be relative and contained.");
  }
  const normalized = path.posix.normalize(slashPath);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("The GitHub file path must be relative and contained.");
  }
  return normalized;
}

function parseGithubRepo(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(
    /github\.com[/:]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/iu,
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

function createGithubTarget(
  remoteUrl: string | null,
  filePath: string,
  ref: string | null,
): GithubFileTarget | undefined {
  const repo = parseGithubRepo(remoteUrl);
  if (!repo) return undefined;
  return { repo, path: normalizeGithubPath(filePath), ref };
}

async function runGithubCli(args: string[]): Promise<string> {
  let lastError: unknown;
  for (const executable of GITHUB_CLI_CANDIDATES) {
    try {
      const result = await execFileAsync(executable, args, {
        maxBuffer: 12 * 1024 * 1024,
      });
      return result.stdout;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`GitHub CLI is unavailable${detail}`);
}

function parseGithubContents(value: unknown): {
  content: string;
  path: string;
} {
  const parsed = githubContentsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("GitHub returned an unexpected file response.");
  }
  const response = parsed.data;
  if (response.type !== "file" || response.encoding !== "base64") {
    throw new Error(
      "GitHub returned a directory or an unsupported file format.",
    );
  }
  const bytes = Buffer.from(response.content.replaceAll(/\s/gu, ""), "base64");
  if (!isUtf8(bytes)) {
    throw new Error("Markdown Editor can only open UTF-8 text files.");
  }
  return {
    content: bytes.toString("utf8"),
    path: response.path,
  };
}

async function readGithubFile(target: GithubFileTarget) {
  const endpoint = `repos/${target.repo}/contents/${target.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const args = ["api", endpoint];
  if (target.ref) args.push("--field", `ref=${target.ref}`);
  let rawResponse: string;
  try {
    rawResponse = await runGithubCli(args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load ${target.path} from GitHub: ${message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse) as unknown;
  } catch {
    throw new Error("GitHub returned an invalid file response.");
  }
  const file = parseGithubContents(parsed);
  const bytes = Buffer.from(file.content, "utf8");
  return {
    path: file.path || target.path,
    content: file.content,
    contentEncoding: "utf8" as const,
    mimeType: isMarkdownPath(target.path) ? "text/markdown" : "text/plain",
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    isMarkdown: isMarkdownPath(target.path),
    readOnly: true,
  };
}

async function resolveHostId(
  bb: BbPluginApi,
  source: OpenerSource,
): Promise<string | undefined> {
  const environmentId =
    source.environmentId ??
    (source.threadId
      ? (await bb.sdk.threads.get({ threadId: source.threadId })).environmentId
      : null);
  if (!environmentId) return undefined;
  return (await bb.sdk.environments.get({ environmentId })).hostId;
}

async function resolveFile(
  bb: BbPluginApi,
  source: OpenerSource,
  filePath: string,
): Promise<ResolvedFile> {
  if (!isSupportedTextPath(filePath)) {
    throw new Error(
      "Markdown Editor only opens supported Markdown and text files.",
    );
  }

  if (source.kind === "host") {
    if (!path.isAbsolute(filePath)) {
      throw new Error("Host file paths must be absolute.");
    }
    const normalizedPath = path.normalize(filePath);
    const hostId = await resolveHostId(bb, source);
    return {
      kind: "local",
      path: normalizedPath,
      rootPath: path.dirname(normalizedPath),
      ...(hostId ? { hostId } : {}),
    };
  }

  if (source.kind === "thread-storage") {
    if (!source.threadId) {
      throw new Error("This thread-storage file has no owning thread.");
    }
    const storage = await bb.sdk.threads.storageFiles({
      threadId: source.threadId,
    });
    const rootPath = path.resolve(storage.storageRootPath);
    if (path.isAbsolute(filePath)) {
      throw new Error("Thread-storage file paths must be relative.");
    }
    const normalizedPath = path.resolve(rootPath, filePath);
    if (!isWithinRoot(rootPath, normalizedPath)) {
      throw new Error("The file path escapes thread storage.");
    }
    const hostId = await resolveHostId(bb, source);
    if (!hostId) {
      throw new Error("This thread-storage file has no host.");
    }
    return { kind: "local", path: normalizedPath, rootPath, hostId };
  }

  if (path.isAbsolute(filePath)) {
    throw new Error("Workspace file paths must be relative.");
  }

  let rootPath: string | null = null;
  let hostId: string | undefined;
  let github: GithubFileTarget | undefined;
  if (source.environmentId) {
    const environment = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });
    try {
      const project = await bb.sdk.projects.get({
        projectId: environment.projectId,
      });
      github = createGithubTarget(
        project.gitRemoteUrl,
        filePath,
        environment.branchName,
      );
    } catch {
      // Personal/local environments can outlive their project record. A
      // local workspace remains fully usable; GitHub fallback is optional.
    }
    if (environment.path) {
      rootPath = path.resolve(environment.path);
      hostId = environment.hostId;
    }
  } else {
    if (!source.projectId) {
      throw new Error("This workspace file has no environment or project.");
    }
    const project = await bb.sdk.projects.get({ projectId: source.projectId });
    github = createGithubTarget(project.gitRemoteUrl, filePath, null);
    const projectSource =
      project.sources.find(
        (candidate: { isDefault: boolean }) => candidate.isDefault,
      ) ?? project.sources[0];
    if (projectSource) {
      rootPath = path.resolve(projectSource.path);
      hostId = projectSource.hostId;
    }
  }

  if (!rootPath) {
    if (github) return { kind: "github", github };
    throw new Error("This environment has no workspace path or GitHub source.");
  }

  const normalizedPath = path.resolve(rootPath, filePath);
  if (!isWithinRoot(rootPath, normalizedPath)) {
    throw new Error("The file path escapes the workspace.");
  }
  return {
    kind: "local",
    path: normalizedPath,
    rootPath,
    hostId,
    ...(github ? { github } : {}),
  };
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async openFile({ source, path: filePath }) {
      const target = await resolveFile(bb, source, filePath);
      if (target.kind === "github") return readGithubFile(target.github);

      try {
        const file = await bb.sdk.files.read({
          ...(target.hostId ? { hostId: target.hostId } : {}),
          path: target.path,
          rootPath: target.rootPath,
        });
        if (file.contentEncoding !== "utf8") {
          throw new Error("Markdown Editor can only open UTF-8 text files.");
        }
        return {
          ...file,
          isMarkdown: isMarkdownPath(filePath),
          readOnly: false,
        };
      } catch (error: unknown) {
        if (target.github) return readGithubFile(target.github);
        throw error;
      }
    },
    async saveFile({ source, path: filePath, content, expectedSha256 }) {
      const target = await resolveFile(bb, source, filePath);
      if (target.kind === "github") {
        throw new Error(
          "This file was loaded from GitHub because it is not in the workspace. Open a workspace checkout to save edits.",
        );
      }
      return bb.sdk.files.write({
        ...(target.hostId ? { hostId: target.hostId } : {}),
        path: target.path,
        rootPath: target.rootPath,
        content,
        expectedSha256,
      });
    },
  });
}
