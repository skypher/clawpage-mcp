const API_BASE = "https://api.clawpage.xyz";

export interface ExtractParams {
  url: string;
  api_key?: string;
  sync?: boolean;
  tx_hash?: string;
}

export interface RegisterParams {
  email: string;
}

export interface AccountParams {
  api_key: string;
}

export interface AddWalletParams {
  api_key: string;
  wallet_address: string;
}

export interface DepositParams {
  api_key: string;
  tx_hash: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export async function handleRegister(
  params: RegisterParams,
  fetchFn: typeof fetch = fetch
): Promise<ToolResult> {
  const { email } = params;

  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to connect to ClawPage API: ${err}` }],
      isError: true,
    };
  }

  const data = await res.json();
  if (res.status === 200) {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: `Registration failed (${res.status}): ${JSON.stringify(data)}` }],
    isError: true,
  };
}

export async function handleExtract(
  params: ExtractParams,
  fetchFn: typeof fetch = fetch
): Promise<ToolResult> {
  const { url, api_key, sync = true, tx_hash } = params;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (api_key) {
    headers["X-API-Key"] = api_key;
  }

  if (tx_hash) {
    headers["X-Payment-Proof"] = tx_hash;
  }

  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, sync }),
    });
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Failed to connect to ClawPage API: ${err}` },
      ],
      isError: true,
    };
  }

  if (res.status === 200) {
    const data = await res.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (res.status === 202) {
    const data = await res.json();
    return {
      content: [
        {
          type: "text",
          text: [
            "Extraction started (async mode).",
            `Job ID: ${data.job_id}`,
            `Poll for results: ${API_BASE}${data.poll_url}`,
            `Estimated time: ${data.estimated_seconds}s`,
          ].join("\n"),
        },
      ],
    };
  }

  if (res.status === 402) {
    const body = await res.json();
    if (body.options) {
      return {
        content: [
          {
            type: "text",
            text: [
              "Authentication required. Two options:",
              "",
              "1. Register for free: use the 'register' tool with your email to get an API key with 10 free extractions/day",
              "2. Pay with x402: send 0.01 USDC on Base and retry with tx_hash",
            ].join("\n"),
          },
        ],
      };
    }

    if (body.error?.includes("exhausted")) {
      return {
        content: [
          {
            type: "text",
            text: [
              "Free tier exhausted and insufficient balance.",
              "",
              "Options:",
              "- Wait for daily recharge (10 free extractions per 24h rolling)",
              "- Deposit USDC: use 'add_wallet' then 'deposit' tools",
              "- Pay per request with x402 (no account needed)",
            ].join("\n"),
          },
        ],
      };
    }

    const recipient =
      res.headers.get("X-Payment-Recipient") ||
      "0x9FBF0f395b0610Bc15B17d84aB1f6CEF325420E9";
    const amount = res.headers.get("X-Payment-Amount") || "0.01";
    const currency = res.headers.get("X-Payment-Currency") || "USDC";
    const network = res.headers.get("X-Payment-Network") || "base";

    return {
      content: [
        {
          type: "text",
          text: [
            "This URL is not cached and requires payment.",
            "",
            `Send ${amount} ${currency} on ${network} to:`,
            recipient,
            "",
            "Then call extract_url again with the same URL and tx_hash set to the transaction hash.",
          ].join("\n"),
        },
      ],
    };
  }

  if (res.status === 401) {
    return {
      content: [{ type: "text", text: "Invalid API key. Use the 'register' tool to get a valid key." }],
      isError: true,
    };
  }

  const body = await res.text();
  return {
    content: [
      { type: "text", text: `ClawPage API error (${res.status}): ${body}` },
    ],
    isError: true,
  };
}

export async function handleAccount(
  params: AccountParams,
  fetchFn: typeof fetch = fetch
): Promise<ToolResult> {
  const { api_key } = params;

  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/account`, {
      method: "GET",
      headers: { "X-API-Key": api_key },
    });
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to connect to ClawPage API: ${err}` }],
      isError: true,
    };
  }

  const data = await res.json();
  if (res.status === 200) {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: `Error (${res.status}): ${JSON.stringify(data)}` }],
    isError: true,
  };
}

export async function handleAddWallet(
  params: AddWalletParams,
  fetchFn: typeof fetch = fetch
): Promise<ToolResult> {
  const { api_key, wallet_address } = params;

  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/account/wallets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
      },
      body: JSON.stringify({ wallet_address }),
    });
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to connect to ClawPage API: ${err}` }],
      isError: true,
    };
  }

  const data = await res.json();
  if (res.status === 200) {
    return {
      content: [{ type: "text", text: `Wallet ${wallet_address} associated successfully.` }],
    };
  }

  return {
    content: [{ type: "text", text: `Error (${res.status}): ${JSON.stringify(data)}` }],
    isError: true,
  };
}

export async function handleDeposit(
  params: DepositParams,
  fetchFn: typeof fetch = fetch
): Promise<ToolResult> {
  const { api_key, tx_hash } = params;

  let res: Response;
  try {
    res = await fetchFn(`${API_BASE}/account/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
      },
      body: JSON.stringify({ tx_hash }),
    });
  } catch (err) {
    return {
      content: [{ type: "text", text: `Failed to connect to ClawPage API: ${err}` }],
      isError: true,
    };
  }

  const data = await res.json();
  if (res.status === 200) {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: `Deposit failed (${res.status}): ${JSON.stringify(data)}` }],
    isError: true,
  };
}
