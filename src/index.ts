interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * Environment and Climate Change Canada (ECCC) GeoMet MCP.
 *
 * Official Canadian weather and water via the MSC GeoMet OGC API Features
 * service (api.weather.gc.ca): real-time surface observations
 * (swob-realtime), active weather alerts (weather-alerts), daily climate
 * records (climate-daily), Water Survey of Canada river gauges
 * (hydrometric-stations / hydrometric-realtime), and a directory of every
 * collection GeoMet serves. Keyless.
 *
 * GeoMet publishes 100+ OGC API Features collections; this pack exposes the
 * handful worth a purpose-built tool, plus `geomet_collections` so a caller
 * can see what else is there (CMIP5/CanDCSU6 climate projections, HYDAT
 * historical daily/monthly means, marine and partner station registries)
 * rather than guessing at collection ids.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Environment and Climate Change Canada');
}

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
  {
    name: 'geomet_collections',
    description:
      'Directory of every dataset Environment and Climate Change Canada publishes through MSC GeoMet (100+ OGC API Features collections). Returns each collection id, title, description, keywords and geographic extent. Use it to find what Canadian weather, water, air-quality or climate-projection data exists and what its collection id is, before reaching for a purpose-built tool. Example: search "hydrometric" for river gauge datasets, "cmip5" for climate projections, "swob" for surface observations.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Case-insensitive substring matched against collection id, title, description and keywords, e.g. "hydrometric".',
        },
        limit: { type: 'number', description: 'Max collections to return (default 30, max 150).' },
      },
    },
  },
  {
    name: 'hydrometric_stations_near',
    description:
      'Water Survey of Canada river and lake gauges near a point, from the MSC GeoMet hydrometric-stations collection. AUTHORITATIVE for "which gauge measures the <Canadian river> at <place>" — these are the official federal hydrometric stations. Returns station number (the id you pass to hydrometric_realtime), station name, province, active/discontinued status, gross drainage area in km2, whether it reports in real time, and coordinates. Example: latitude 43.65, longitude -79.38 for Toronto-area gauges.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees, e.g. 43.65 (Toronto).' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees, e.g. -79.38 (Toronto).' },
        radius_deg: {
          type: 'number',
          description: 'Half-width of the search box in degrees (default 0.5, max 5). 0.5 deg is roughly 55 km north-south.',
        },
        province: {
          type: 'string',
          description: 'Optional two-letter province or territory code, e.g. "ON", "BC", "QC".',
        },
        real_time_only: {
          type: 'boolean',
          description: 'When true, return only stations that report in real time (the ones hydrometric_realtime can serve). Default false.',
        },
        limit: { type: 'number', description: 'Max stations to return (default 20, max 100).' },
      },
    },
  },
  {
    name: 'hydrometric_realtime',
    description:
      'Real-time water level (metres) and discharge/flow (m3/s) readings from Water Survey of Canada gauges, typically every 5-15 minutes and covering the last 30 days. AUTHORITATIVE for "how high is the <Canadian river> right now" and for flood watching in Canada. Pass a station number from hydrometric_stations_near, e.g. "02HC003" (HUMBER RIVER AT WESTON), or give latitude/longitude to get the most recent readings from every real-time gauge in the area. Readings come back newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        station_number: {
          type: 'string',
          description: 'Water Survey of Canada station number, e.g. "02HC003". Get one from hydrometric_stations_near.',
        },
        latitude: { type: 'number', description: 'Latitude, used instead of station_number to sweep an area, e.g. 43.65.' },
        longitude: { type: 'number', description: 'Longitude, used with latitude, e.g. -79.38.' },
        radius_deg: { type: 'number', description: 'Half-width of the area sweep in degrees (default 0.5, max 5).' },
        start_date: { type: 'string', description: 'Optional start of a time window, YYYY-MM-DD, e.g. "2026-09-10". Data goes back 30 days.' },
        end_date: { type: 'string', description: 'Optional end of the time window, YYYY-MM-DD, e.g. "2026-09-17".' },
        limit: { type: 'number', description: 'Max readings to return (default 20, max 200).' },
      },
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
      case 'geomet_collections':
        return geometCollections(args);
      case 'hydrometric_stations_near':
        return hydrometricStationsNear(args);
      case 'hydrometric_realtime':
        return hydrometricRealtime(args);
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
  const res = await pwFetch(`${BASE}${path}?${qs}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: await httpErrorMessage(res, 'Environment and Climate Change Canada') };
  const data = await parseJson<{ features?: Feature[] }>(res, 'Environment and Climate Change Canada');
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

// --- MSC GeoMet collection directory and Water Survey of Canada gauges ---

type Collection = {
  id?: string;
  title?: string;
  description?: string;
  keywords?: unknown;
  extent?: { spatial?: { bbox?: unknown } };
};

async function geometCollections(args: Record<string, unknown>): Promise<unknown> {
  const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
  const limit = clampLimit(args.limit, 30, 150);

  const res = await pwFetch(`${BASE}/collections?f=json`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: await httpErrorMessage(res, 'Environment and Climate Change Canada') };
  const data = await parseJson<{ collections?: Collection[] }>(res, 'Environment and Climate Change Canada');
  const all = Array.isArray(data.collections) ? data.collections : [];

  const matched = search
    ? all.filter((c) => {
        const kw = Array.isArray(c.keywords) ? c.keywords.join(' ') : '';
        return `${c.id ?? ''} ${c.title ?? ''} ${c.description ?? ''} ${kw}`.toLowerCase().includes(search);
      })
    : all;

  const collections = matched.slice(0, limit).map((c) => {
    const bbox = c.extent?.spatial?.bbox;
    return {
      collection_id: c.id ?? null,
      title: c.title ?? null,
      description: typeof c.description === 'string' ? c.description.slice(0, 400) : null,
      keywords: Array.isArray(c.keywords) ? c.keywords.slice(0, 10) : [],
      bbox: Array.isArray(bbox) && Array.isArray(bbox[0]) ? bbox[0] : null,
    };
  });

  return {
    source: 'Environment and Climate Change Canada — MSC GeoMet OGC API Features',
    total_collections: all.length,
    search: search || null,
    count: collections.length,
    collections,
  };
}

async function hydrometricStationsNear(args: Record<string, unknown>): Promise<unknown> {
  const lat = typeof args.latitude === 'number' ? args.latitude : null;
  const lon = typeof args.longitude === 'number' ? args.longitude : null;
  const province = typeof args.province === 'string' ? args.province.trim().toUpperCase() : '';
  if ((lat === null || lon === null) && !province) {
    return { error: 'provide latitude and longitude, or a province code such as "ON"' };
  }
  const rad = clampDeg(args.radius_deg, 0.5, 5);
  const limit = clampLimit(args.limit, 20, 100);

  const params: Record<string, string> = { limit: String(limit) };
  if (lat !== null && lon !== null) {
    params.bbox = `${lon - rad},${lat - rad},${lon + rad},${lat + rad}`;
  }
  if (province) params.PROV_TERR_STATE_LOC = province;

  const result = await getFeatures('/collections/hydrometric-stations/items', params);
  if ('error' in result) return result;

  const realTimeOnly = args.real_time_only === true;
  const stations = result.features
    .map((f) => {
      const p = f.properties ?? {};
      return {
        station_number: pick(p, ['STATION_NUMBER', 'IDENTIFIER']),
        station_name: pick(p, ['STATION_NAME']),
        province: pick(p, ['PROV_TERR_STATE_LOC']),
        status: pick(p, ['STATUS_EN']),
        real_time: p.REAL_TIME === 1 || p.REAL_TIME === true,
        reference_hydrometric_basin_network: p.RHBN === 1 || p.RHBN === true,
        drainage_area_km2: pick(p, ['DRAINAGE_AREA_GROSS']),
        vertical_datum: pick(p, ['VERTICAL_DATUM']),
        contributor: pick(p, ['CONTRIBUTOR_EN']),
        ...pointCoords(f),
      };
    })
    .filter((s) => !realTimeOnly || s.real_time);

  return {
    source: 'Water Survey of Canada via MSC GeoMet (hydrometric-stations)',
    latitude: lat,
    longitude: lon,
    radius_deg: lat !== null && lon !== null ? rad : null,
    province: province || null,
    count: stations.length,
    stations,
  };
}

async function hydrometricRealtime(args: Record<string, unknown>): Promise<unknown> {
  const station = typeof args.station_number === 'string' ? args.station_number.trim().toUpperCase() : '';
  const lat = typeof args.latitude === 'number' ? args.latitude : null;
  const lon = typeof args.longitude === 'number' ? args.longitude : null;
  if (!station && (lat === null || lon === null)) {
    return { error: 'provide station_number (e.g. "02HC003"), or latitude and longitude to sweep an area' };
  }
  const limit = clampLimit(args.limit, 20, 200);
  const rad = clampDeg(args.radius_deg, 0.5, 5);

  const params: Record<string, string> = { limit: String(limit), sortby: '-DATETIME' };
  if (station) params.STATION_NUMBER = station;
  else params.bbox = `${(lon as number) - rad},${(lat as number) - rad},${(lon as number) + rad},${(lat as number) + rad}`;

  const start = typeof args.start_date === 'string' ? args.start_date.trim() : '';
  const end = typeof args.end_date === 'string' ? args.end_date.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    params.datetime = `${start}T00:00:00Z/${end}T23:59:59Z`;
  }

  const result = await getFeatures('/collections/hydrometric-realtime/items', params);
  if ('error' in result) return result;

  const readings = result.features.map((f) => {
    const p = f.properties ?? {};
    return {
      station_number: pick(p, ['STATION_NUMBER']),
      station_name: pick(p, ['STATION_NAME']),
      province: pick(p, ['PROV_TERR_STATE_LOC']),
      observed_at: pick(p, ['DATETIME']),
      observed_at_local: pick(p, ['DATETIME_LST']),
      water_level_m: pick(p, ['LEVEL']),
      discharge_cms: pick(p, ['DISCHARGE']),
      level_symbol: pick(p, ['LEVEL_SYMBOL_EN']),
      discharge_symbol: pick(p, ['DISCHARGE_SYMBOL_EN']),
      ...pointCoords(f),
    };
  });

  return {
    source: 'Water Survey of Canada via MSC GeoMet (hydrometric-realtime, last 30 days)',
    station_number: station || null,
    latitude: lat,
    longitude: lon,
    units: { water_level_m: 'metres', discharge_cms: 'cubic metres per second' },
    count: readings.length,
    readings,
  };
}

/** Degrees version of clampLimit — fractional, so it cannot use Math.floor. */
function clampDeg(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : def;
  return Math.min(n, max);
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
