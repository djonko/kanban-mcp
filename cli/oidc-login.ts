import { randomBytes } from "node:crypto";
import { z } from "zod";

export interface OidcBootstrap {
  authorizationUrl: string;
  endSessionUrl?: string;
  isEnforced: boolean;
}

export interface PreparedOidcLogin {
  authorizationUrl: URL;
  nonce: string;
}

const bootstrapResponseSchema = z.object({
  item: z
    .object({
      oidc: z
        .object({
          authorizationUrl: z.string().optional(),
          endSessionUrl: z.string().nullable().optional(),
          isEnforced: z.boolean().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export interface BootstrapRequestDependencies {
  fetch: typeof globalThis.fetch;
}

export async function fetchOidcBootstrap(
  baseUrl: string,
  dependencies: Partial<BootstrapRequestDependencies> = {},
): Promise<OidcBootstrap> {
  const fetchFn = dependencies.fetch ?? globalThis.fetch;

  let bootstrapUrl: URL;
  try {
    bootstrapUrl = new URL("/api/bootstrap", baseUrl);
  } catch {
    throw new Error("PLANKA_BASE_URL is not a valid URL");
  }

  let response: Response;
  try {
    response = await fetchFn(bootstrapUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new Error("Failed to fetch Planka bootstrap configuration", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(
      `Planka bootstrap request failed with HTTP ${response.status}`,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("Planka returned an invalid bootstrap response");
  }

  const parsed = bootstrapResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Planka returned an invalid bootstrap response");
  }

  const oidc = parsed.data.item?.oidc;
  if (!oidc) {
    throw new Error("OIDC is not configured on the Planka server");
  }

  if (!oidc.authorizationUrl || oidc.authorizationUrl.length === 0) {
    throw new Error(
      "Planka bootstrap response does not contain an OIDC authorization URL",
    );
  }

  const result: OidcBootstrap = {
    authorizationUrl: oidc.authorizationUrl,
    isEnforced: oidc.isEnforced ?? false,
  };

  if (oidc.endSessionUrl != null) {
    result.endSessionUrl = oidc.endSessionUrl;
  }

  return result;
}

export function generateNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function parseAuthorizationUrl(authorizationUrl: string): URL {
  try {
    return new URL(authorizationUrl);
  } catch {
    throw new Error(
      "Planka returned an invalid OIDC authorization URL",
    );
  }
}

export interface PrepareOidcLoginDependencies
  extends BootstrapRequestDependencies {
  generateNonce: () => string;
}

const defaultDependencies: PrepareOidcLoginDependencies = {
  fetch: globalThis.fetch,
  generateNonce,
};

export async function prepareOidcLogin(
  baseUrl: string,
  dependencies: Partial<PrepareOidcLoginDependencies> = {},
): Promise<PreparedOidcLogin> {
  const deps: PrepareOidcLoginDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };

  const bootstrap = await fetchOidcBootstrap(baseUrl, deps);
  const nonce = deps.generateNonce();
  const authorizationUrl = parseAuthorizationUrl(
    bootstrap.authorizationUrl,
  );

  authorizationUrl.searchParams.set("nonce", nonce);

  return {
    authorizationUrl,
    nonce,
  };
}
