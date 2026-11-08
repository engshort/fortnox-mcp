import { request } from "node:http";

try {
  const origin = new URL(process.env.PUBLIC_ORIGIN ?? "");
  const req = request({ hostname: "127.0.0.1", port: process.env.PORT ?? 3000, path: "/health", headers: { host: origin.host, "x-forwarded-proto": origin.protocol.slice(0, -1) } }, response => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    response.on("end", () => {
      try { process.exit(response.statusCode === 200 && JSON.parse(body).ok === true ? 0 : 1); }
      catch { process.exit(1); }
    });
  });
  req.setTimeout(4000, () => req.destroy());
  req.on("error", () => process.exit(1));
  req.end();
} catch { process.exit(1); }
