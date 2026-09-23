import assert from "node:assert/strict";
import {
  getPortalRequestOriginCheck,
  verifyPortalRequestOrigin,
} from "../api/_portal-auth.js";

function makeRequest({ method = "POST", url = "/api/portal-auth", headers = {} } = {}) {
  return {
    method,
    url,
    headers,
  };
}

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

const spoofedDiscord = makeRequest({
  headers: {
    origin: "https://discordsays.com.evil.example",
    host: "run-form-tau.vercel.app",
  },
});
assert.equal(
  verifyPortalRequestOrigin(spoofedDiscord),
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

console.log("portal auth origin diagnostics tests passed");
