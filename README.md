# mcp-weather-gc-ca

Environment and Climate Change Canada (ECCC) GeoMet MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `current_observations` | Latest real-time surface weather observations from Environment Canada stations near a point (swob-realtime). Returns station name, observation time, air temp, dewpoint, humidity, wind, pressure, snow depth. Example: latitude 43.65, longitude -79.38 for Toronto. Keyless, official ECCC data. |
| `active_alerts` | Active Environment Canada weather alerts (warnings, watches, statements) across Canada, optionally filtered near a point. Returns alert name, type, risk colour, affected area, province, effective/expiry times and a text excerpt. Example: latitude 43.65, longitude -79.38 for Toronto-area alerts. Keyless, official ECCC data. |
| `climate_daily` | Daily climate records (max/min/mean temperature °C, total precipitation mm, snow on ground cm) for an Environment Canada station over a date range. Use a 7-digit climate identifier, e.g. "6158355" (TORONTO CITY) or "1108395" (VANCOUVER INTL A). Station IDs come from the climate-stations collection. Keyless, official ECCC data. |

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

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

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
