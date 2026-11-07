// Test-only trusted host. Loopback, synthetic SQLite state, no OAuth/Fortnox data.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { reviewSchema, reviewService } from "../src/review.js";
import { sqliteReviewStore } from "../src/review-sqlite.js";
import { reviewWidget } from "../src/review-widget.js";
import {
  receiptHost,
  receiptHostCsp,
  receiptWidget,
} from "./receipt-harness.js";

const port = 8794;
const origin = `http://127.0.0.1:${port}`;
const db = new DatabaseSync(":memory:");
db.exec(reviewSchema);
type Prepared = Awaited<
  ReturnType<ReturnType<typeof reviewService>["prepare"]>
>;
interface Scenario {
  service: ReturnType<typeof reviewService>;
  prepared: Prepared;
  now: number;
  mode: string;
  commits: number;
  accepted: number;
  statusReads: number;
}
const scenarios = new Map<string, Scenario>();
async function scenario(key: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(key)) throw new Error("Invalid synthetic case");
  let value = scenarios.get(key);
  if (!value) {
    if (scenarios.size >= 64) throw new Error("Synthetic case limit");
    const holder = { now: Date.now() };
    const service = reviewService(sqliteReviewStore(db), key, () => holder.now);
    value = Object.assign(holder, {
      service,
      prepared: await service.prepare(),
      mode: "normal",
      commits: 0,
      accepted: 0,
      statusReads: 0,
    });
    scenarios.set(key, value);
  }
  return value;
}
const hostScript = `
const key = new URL(location.href).searchParams.get("case");
let publicOnly = false,
  saved;
const request = async (path, body) => {
  const response = await fetch(path + "?case=" + encodeURIComponent(key), {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
};
const notify = () => {
  const result = publicOnly
    ? { structuredContent: saved.structuredContent }
    : saved;
  document
    .querySelector("iframe")
    .contentWindow.postMessage(
      {
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: result,
      },
      "*",
    );
};
const mount = () => {
  const frame = document.createElement("iframe");
  frame.title = "Synthetic MCP Apps review";
  frame.sandbox = "allow-scripts";
  frame.src = "/widget";
  frame.style = "width:100%;height:1100px;border:0";
  document.querySelector("main").replaceChildren(frame);
};
window.harness = {
  notify,
  remount: (withoutPrivate = false) => {
    publicOnly = withoutPrivate;
    mount();
  },
  control: (mode) => request("/control", { mode }),
  stats: () => request("/stats"),
};
window.addEventListener("message", async (event) => {
  if (event.source !== document.querySelector("iframe")?.contentWindow) return;
  const m = event.data;
  if (m?.jsonrpc !== "2.0") return;
  if (m.method === "ui/initialize") {
    event.source.postMessage(
      {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          hostInfo: { name: "synthetic-host", version: "0" },
          hostCapabilities: {},
          protocolVersion: "2026-01-26",
        },
      },
      "*",
    );
  } else if (m.method === "ui/notifications/initialized") notify();
  else if (m.method === "tools/call") {
    const result = await request("/rpc", m.params);
    if (result.dropResponse) return;
    event.source.postMessage({ jsonrpc: "2.0", id: m.id, result }, "*");
  }
});
saved = await request("/fixture");
mount();
`;
const hash = (source: string) =>
  `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
const widgetScript = reviewWidget.match(
  /<script type="module">([\s\S]*?)<\/script>/,
)?.[1];
const widgetStyle = reviewWidget.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!widgetScript || !widgetStyle) throw new Error("Missing widget content");
const widgetCsp = `default-src 'none'; script-src ${hash(widgetScript)}; style-src ${hash(widgetStyle)}; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;
const server = createServer(async (request, response) => {
  try {
    if (
      request.headers.host !== `127.0.0.1:${port}` ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      response.writeHead(403).end();
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    const send = (
      value: unknown,
      contentType = "application/json",
      csp = "default-src 'none'",
    ) => {
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
      });
      response.end(
        contentType === "application/json"
          ? JSON.stringify(value)
          : String(value),
      );
    };
    if (request.method === "GET" && url.pathname === "/receipts") {
      send(receiptHost, "text/html", receiptHostCsp);
      return;
    }
    if (request.method === "GET" && url.pathname === "/receipt-widget") {
      // The product HTML supplies its own strict hash-based meta policy.
      send(receiptWidget, "text/html", "frame-ancestors 'self'");
      return;
    }
    if (request.method === "GET" && url.pathname === "/") {
      send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic review host</title><main></main><script type="module" src="/host.js"></script></html>',
        "text/html",
        "default-src 'none'; script-src 'self'; connect-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'",
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/host.js") {
      send(hostScript, "text/javascript");
      return;
    }
    if (request.method === "GET" && url.pathname === "/widget") {
      send(reviewWidget, "text/html", widgetCsp);
      return;
    }
    const state = await scenario(url.searchParams.get("case") ?? "");
    if (request.method === "GET" && url.pathname === "/fixture") {
      const { capability, ...publicData } = state.prepared;
      send({
        structuredContent: { kind: "s00-review-proposal", ...publicData },
        _meta: {
          s00Review: {
            proposalId: publicData.proposalId,
            proposalHash: publicData.proposalHash,
            expires: publicData.expires,
            capability,
          },
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/stats") {
      send({
        commits: state.commits,
        accepted: state.accepted,
        statusReads: state.statusReads,
      });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 16 * 1024) {
        response.writeHead(413).end();
        return;
      }
    }
    const input = JSON.parse(body) as {
      mode?: string;
      name?: string;
      arguments?: unknown;
    };
    if (url.pathname === "/control") {
      if (input.mode === "expire") state.now = state.prepared.expires;
      else state.mode = input.mode ?? "normal";
      send({ ok: true });
      return;
    }
    if (url.pathname === "/rpc") {
      if (input.name === "read_synthetic_review_status") {
        state.statusReads++;
        if (state.mode === "slow-status")
          await new Promise((resolve) => setTimeout(resolve, 1200));
        if (state.mode === "status-error" || state.mode === "unknown-offline") {
          send({ isError: true });
          return;
        }
        send({
          structuredContent: await state.service.status(input.arguments),
        });
        return;
      }
      if (input.name === "commit_synthetic_review") {
        state.commits++;
        if (state.mode === "unknown" || state.mode === "unknown-offline") {
          send({ isError: true });
          return;
        }
        const result = await state.service.commit(input.arguments);
        if (result.accepted) state.accepted++;
        send(
          state.mode === "lost-response"
            ? { dropResponse: true }
            : { structuredContent: result },
        );
        return;
      }
    }
    response.writeHead(404).end();
  } catch {
    response.writeHead(500).end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.info("Synthetic browser harness listening on loopback"),
);
process.on("SIGTERM", () => {
  server.close();
  db.close();
});
