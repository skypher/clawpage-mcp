#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handleExtract, handleRegister, handleAccount, handleAddWallet, handleDeposit } from "./handler.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "clawpage",
    version: "0.2.0",
  });

  server.tool(
    "register",
    "Register for a ClawPage account. Returns an API key (cpk_ prefix) with 10 free extractions per day. Required before using extract_url.",
    {
      email: z.string().email().describe("Email address for the account"),
    },
    async (params) => handleRegister(params)
  );

  server.tool(
    "extract_url",
    "Extract and structure a web page into clean JSON. Returns text, tables, prices, contacts, hours, ratings, dates, links, and images. Handles JavaScript-rendered SPAs and bot-blocked sites. Requires an API key (from register) or x402 payment. Cached URLs are free.",
    {
      url: z.string().url().describe("The URL to extract"),
      api_key: z
        .string()
        .optional()
        .describe("API key from register (cpk_ prefix). Required for uncached URLs unless using x402."),
      sync: z
        .boolean()
        .optional()
        .default(true)
        .describe("Wait for result inline (default: true)"),
      tx_hash: z
        .string()
        .optional()
        .describe(
          "Transaction hash for x402 payment proof (alternative to API key)"
        ),
    },
    async (params) => handleExtract(params)
  );

  server.tool(
    "account_info",
    "Get account info including remaining free extractions, USDC balance, and associated wallets.",
    {
      api_key: z.string().describe("API key (cpk_ prefix)"),
    },
    async (params) => handleAccount(params)
  );

  server.tool(
    "add_wallet",
    "Associate a wallet address with your account for prepaid USDC deposits.",
    {
      api_key: z.string().describe("API key (cpk_ prefix)"),
      wallet_address: z.string().describe("Ethereum wallet address (0x...)"),
    },
    async (params) => handleAddWallet(params)
  );

  server.tool(
    "deposit",
    "Credit prepaid USDC balance from an on-chain transaction. Send USDC on Base to the ClawPage wallet, then submit the tx hash here.",
    {
      api_key: z.string().describe("API key (cpk_ prefix)"),
      tx_hash: z.string().describe("Transaction hash of the USDC transfer"),
    },
    async (params) => handleDeposit(params)
  );

  return server;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(port: number) {
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
        }
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.listen(port, () => {
    console.log(`ClawPage MCP server (Streamable HTTP) listening on port ${port}`);
  });

  process.on("SIGINT", async () => {
    for (const sid of Object.keys(transports)) {
      await transports[sid].close();
      delete transports[sid];
    }
    process.exit(0);
  });
}

const mode = process.argv.includes("--http")
  ? "http"
  : process.env.MCP_TRANSPORT === "http"
    ? "http"
    : "stdio";

if (mode === "http") {
  const port = parseInt(process.env.MCP_PORT || "8080", 10);
  startHttp(port);
} else {
  startStdio();
}
