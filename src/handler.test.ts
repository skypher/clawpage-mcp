import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  handleExtract,
  handleRegister,
  handleAccount,
  handleAddWallet,
  handleDeposit,
} from "./handler.js";

function mockFetch(
  status: number,
  body: object | string,
  headers?: Record<string, string>
): typeof fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const headerMap = new Headers(headers);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: headerMap }
    );
  };
}

function failingFetch(): typeof fetch {
  return async () => {
    throw new Error("Connection refused");
  };
}

// --- handleExtract ---

describe("handleExtract", () => {
  it("returns structured data on 200 (cache hit)", async () => {
    const mockData = {
      status: "done",
      data: {
        url: "https://example.com",
        title: "Example",
        content: { main_text: "Hello", sections: [] },
        structured: {},
      },
    };

    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(200, mockData)
    );

    assert.strictEqual(result.isError, undefined);
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, "text");

    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.status, "done");
    assert.strictEqual(parsed.data.title, "Example");
  });

  it("returns auth required on 402 with options", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(402, { options: ["register", "x402"] })
    );

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("Authentication required"));
    assert.ok(text.includes("register"));
    assert.ok(text.includes("x402"));
  });

  it("returns exhausted message on 402 with exhausted error", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(402, { error: "Free tier exhausted and insufficient balance" })
    );

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("Free tier exhausted"));
    assert.ok(text.includes("Deposit USDC"));
  });

  it("returns payment instructions on 402 with payment headers", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(402, {}, {
        "X-Payment-Recipient": "0xABCD",
        "X-Payment-Amount": "0.01",
        "X-Payment-Currency": "USDC",
        "X-Payment-Network": "base",
      })
    );

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("not cached and requires payment"));
    assert.ok(text.includes("0.01 USDC on base"));
    assert.ok(text.includes("0xABCD"));
    assert.ok(text.includes("call extract_url again"));
  });

  it("uses default payment values when headers are missing", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(402, {})
    );

    const text = result.content[0].text;
    assert.ok(text.includes("0x9FBF0f395b0610Bc15B17d84aB1f6CEF325420E9"));
    assert.ok(text.includes("0.01 USDC"));
  });

  it("returns job info on 202 (async mode)", async () => {
    const result = await handleExtract(
      { url: "https://example.com", sync: false },
      mockFetch(202, {
        job_id: "abc123",
        poll_url: "/result/abc123",
        estimated_seconds: 15,
      })
    );

    assert.strictEqual(result.isError, undefined);
    const text = result.content[0].text;
    assert.ok(text.includes("async mode"));
    assert.ok(text.includes("abc123"));
    assert.ok(text.includes("/result/abc123"));
    assert.ok(text.includes("15s"));
  });

  it("sends X-Payment-Proof header when tx_hash provided", async () => {
    let capturedHeaders: Record<string, string> = {};

    const capturingFetch: typeof fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) capturedHeaders = { ...h };
      return new Response(
        JSON.stringify({ status: "done", data: { url: "https://example.com" } }),
        { status: 200 }
      );
    };

    await handleExtract(
      { url: "https://example.com", tx_hash: "0xdeadbeef" },
      capturingFetch
    );

    assert.strictEqual(capturedHeaders["X-Payment-Proof"], "0xdeadbeef");
  });

  it("sends X-API-Key header when api_key provided", async () => {
    let capturedHeaders: Record<string, string> = {};

    const capturingFetch: typeof fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) capturedHeaders = { ...h };
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await handleExtract(
      { url: "https://example.com", api_key: "cpk_testkey123" },
      capturingFetch
    );

    assert.strictEqual(capturedHeaders["X-API-Key"], "cpk_testkey123");
  });

  it("does not send X-Payment-Proof when tx_hash is absent", async () => {
    let capturedHeaders: Record<string, string> = {};

    const capturingFetch: typeof fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      const h = init?.headers as Record<string, string> | undefined;
      if (h) capturedHeaders = { ...h };
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await handleExtract({ url: "https://example.com" }, capturingFetch);

    assert.strictEqual(capturedHeaders["X-Payment-Proof"], undefined);
  });

  it("returns error on 401 invalid key", async () => {
    const result = await handleExtract(
      { url: "https://example.com", api_key: "cpk_bad" },
      mockFetch(401, { error: "Invalid API key" })
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Invalid API key"));
  });

  it("returns error on network failure", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      failingFetch()
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Failed to connect"));
    assert.ok(result.content[0].text.includes("Connection refused"));
  });

  it("returns error on unexpected status code", async () => {
    const result = await handleExtract(
      { url: "https://example.com" },
      mockFetch(500, "Internal Server Error")
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("500"));
    assert.ok(result.content[0].text.includes("Internal Server Error"));
  });

  it("sends correct request body", async () => {
    let capturedBody = "";

    const capturingFetch: typeof fetch = async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await handleExtract(
      { url: "https://example.com/page", sync: false },
      capturingFetch
    );

    const parsed = JSON.parse(capturedBody);
    assert.strictEqual(parsed.url, "https://example.com/page");
    assert.strictEqual(parsed.sync, false);
  });
});

// --- handleRegister ---

describe("handleRegister", () => {
  it("returns api key on success", async () => {
    const result = await handleRegister(
      { email: "test@example.com" },
      mockFetch(200, { api_key: "cpk_abc123", free_extractions: 10 })
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.api_key, "cpk_abc123");
    assert.strictEqual(parsed.free_extractions, 10);
  });

  it("returns error on duplicate email", async () => {
    const result = await handleRegister(
      { email: "dupe@example.com" },
      mockFetch(409, { error: "Email already registered" })
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("409"));
  });

  it("returns error on network failure", async () => {
    const result = await handleRegister(
      { email: "test@example.com" },
      failingFetch()
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Failed to connect"));
  });
});

// --- handleAccount ---

describe("handleAccount", () => {
  it("returns account info on success", async () => {
    const acct = {
      email: "user@test.com",
      balance_usdc: 1.5,
      free_extractions_remaining: 7,
      wallets: ["0xABC"],
    };

    const result = await handleAccount(
      { api_key: "cpk_valid" },
      mockFetch(200, acct)
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.email, "user@test.com");
    assert.strictEqual(parsed.free_extractions_remaining, 7);
  });

  it("returns error on invalid key", async () => {
    const result = await handleAccount(
      { api_key: "cpk_bad" },
      mockFetch(401, { error: "Invalid API key" })
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("401"));
  });

  it("returns error on network failure", async () => {
    const result = await handleAccount(
      { api_key: "cpk_valid" },
      failingFetch()
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Failed to connect"));
  });
});

// --- handleAddWallet ---

describe("handleAddWallet", () => {
  it("returns success message on 200", async () => {
    const result = await handleAddWallet(
      { api_key: "cpk_valid", wallet_address: "0x1234567890abcdef1234567890abcdef12345678" },
      mockFetch(200, { success: true })
    );

    assert.strictEqual(result.isError, undefined);
    assert.ok(result.content[0].text.includes("associated successfully"));
    assert.ok(result.content[0].text.includes("0x1234567890abcdef1234567890abcdef12345678"));
  });

  it("returns error on duplicate wallet", async () => {
    const result = await handleAddWallet(
      { api_key: "cpk_valid", wallet_address: "0xDUPE" },
      mockFetch(409, { error: "Wallet already associated" })
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("409"));
  });

  it("returns error on network failure", async () => {
    const result = await handleAddWallet(
      { api_key: "cpk_valid", wallet_address: "0xABC" },
      failingFetch()
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Failed to connect"));
  });
});

// --- handleDeposit ---

describe("handleDeposit", () => {
  it("returns deposit info on success", async () => {
    const result = await handleDeposit(
      { api_key: "cpk_valid", tx_hash: "0xdeadbeef" },
      mockFetch(200, { success: true, credited_usdc: 5.0, new_balance: 6.5 })
    );

    assert.strictEqual(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.credited_usdc, 5.0);
    assert.strictEqual(parsed.new_balance, 6.5);
  });

  it("returns error on invalid tx", async () => {
    const result = await handleDeposit(
      { api_key: "cpk_valid", tx_hash: "0xbad" },
      mockFetch(400, { error: "Transaction not found" })
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Deposit failed"));
    assert.ok(result.content[0].text.includes("400"));
  });

  it("returns error on network failure", async () => {
    const result = await handleDeposit(
      { api_key: "cpk_valid", tx_hash: "0xdeadbeef" },
      failingFetch()
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Failed to connect"));
  });
});
