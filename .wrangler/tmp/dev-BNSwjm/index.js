var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/dates.ts
var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
var MS_PER_DAY = 864e5;
function parseISODate(s) {
  const m = ISO_DATE.exec(s);
  if (!m) throw new RangeError(`not an ISO YYYY-MM-DD date: ${JSON.stringify(s)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`date does not exist: ${s}`);
  }
  return ms;
}
__name(parseISODate, "parseISODate");
function toISODate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
__name(toISODate, "toISODate");
function addDays(d, n) {
  return toISODate(parseISODate(d) + n * MS_PER_DAY);
}
__name(addDays, "addDays");
function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
__name(compareISO, "compareISO");
function todayUTC(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}
__name(todayUTC, "todayUTC");
var DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
var DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC"
});
var FULL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

// src/lib/deadlines.ts
function hasOpenDeadline(event, today) {
  return (event.deadlines ?? []).some((d) => compareISO(d.date, today) >= 0);
}
__name(hasOpenDeadline, "hasOpenDeadline");
function hasOpenTravelGrant(event, today) {
  return (event.deadlines ?? []).some(
    (d) => d.type === "travel_grant" && compareISO(d.date, today) >= 0
  );
}
__name(hasOpenTravelGrant, "hasOpenTravelGrant");

// src/lib/filter.ts
function filterRowFromEvent(event, today) {
  return {
    search: [event.title, event.organizer ?? "", event.location?.city ?? ""].join(" ").toLowerCase(),
    topics: event.topics,
    region: event.region,
    country: event.location?.country ?? "",
    format: event.format,
    type: event.type,
    start: event.start_date,
    end: event.end_date,
    openDeadline: hasOpenDeadline(event, today),
    openGrant: hasOpenTravelGrant(event, today),
    fee: event.fee ?? ""
  };
}
__name(filterRowFromEvent, "filterRowFromEvent");
function parseFilterState(params) {
  return {
    q: params.get("q")?.trim() ?? "",
    topics: (params.get("topics") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    region: params.get("region") ?? "",
    country: params.get("country") ?? "",
    format: params.get("format") ?? "",
    type: params.get("type") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    deadline: params.get("deadline") === "open",
    grant: params.get("grant") === "open",
    fee: params.get("fee") ?? ""
  };
}
__name(parseFilterState, "parseFilterState");
function serialiseFilterState(state) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.topics.length > 0) params.set("topics", state.topics.join(","));
  if (state.region) params.set("region", state.region);
  if (state.country) params.set("country", state.country);
  if (state.format) params.set("format", state.format);
  if (state.type) params.set("type", state.type);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.deadline) params.set("deadline", "open");
  if (state.grant) params.set("grant", "open");
  if (state.fee) params.set("fee", state.fee);
  return params;
}
__name(serialiseFilterState, "serialiseFilterState");
function isEmptyFilter(state) {
  return serialiseFilterState(state).toString() === "";
}
__name(isEmptyFilter, "isEmptyFilter");
function matchesFilter(row, state) {
  if (state.q && !row.search.includes(state.q.toLowerCase())) return false;
  if (state.topics.length > 0 && !state.topics.some((t) => row.topics.includes(t))) return false;
  if (state.region && row.region !== state.region) return false;
  if (state.country && row.country !== state.country) return false;
  if (state.format && row.format !== state.format) return false;
  if (state.type && row.type !== state.type) return false;
  if (state.from && row.end < state.from) return false;
  if (state.to && row.start > state.to) return false;
  if (state.deadline && !row.openDeadline) return false;
  if (state.grant && !row.openGrant) return false;
  if (state.fee && row.fee !== state.fee) return false;
  return true;
}
__name(matchesFilter, "matchesFilter");

// src/lib/ical.ts
function escapeText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\r\n/g, "\\n").replace(/[\r\n]/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}
__name(escapeText, "escapeText");
var encoder = new TextEncoder();
function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let bytes = 0;
  let isFirst = true;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = isFirst ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      isFirst = false;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts[0] + parts.slice(1).map((p) => `\r
 ${p}`).join("");
}
__name(foldLine, "foldLine");
function stampOf(date) {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}
__name(stampOf, "stampOf");
function icalDate(d) {
  return d.replace(/-/g, "");
}
__name(icalDate, "icalDate");
function buildCalendar(name, events, stamp) {
  const dtstamp = stampOf(stamp);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CompChem Observer//EN",
    "CALSCALE:GREGORIAN",
    // No METHOD line: PUBLISH is iTIP scheduling transport (RFC 5546), not
    // RFC 5545 core, and RFC 5546 §3.2.1 would then require ORGANIZER, which
    // would mean publishing site.config.ts's placeholder contact into every
    // event of a public subscription feed. Removing METHOD avoids both.
    `X-WR-CALNAME:${escapeText(name)}`
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icalDate(e.start)}`,
      // DTEND is exclusive: the day after the last day of the event.
      `DTEND;VALUE=DATE:${icalDate(addDays(e.end, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.cancelled) lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r
`;
}
__name(buildCalendar, "buildCalendar");

// site.config.ts
var site = {
  name: "CompChem Observer",
  tagline: "Conferences, workshops and schools in computational chemistry",
  url: "https://compchem.observer",
  contactEmail: "contacts@compchem.observer",
  repoUrl: "https://github.com/beregdsk/compchem-observer",
  reportForm: {
    url: "https://tally.so/r/ODvo7M",
    eventIdParam: "event_id",
    eventUrlParam: "event_url"
  },
  submissionFormUrl: "https://tally.so/r/RGpV04",
  donateUrl: "https://www.donationalerts.com/r/beregdsk"
};
var siteDomain = new URL(site.url).host;

// src/lib/event-calendar.ts
function eventsCalendar(events, stamp, scope = "events") {
  const items = events.map((e) => ({
    uid: `${e.id}@${siteDomain}`,
    summary: e.title,
    description: [e.description, e.url].join("\n\n"),
    start: e.start_date,
    end: e.end_date,
    url: e.url,
    location: e.format === "online" ? "Online" : [e.location?.venue, e.location?.city, e.location?.country].filter(Boolean).join(", "),
    cancelled: e.status === "cancelled"
  }));
  return buildCalendar(`${site.name} \u2014 ${scope}`, items, stamp);
}
__name(eventsCalendar, "eventsCalendar");

// src/worker/feed.ts
function filteredCalendar(events, state, now) {
  const today = todayUTC(now);
  const matching = events.filter(
    (e) => compareISO(e.end_date, today) >= 0 && matchesFilter(filterRowFromEvent(e, today), state)
  );
  return eventsCalendar(matching, now, isEmptyFilter(state) ? "events" : "filtered events");
}
__name(filteredCalendar, "filteredCalendar");

// src/worker/index.ts
async function loadBuiltEvents(env, origin) {
  const res = await env.ASSETS.fetch(new Request(new URL("/events.json", origin)));
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
  const body = await res.json();
  return body.events;
}
__name(loadBuiltEvents, "loadBuiltEvents");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/feed/events.ics") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const events = await loadBuiltEvents(env, url.origin);
      const ics = filteredCalendar(events, parseFilterState(url.searchParams), /* @__PURE__ */ new Date());
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          // Calendar apps poll; an hour matches how often the data can change.
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-WtyxIs/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-WtyxIs/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default,
  loadBuiltEvents
};
//# sourceMappingURL=index.js.map
