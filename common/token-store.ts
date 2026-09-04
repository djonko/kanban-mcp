import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

export interface TokenStoreDependencies {
  chmod: typeof chmod;
  mkdir: typeof mkdir;
  open: typeof open;
  randomUUID: typeof randomUUID;
  readFile: typeof readFile;
  rename: typeof rename;
  unlink: typeof unlink;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function invalidTokenError(): Error {
  return new Error("Cannot store an empty Planka access token.");
}

function storeError(tokenFile: string, error: unknown): Error {
  return new Error(
    `Failed to store the Planka access token at "${tokenFile}".`,
    { cause: error },
  );
}

const defaultDependencies: TokenStoreDependencies = {
  chmod,
  mkdir,
  open,
  randomUUID,
  readFile,
  rename,
  unlink,
};

export async function writeStoredToken(
  tokenFile: string,
  token: string,
  dependencies: Partial<TokenStoreDependencies> = {},
): Promise<void> {
  if (token.trim().length === 0) throw invalidTokenError();

  const deps = { ...defaultDependencies, ...dependencies };
  const parentDirectory = dirname(tokenFile);
  const temporaryPath = join(
    parentDirectory,
    `.${basename(tokenFile)}.${process.pid}.${deps.randomUUID()}.tmp`,
  );
  let fileHandle: FileHandle | undefined;
  let temporaryCreated = false;

  try {
    await deps.mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    fileHandle = await deps.open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    await deps.chmod(temporaryPath, 0o600);
    await fileHandle.writeFile(`${token}\n`, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await deps.rename(temporaryPath, tokenFile);
    temporaryCreated = false;
  } catch (error) {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Preserve the primary filesystem failure.
      }
    }
    if (temporaryCreated) {
      try {
        await deps.unlink(temporaryPath);
      } catch (cleanupError) {
        if (!isNodeError(cleanupError, "ENOENT")) {
          // Preserve the primary filesystem failure.
        }
      }
    }
    throw storeError(tokenFile, error);
  }
}

export async function readStoredToken(
  tokenFile: string,
  dependencies: Partial<TokenStoreDependencies> = {},
): Promise<string> {
  const read = dependencies.readFile ?? readFile;
  let contents: string;
  try {
    contents = await read(tokenFile, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new Error(
        `No stored Planka access token was found at "${tokenFile}". ` +
          "Run oidc-login first.",
        { cause: error },
      );
    }
    throw new Error(
      `Unable to read the stored Planka access token at "${tokenFile}". ` +
        "Check the file path and permissions.",
      { cause: error },
    );
  }

  const token = contents.trim();
  if (token.length === 0) {
    throw new Error(
      `The stored Planka access token at "${tokenFile}" is empty. ` +
        "Rerun oidc-login.",
    );
  }
  return token;
}
