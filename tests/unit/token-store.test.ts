import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  readStoredToken,
  type TokenStoreDependencies,
  writeStoredToken,
} from "../../common/token-store.js";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kanban-mcp-token-test-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
  jest.restoreAllMocks();
});

describe("writeStoredToken", () => {
  it("creates secure parent directories and stores only the token", async () => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "config", "kanban-mcp", "token");

    await writeStoredToken(tokenFile, "abc.def");

    expect(await readFile(tokenFile, "utf8")).toBe("abc.def\n");
    expect(await readdir(join(root, "config", "kanban-mcp"))).toEqual([
      "token",
    ]);
    if (process.platform !== "win32") {
      expect(
        (await stat(join(root, "config", "kanban-mcp"))).mode & 0o777,
      ).toBe(0o700);
      expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    }
  });

  it("atomically replaces an existing token without leaving a temporary file", async () => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "token");
    await writeFile(tokenFile, "OLD_TOKEN\n");

    await writeStoredToken(tokenFile, "NEW_TOKEN", {
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    });

    expect(await readFile(tokenFile, "utf8")).toBe("NEW_TOKEN\n");
    expect(await readdir(root)).toEqual(["token"]);
  });

  it.each([
    "",
    "   ",
    "\n\t",
  ])("rejects empty token %j before mutation", async (token) => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "nested", "token");

    await expect(writeStoredToken(tokenFile, token)).rejects.toThrow(
      "Cannot store an empty Planka access token",
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("cleans the exact temporary file after a rename failure", async () => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "token");
    const sibling = join(root, "sibling");
    await writeFile(tokenFile, "ORIGINAL_TOKEN\n");
    await writeFile(sibling, "sibling");
    const rename = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("rename failed"));

    await expect(
      writeStoredToken(tokenFile, "SECRET_NEW_TOKEN", {
        randomUUID: () => "00000000-0000-4000-8000-000000000000",
        rename,
      }),
    ).rejects.toThrow("Failed to store the Planka access token");

    expect(await readFile(tokenFile, "utf8")).toBe("ORIGINAL_TOKEN\n");
    expect(await readFile(sibling, "utf8")).toBe("sibling");
    expect(await readdir(root)).toEqual(["sibling", "token"]);
  });
});

describe("readStoredToken", () => {
  it("trims surrounding whitespace while preserving internal characters", async () => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "token");
    await writeFile(tokenFile, " \t abc def\r\n");

    await expect(readStoredToken(tokenFile)).resolves.toBe("abc def");
  });

  it("reports a missing token file", async () => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "missing-token");

    await expect(readStoredToken(tokenFile)).rejects.toThrow(
      "Run oidc-login first",
    );
  });

  it("reports unreadable token files without exposing contents", async () => {
    const tokenFile = "/isolated/token";
    const readFileFn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(
        Object.assign(new Error("SECRET_FILE_CONTENT"), { code: "EACCES" }),
      ) as unknown as TokenStoreDependencies["readFile"];

    await expect(
      readStoredToken(tokenFile, { readFile: readFileFn }),
    ).rejects.toThrow("Check the file path and permissions");
    await expect(
      readStoredToken(tokenFile, { readFile: readFileFn }),
    ).rejects.not.toThrow("SECRET_FILE_CONTENT");
  });

  it.each([
    "",
    " \t\r\n",
  ])("rejects an empty stored token", async (contents) => {
    const root = await temporaryDirectory();
    const tokenFile = join(root, "token");
    await writeFile(tokenFile, contents);

    await expect(readStoredToken(tokenFile)).rejects.toThrow(
      "is empty. Rerun oidc-login",
    );
  });
});
