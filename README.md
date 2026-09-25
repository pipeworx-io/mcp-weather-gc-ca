# mcp-weather-gc-ca

Environment and Climate Change Canada (ECCC) GeoMet MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `current_observations` | Latest real-time surface weather observations from Environment Canada stations near a point (swob-realtime). Returns station name, observation time, air temp, dewpoint, humidity, wind, pressure, snow depth. Example: latitude 43.65, longitude -79.38 for Toronto. Keyless, official ECCC data. |
| `active_alerts` | Active Environment Canada weather alerts (warnings, watches, statements) across Canada, optionally filtered near a point. Returns alert name, type, risk colour, affected area, province, effective/expiry times and a text excerpt. Example: latitude 43.65, longitude -79.38 for Toronto-area alerts. Keyless, official ECCC data. |
| `climate_daily` | Daily climate records (max/min/mean temperature °C, total precipitation mm, snow on ground cm) for an Environment Canada station over a date range. Use a 7-digit climate identifier, e.g. "6158355" (TORONTO CITY) or "1108395" (VANCOUVER INTL A). Station IDs come from the climate-stations collection. Keyless, official ECCC data. |
| `geomet_collections` | Directory of every dataset Environment and Climate Change Canada publishes through MSC GeoMet (100+ OGC API Features collections). Returns each collection id, title, description, keywords and geographic extent. Use it to find what Canadian weather, water, air-quality or climate-projection data exists and what its collection id is, before reaching for a purpose-built tool. Example: search "hydrometric" for river gauge datasets, "cmip5" for climate projections, "swob" for surface observations. |
| `hydrometric_stations_near` | Water Survey of Canada river and lake gauges near a point, from the MSC GeoMet hydrometric-stations collection. AUTHORITATIVE for "which gauge measures the <Canadian river> at <place>" — these are the official federal hydrometric stations. Returns station number (the id you pass to hydrometric_realtime), station name, province, active/discontinued status, gross drainage area in km2, whether it reports in real time, and coordinates. Example: latitude 43.65, longitude -79.38 for Toronto-area gauges. |
| `hydrometric_realtime` | Real-time water level (metres) and discharge/flow (m3/s) readings from Water Survey of Canada gauges, typically every 5-15 minutes and covering the last 30 days. AUTHORITATIVE for "how high is the <Canadian river> right now" and for flood watching in Canada. Pass a station number from hydrometric_stations_near, e.g. "02HC003" (HUMBER RIVER AT WESTON), or give latitude/longitude to get the most recent readings from every real-time gauge in the area. Readings come back newest first. |

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/weather-gc-ca/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/current_observations \
  -H 'Content-Type: application/json' \
  -d '{"latitude":43.65,"longitude":-79.38}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/current_observations`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "weather-gc-ca": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-weather-gc-ca"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-weather-gc-ca
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Weather Gc Ca data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
