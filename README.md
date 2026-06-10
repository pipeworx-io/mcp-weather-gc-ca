# mcp-weather-gc-ca

Environment and Climate Change Canada (ECCC) GeoMet MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 854+ live data sources.

## Tools

| Tool | Description |
|------|-------------|

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "weather-gc-ca": {
      "url": "https://gateway.pipeworx.io/weather-gc-ca/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 854+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Weather Gc Ca data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
