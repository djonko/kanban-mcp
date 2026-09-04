import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, jest } from "@jest/globals";
import type { BrowserLaunchDependencies } from "../../cli/browser-launch.js";
import {
  launchBrowser,
  redactAuthorizationUrl,
} from "../../cli/browser-launch.js";

function injectedSpawn(spawn: jest.Mock): BrowserLaunchDependencies["spawn"] {
  return spawn as unknown as BrowserLaunchDependencies["spawn"];
}

function childProcess(): EventEmitter & { unref: jest.Mock } {
  const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
  child.unref = jest.fn();
  return child;
}

describe("launchBrowser", () => {
  for (const [platform, executable] of [
    ["linux", "xdg-open"],
    ["darwin", "open"],
    ["win32", "explorer.exe"],
  ] as const) {
    it(`uses the safe ${platform} command`, async () => {
      const child = childProcess();
      const spawn = jest.fn().mockImplementation(() => {
        queueMicrotask(() => child.emit("spawn"));
        queueMicrotask(() => child.emit("close", 0));
        return child as unknown as ChildProcess;
      });
      const url = new URL(
        "https://identity.example/authorize?client_id=x&scope=openid&state=test",
      );

      await expect(
        launchBrowser(url, { platform, spawn: injectedSpawn(spawn) }),
      ).resolves.toEqual({
        launched: true,
      });
      expect(spawn).toHaveBeenCalledWith(executable, [url.toString()], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(child.listenerCount("spawn")).toBe(0);
      expect(child.listenerCount("error")).toBe(1);
    });
  }

  it("reports unsupported platforms without spawning", async () => {
    const spawn = jest.fn();
    const result = await launchBrowser(new URL("https://idp.example/auth"), {
      platform: "freebsd" as NodeJS.Platform,
      spawn: injectedSpawn(spawn),
    });

    expect(result.launched).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("converts synchronous spawn failures to a safe result", async () => {
    const spawn = jest.fn().mockImplementation(() => {
      throw new Error("spawn leaked https://idp.example/?state=secret");
    });

    const result = await launchBrowser(new URL("https://idp.example/auth"), {
      platform: "linux",
      spawn: injectedSpawn(spawn),
    });

    expect(result.launched).toBe(false);
    expect(result.error?.message).not.toContain("secret");
    expect(result.error?.message).not.toContain("https://");
  });

  it("handles child process errors once", async () => {
    const child = childProcess();
    const spawn = jest.fn().mockReturnValue(child as unknown as ChildProcess);
    const promise = launchBrowser(new URL("https://idp.example/auth"), {
      platform: "linux",
      spawn: injectedSpawn(spawn),
    });
    child.emit("error", new Error("ENOENT https://idp.example/auth?state=s"));

    const result = await promise;
    expect(result.launched).toBe(false);
    expect(result.error?.message).not.toContain("https://");
    expect(child.listenerCount("error")).toBe(1);
  });

  it("reports a non-zero opener exit as a failed launch", async () => {
    const child = childProcess();
    const spawn = jest.fn().mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      queueMicrotask(() => child.emit("close", 1));
      return child as unknown as ChildProcess;
    });

    await expect(
      launchBrowser(new URL("https://idp.example/auth"), {
        platform: "linux",
        spawn: injectedSpawn(spawn),
      }),
    ).resolves.toEqual({
      launched: false,
      error: expect.objectContaining({
        message: "Failed to open the authorization page automatically",
      }),
    });
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/login",
    "data:text/plain,x",
  ])("rejects unsafe URL %s", async (value) => {
    const spawn = jest.fn();
    const result = await launchBrowser(new URL(value), {
      platform: "linux",
      spawn: injectedSpawn(spawn),
    });
    expect(result.launched).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("allows HTTP only for loopback URLs", async () => {
    const child = childProcess();
    const spawn = jest.fn().mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ChildProcess;
    });

    await expect(
      launchBrowser(new URL("http://127.0.0.1:18931/login"), {
        platform: "linux",
        spawn: injectedSpawn(spawn),
      }),
    ).resolves.toEqual({ launched: true });
  });

  it("redacts sensitive parameters without mutating the URL", () => {
    const url = new URL(
      "https://idp.example/auth?client_id=public-client&scope=openid&state=secret-state&nonce=secret-nonce&code_challenge=secret-challenge&custom_TOKEN=secret-token",
    );
    const original = url.toString();
    const redacted = redactAuthorizationUrl(url);

    expect(url.toString()).toBe(original);
    expect(redacted).not.toContain("secret-state");
    expect(redacted).not.toContain("secret-nonce");
    expect(redacted).not.toContain("secret-challenge");
    expect(redacted).not.toContain("secret-token");
    expect(redacted).toContain("client_id=public-client");
    expect(redacted).toContain("scope=openid");
    expect(new URL(redacted).searchParams.get("state")).toBe("<redacted>");
  });

  it("removes sensitive fragments from fallback URLs", () => {
    const url = new URL(
      "https://idp.example/auth#state=secret-state&nonce=secret-nonce",
    );

    const redacted = redactAuthorizationUrl(url);

    expect(url.hash).toBe("#state=secret-state&nonce=secret-nonce");
    expect(new URL(redacted).hash).toBe("");
    expect(redacted).not.toContain("secret-state");
    expect(redacted).not.toContain("secret-nonce");
  });

  it("redacts sensitive parameters nested inside redirect_uri", () => {
    const url = new URL(
      "https://idp.example/auth?client_id=public&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback%3Fstate%3Dsecret-state%26nonce%3Dsecret-nonce",
    );

    const redacted = redactAuthorizationUrl(url);
    const nested = new URL(
      new URL(redacted).searchParams.get("redirect_uri") ?? "",
    );

    expect(nested.searchParams.get("state")).toBe("<redacted>");
    expect(nested.searchParams.get("nonce")).toBe("<redacted>");
    expect(redacted).not.toContain("secret-state");
    expect(redacted).not.toContain("secret-nonce");
  });
});
