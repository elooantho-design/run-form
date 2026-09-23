import assert from "node:assert/strict";
import {
  applyPortalCorsHeaders,
  getPortalDiscordActivityOrigin,
  getPortalRequestOriginCheck,
  verifyPortalRequestOrigin,
} from "../api/_portal-auth.js";

const DISCORD_CLIENT_ID = "1552374112159277217";
const originalDiscordClientId = process.env.VITE_DISCORD_CLIENT_ID;
process.env.VITE_DISCORD_CLIENT_ID = DISCORD_CLIENT_ID;

function makeRequest({ method = "POST", url = "/api/portal-auth", headers = {} } = {}) {
  return {
    method,
    url,
    headers,
  };
}

function makeResponseRecorder() {
  const headers = new Map();
  return {
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
  };
}

try {
assert.equal(
  getPortalDiscordActivityOrigin(),
  `https://${DISCORD_CLIENT_ID}.discordsays.com`,
  "Discord Activity origin is derived from the configured Client ID",
);

const sameOrigin = makeRequest({
  headers: {
    origin: "https://run-form-tau.vercel.app",
    host: "run-form-tau.vercel.app",
  },
});
assert.equal(verifyPortalRequestOrigin(sameOrigin), true, "same-origin Vercel requests stay accepted");
assert.equal(getPortalRequestOriginCheck(sameOrigin).reason, "same_origin", "same-origin reason is explicit");

const forwardedSameOrigin = makeRequest({
  headers: {
    origin: "https://run-form-tau.vercel.app",
    host: "internal.vercel.local",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(
  verifyPortalRequestOrigin(forwardedSameOrigin),
  true,
  "x-forwarded-host remains authoritative when present",
);

const discordActivityOrigin = makeRequest({
  headers: {
    origin: `https://${DISCORD_CLIENT_ID}.discordsays.com`,
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(
  verifyPortalRequestOrigin(discordActivityOrigin),
  true,
  "configured Discord Activity origin is accepted against the Vercel API host",
);
assert.equal(
  getPortalRequestOriginCheck(discordActivityOrigin).reason,
  "discord_activity_origin",
  "Discord Activity acceptance reason is explicit",
);

const discordActivityReferer = makeRequest({
  headers: {
    referer: `https://${DISCORD_CLIENT_ID}.discordsays.com/portal?frame_id=f1&instance_id=i1&platform=desktop`,
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(
  verifyPortalRequestOrigin(discordActivityReferer),
  true,
  "configured Discord Activity referer is accepted when Origin is absent",
);

const otherDiscordApp = makeRequest({
  headers: {
    origin: "https://999999999999999999.discordsays.com",
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(verifyPortalRequestOrigin(otherDiscordApp), false, "other Discord apps stay refused");

const suffixSpoof = makeRequest({
  headers: {
    origin: `https://${DISCORD_CLIENT_ID}.discordsays.com.evil.com`,
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(verifyPortalRequestOrigin(suffixSpoof), false, "Discord suffix spoof stays refused");

const subdomainSpoof = makeRequest({
  headers: {
    origin: `https://evil.${DISCORD_CLIENT_ID}.discordsays.com`,
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
  },
});
assert.equal(verifyPortalRequestOrigin(subdomainSpoof), false, "Discord subdomain spoof stays refused");

const externalOrigin = makeRequest({
  headers: {
    origin: "https://evil.example",
    host: "run-form-tau.vercel.app",
  },
});
const externalDiagnostic = getPortalRequestOriginCheck(externalOrigin);
assert.equal(externalDiagnostic.allowed, false, "external origins stay refused");
assert.equal(externalDiagnostic.reason, "host_mismatch", "external origin refusal reason is explicit");
assert.equal(externalDiagnostic.origin, "https://evil.example", "diagnostic includes the rejected origin");
assert.equal(externalDiagnostic.host, "run-form-tau.vercel.app", "diagnostic includes the request host");

const spoofedDiscordKeyword = makeRequest({
  headers: {
    origin: "https://discordsays.com.evil.example",
    host: "run-form-tau.vercel.app",
  },
});
assert.equal(
  verifyPortalRequestOrigin(spoofedDiscordKeyword),
  false,
  "suffix-spoofed Discord-looking origins stay refused",
);

const malformedOrigin = makeRequest({
  headers: {
    origin: "https://",
    host: "run-form-tau.vercel.app",
  },
});
assert.equal(verifyPortalRequestOrigin(malformedOrigin), false, "malformed origins stay refused");
assert.equal(
  getPortalRequestOriginCheck(malformedOrigin).reason,
  "invalid_origin_referer",
  "malformed origin reason is explicit",
);

const safeGet = makeRequest({ method: "GET" });
assert.equal(verifyPortalRequestOrigin(safeGet), true, "safe methods stay accepted");

const productionEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  vercel: process.env.VERCEL,
};
process.env.NODE_ENV = "production";
process.env.VERCEL = "1";
try {
  const missingOrigin = makeRequest({
    headers: {
      host: "run-form-tau.vercel.app",
    },
  });
  assert.equal(
    verifyPortalRequestOrigin(missingOrigin),
    false,
    "production POST without Origin/Referer stays refused",
  );
  assert.equal(
    getPortalRequestOriginCheck(missingOrigin).reason,
    "missing_origin_referer",
    "missing Origin/Referer reason is explicit",
  );
} finally {
  if (productionEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = productionEnvironment.nodeEnv;
  if (productionEnvironment.vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = productionEnvironment.vercel;
}

const diagnostic = getPortalRequestOriginCheck({
  method: "POST",
  url: "/api/portal-auth?action=login&debug=true",
  headers: {
    origin: "https://evil.example",
    referer: "https://evil.example/login",
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "run-form-tau.vercel.app",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "user-agent": "test-agent",
    cookie: "portal_session=secret",
  },
  body: {
    password: "secret",
  },
});
assert.deepEqual(
  Object.keys(diagnostic).sort(),
  [
    "allowed",
    "checkedValueHost",
    "checkedValueOrigin",
    "discordActivityOrigin",
    "forwardedHost",
    "forwardedProto",
    "host",
    "method",
    "origin",
    "path",
    "reason",
    "referer",
    "requestHost",
    "secFetchDest",
    "secFetchMode",
    "secFetchSite",
    "userAgent",
  ].sort(),
  "diagnostic exposes only the approved fields",
);
const serializedDiagnostic = JSON.stringify(diagnostic);
assert.doesNotMatch(serializedDiagnostic, /portal_session|cookie|password|secret|token|body|session/i);
assert.equal(diagnostic.path, "/api/portal-auth", "diagnostic path excludes query string");

const discordCorsResponse = makeResponseRecorder();
applyPortalCorsHeaders(discordActivityOrigin, discordCorsResponse);
assert.equal(
  discordCorsResponse.getHeader("access-control-allow-origin"),
  `https://${DISCORD_CLIENT_ID}.discordsays.com`,
  "CORS echoes the exact configured Discord Activity origin",
);
assert.equal(
  discordCorsResponse.getHeader("access-control-allow-credentials"),
  "true",
  "CORS keeps credentials enabled for the configured Discord Activity origin",
);
assert.equal(discordCorsResponse.getHeader("vary"), "Origin", "CORS keeps Vary: Origin");

const evilCorsResponse = makeResponseRecorder();
applyPortalCorsHeaders(otherDiscordApp, evilCorsResponse);
assert.equal(
  evilCorsResponse.getHeader("access-control-allow-origin"),
  undefined,
  "CORS does not allow another Discord Activity application",
);

const sameOriginCorsResponse = makeResponseRecorder();
applyPortalCorsHeaders(sameOrigin, sameOriginCorsResponse);
assert.equal(
  sameOriginCorsResponse.getHeader("access-control-allow-origin"),
  "https://run-form-tau.vercel.app",
  "same-origin CORS behaviour stays unchanged",
);
} finally {
  if (originalDiscordClientId === undefined) delete process.env.VITE_DISCORD_CLIENT_ID;
  else process.env.VITE_DISCORD_CLIENT_ID = originalDiscordClientId;
}

console.log("portal auth origin diagnostics tests passed");
