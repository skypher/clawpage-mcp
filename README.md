# ClawPage MCP Server

MCP server for the [ClawPage](https://api.clawpage.xyz) web extraction API. Extract and structure any web page into clean JSON.

## Install

```bash
npx clawpage-mcp
```

Or with Streamable HTTP transport (for ChatGPT, remote agents):

```bash
npx clawpage-mcp --http
```

## Tools

| Tool | Description |
|------|-------------|
| `register` | Create account, get API key (cpk_ prefix) with 10 free extractions/day |
| `extract_url` | Extract any URL into structured JSON (text, tables, prices, contacts, hours, ratings) |
| `account_info` | Check remaining free extractions and USDC balance |
| `add_wallet` | Associate wallet address for prepaid USDC deposits |
| `deposit` | Credit balance from on-chain USDC transfer |

## Quick Start

1. Use the `register` tool with your email to get an API key
2. Use `extract_url` with the API key and any URL
3. Get back structured JSON with text, tables, prices, contacts, hours, ratings, dates, links, and images

## Authentication

Three options:

- **API Key** (recommended): Register for free, get 10 extractions/day
- **Prepaid USDC**: Deposit USDC on Base for $0.01/extraction
- **x402**: Anonymous on-chain micropayment, no account needed

Cache hits are always free (24h TTL).

## Transport

- **stdio** (default): For Claude Desktop, Cursor, and local MCP clients
- **Streamable HTTP** (`--http`): For ChatGPT, browser-based agents, and remote connections. Listens on port 8080 (override with `MCP_PORT` env var)

## Claude Desktop Config

```json
{
  "mcpServers": {
    "clawpage": {
      "command": "npx",
      "args": ["clawpage-mcp"]
    }
  }
}
```

## API

Base URL: `https://api.clawpage.xyz`

See [SKILL.md](SKILL.md) for full API documentation.

## License

MIT
