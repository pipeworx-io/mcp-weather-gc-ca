interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Environment and Climate Change Canada (ECCC) GeoMet MCP.
 *
 * Official Canadian weather via the MSC GeoMet OGC API Features service
 * (api.weather.gc.ca): real-time surface observations (swob-realtime),
 * active weather alerts (weather-alerts), and daily climate records
 * (climate-daily). Keyless.
 */


const BASE = 'https://api.weather.gc.ca';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'current_observations',
    description:
      'Latest real-time surface weather observations from Environment Canada stations near a point (swob-realtime). Returns station name, observation time, air temp, dewpoint, humidity, wind, pressure, snow depth. Example: latitude 43.65, longitude -79.38 for Toronto. Keyless, official ECCC data.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees, e.g. 43.65 (Toronto).' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees, e.g. -79.38 (Toronto).' },
        limit: { type: 'number', description: 'Max observations to return (default 5, max 20).' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'active_alerts',
    description:
      'Active Environment Canada weather alerts (warnings, watches, statements) across Canada, optionally filtered near a point. Returns alert name, type, risk colour, affected area, province, effective/expiry times and a text excerpt. Example: latitude 43.65, longitude -79.38 for Toronto-area alerts. Keyless, official ECCC data.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Optional latitude — if both latitude and longitude are given, alerts are filtered to a ±2° box around the point.',
        },
        longitude: { type: 'number', description: 'Optional longitude (used with latitude).' },
        limit: { type: 'number', description: 'Max alerts to return (default 10, max 30).' },
      },
    },
  },
  {
    name: 'climate_daily',
    description:
      'Daily climate records (max/min/mean temperature °C, total precipitation mm, snow on ground cm) for an Environment Canada station over a date range. Use a 7-digit climate identifier, e.g. "6158355" (TORONTO CITY) or "1108395" (VANCOUVER INTL A). Station IDs come from the climate-stations collection. Keyless, official ECCC data.',
    inputSchema: {
      type: 'object',
      properties: {
        climate_id: {
          type: 'string',
          description: 'ECCC climate identifier, e.g. "6158355" (TORONTO CITY).',
        },
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD, e.g. "2026-05-01".' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD, e.g. "2026-05-07". Max 50 days returned.' },
      },
      required: ['climate_id', 'start_date', 'end_date'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'current_observations':
        return currentObservations(args);
      case 'active_alerts':
        return activeAlerts(args);
      case 'climate_daily':
        return climateDaily(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type Feature = { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };

/** GET an OGC API Features items URL and return the feature list (or an error object). */
async function getFeatures(
  path: string,
  params: Record<string, string>
): Promise<{ features: Feature[] } | { error: string }> {
  const qs = new URLSearchParams({ f: 'json', ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `weather.gc.ca: ${res.status} ${(await res.text()).slice(0, 200)}` };
  const data = (await res.json()) as { features?: Feature[] };
  return { features: Array.isArray(data.features) ? data.features : [] };
}

/** First non-null/undefined numeric or string value among candidate property keys. */
function pick(props: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = props[k];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

/** Like pick(), but skips swob values whose `{key}-qa` quality flag is negative (suspect/failed QC). */
function pickQa(props: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = props[k];
    if (v === null || v === undefined || v === '') continue;
    const qa = props[`${k}-qa`];
    if (typeof qa === 'number' && qa < 0) continue;
    return v;
  }
  return null;
}

function clampLimit(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : def;
  return Math.min(Math.max(n, 1), max);
}

function pointCoords(f: Feature): { latitude: number | null; longitude: number | null } {
  const c = f.geometry?.coordinates;
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { latitude: c[1], longitude: c[0] };
  }
  return { latitude: null, longitude: null };
}

async function currentObservations(args: Record<string, unknown>): Promise<unknown> {
  const lat = typeof args.latitude === 'number' ? args.latitude : NaN;
  const lon = typeof args.longitude === 'number' ? args.longitude : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: 'provide numeric latitude and longitude', latitude: args.latitude ?? null, longitude: args.longitude ?? null };
  }
  const limit = clampLimit(args.limit, 5, 20);

  const result = await getFeatures('/collections/swob-realtime/items', {
    bbox: `${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`,
    limit: String(limit),
    sortby: '-date_tm-value',
  });
  if ('error' in result) return result;

  const observations = result.features.map((f) => {
    const p = f.properties ?? {};
    return {
      station: pick(p, ['stn_nam-value']),
      climate_id: pick(p, ['clim_id-value']),
      observed_at: pick(p, ['date_tm-value', 'obs_date_tm']),
      air_temp_c: pickQa(p, ['air_temp', 'avg_air_temp_pst1hr']),
      dewpoint_c: pickQa(p, ['dwpt_temp', 'avg_dwpt_temp_pst1hr']),
      rel_humidity_pct: pickQa(p, ['rel_hum', 'avg_rel_hum_pst1hr']),
      wind_speed_kmh: pickQa(p, [
        'avg_wnd_spd_10m_pst1mt',
        'avg_wnd_spd_10m_pst2mts',
        'avg_wnd_spd_10m_pst10mts',
        'avg_wnd_spd_10m_pst1hr',
      ]),
      wind_dir_deg: pickQa(p, [
        'avg_wnd_dir_10m_pst1mt',
        'avg_wnd_dir_10m_pst2mts',
        'avg_wnd_dir_10m_pst10mts',
        'avg_wnd_dir_10m_pst1hr',
      ]),
      wind_gust_kmh: pickQa(p, ['max_wnd_spd_10m_pst1mt', 'max_wnd_spd_10m_pst1hr']),
      station_pressure_hpa: pickQa(p, ['stn_pres', 'mslp']),
      snow_depth_cm: pickQa(p, ['snw_dpth']),
      ...pointCoords(f),
    };
  });

  return { count: observations.length, observations };
}

async function activeAlerts(args: Record<string, unknown>): Promise<unknown> {
  const lat = typeof args.latitude === 'number' ? args.latitude : null;
  const lon = typeof args.longitude === 'number' ? args.longitude : null;
  const limit = clampLimit(args.limit, 10, 30);

  const params: Record<string, string> = { limit: String(limit) };
  if (lat !== null && lon !== null) {
    params.bbox = `${lon - 2},${lat - 2},${lon + 2},${lat + 2}`;
  }

  const result = await getFeatures('/collections/weather-alerts/items', params);
  if ('error' in result) return result;

  const alerts = result.features.map((f) => {
    const p = f.properties ?? {};
    const text = pick(p, ['alert_text_en']);
    return {
      name: pick(p, ['alert_name_en', 'alert_short_name_en']),
      type: pick(p, ['alert_type']), // warning | watch | statement | advisory
      code: pick(p, ['alert_code']),
      risk_colour: pick(p, ['risk_colour_en']),
      confidence: pick(p, ['confidence_en']),
      area: pick(p, ['feature_name_en']),
      province: pick(p, ['province']),
      status: pick(p, ['status_en']),
      effective: pick(p, ['validity_datetime', 'publication_datetime']),
      expires: pick(p, ['expiration_datetime']),
      event_ends: pick(p, ['event_end_datetime']),
      text_excerpt: typeof text === 'string' ? text.slice(0, 500) : null,
    };
  });

  return { count: alerts.length, alerts };
}

async function climateDaily(args: Record<string, unknown>): Promise<unknown> {
  const climateId = typeof args.climate_id === 'string' ? args.climate_id.trim() : '';
  const start = typeof args.start_date === 'string' ? args.start_date.trim() : '';
  const end = typeof args.end_date === 'string' ? args.end_date.trim() : '';
  if (!climateId) return { error: 'provide climate_id, e.g. "6158355" (TORONTO CITY)' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return { error: 'provide start_date and end_date as YYYY-MM-DD', start_date: start || null, end_date: end || null };
  }

  const result = await getFeatures('/collections/climate-daily/items', {
    CLIMATE_IDENTIFIER: climateId,
    datetime: `${start}/${end}`,
    sortby: 'LOCAL_DATE',
    limit: '50',
  });
  if ('error' in result) return result;

  const first = result.features[0]?.properties ?? {};
  const days = result.features.map((f) => {
    const p = f.properties ?? {};
    const date = pick(p, ['LOCAL_DATE']);
    return {
      date: typeof date === 'string' ? date.slice(0, 10) : date,
      max_temp_c: pick(p, ['MAX_TEMPERATURE']),
      min_temp_c: pick(p, ['MIN_TEMPERATURE']),
      mean_temp_c: pick(p, ['MEAN_TEMPERATURE']),
      total_precip_mm: pick(p, ['TOTAL_PRECIPITATION']),
      total_rain_mm: pick(p, ['TOTAL_RAIN']),
      total_snow_cm: pick(p, ['TOTAL_SNOW']),
      snow_on_ground_cm: pick(p, ['SNOW_ON_GROUND']),
      max_gust_kmh: pick(p, ['SPEED_MAX_GUST']),
    };
  });

  return {
    climate_id: climateId,
    station_name: pick(first, ['STATION_NAME']),
    count: days.length,
    days,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
