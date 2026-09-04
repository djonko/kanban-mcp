import { z } from "zod";

export interface ExchangeOidcCodeInput {
  code: string;
  nonce: string;
}

export interface ExchangeOidcCodeResult {
  accessToken: string;
}

export interface ExchangeOidcCodeDependencies {
  fetch: typeof globalThis.fetch;
}

const exchangeResponseSchema = z.object({
  item: z.string().refine((value) => value.trim().length > 0),
});

const termsResponseSchema = z.object({
  step: z.literal("accept-terms"),
  pendingToken: z.string().min(1),
});

function exchangeError(status: number): Error {
  switch (status) {
    case 401:
      return new Error(
        "Planka rejected the OIDC authorization code (HTTP 401). " +
          "Restart oidc-login and try again.",
      );
    case 403:
      return new Error(
        "Planka denied the OIDC token exchange (HTTP 403). Verify that " +
          "the account is allowed to access Planka, then rerun oidc-login.",
      );
    case 409:
      return new Error(
        "Planka reported an OIDC token-exchange conflict (HTTP 409). " +
          "Check the Planka account and identity-provider association, " +
          "then rerun oidc-login.",
      );
    case 422:
      return new Error(
        "Planka could not process the OIDC token exchange (HTTP 422). " +
          "Check the required OIDC claims and Planka configuration, " +
          "then rerun oidc-login.",
      );
    case 500:
      return new Error(
        "Planka encountered a server error during OIDC token exchange " +
          "(HTTP 500). Check the Planka OIDC configuration and server logs, " +
          "then rerun oidc-login.",
      );
    default:
      return new Error(`Planka OIDC token exchange failed (HTTP ${status}).`);
  }
}

export async function exchangeOidcCode(
  baseUrl: string,
  input: ExchangeOidcCodeInput,
  dependencies: Partial<ExchangeOidcCodeDependencies> = {},
): Promise<ExchangeOidcCodeResult> {
  if (input.code.length === 0 || input.nonce.length === 0) {
    throw new Error("OIDC authorization code and nonce are required");
  }

  let url: URL;
  try {
    url = new URL("/api/access-tokens/exchange-with-oidc", baseUrl);
  } catch {
    throw new Error("PLANKA_BASE_URL is not a valid URL");
  }

  const fetchFn = dependencies.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: input.code,
        nonce: input.nonce,
        withHttpOnlyToken: false,
      }),
    });
  } catch (error) {
    throw new Error("Failed to contact Planka for OIDC token exchange", {
      cause: error,
    });
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    if (response.ok) {
      throw new Error("Planka returned an invalid OIDC token-exchange response");
    }
  }

  if (!response.ok && termsResponseSchema.safeParse(responseBody).success) {
    throw new Error(
      "Planka requires legal terms acceptance before it can issue an access " +
        "token. Open Planka in a browser, accept the terms, then rerun " +
        "oidc-login.",
    );
  }

  if (!response.ok) {
    throw exchangeError(response.status);
  }

  const parsed = exchangeResponseSchema.safeParse(responseBody);
  if (!parsed.success) {
    throw new Error("Planka returned an invalid OIDC token-exchange response");
  }

  return { accessToken: parsed.data.item };
}
