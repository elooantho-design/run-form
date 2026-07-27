import assert from "node:assert/strict";
import {
  assertSafeRemoteUrl,
  default as creatorLinkIconHandler,
  extractFaviconCandidates,
  fetchCreatorLinkFavicon,
  isPrivateIpAddress,
  readResponseBuffer,
} from "../api/creator-link-icon.js";

function imageResponse(contentType = "image/png", body = new Uint8Array([1, 2, 3])) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function redirectResponse(location) {
  return new Response("", {
    status: 302,
    headers: { location },
  });
}

function makeResolver(address = "93.184.216.34") {
  return async () => [{ address, family: address.includes(":") ? 6 : 4 }];
}

function makeResponseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

assert.equal(isPrivateIpAddress("127.0.0.1"), true);
assert.equal(isPrivateIpAddress("10.0.0.5"), true);
assert.equal(isPrivateIpAddress("172.16.0.5"), true);
assert.equal(isPrivateIpAddress("192.168.1.5"), true);
assert.equal(isPrivateIpAddress("169.254.169.254"), true);
assert.equal(isPrivateIpAddress("93.184.216.34"), false);
assert.equal(isPrivateIpAddress("::1"), true);
assert.equal(isPrivateIpAddress("[::1]"), true);
assert.equal(isPrivateIpAddress("fc00::1"), true);

await assert.rejects(() => assertSafeRemoteUrl("ftp://example.com", { resolveDns: makeResolver() }), /Protocole/);
await assert.rejects(() => assertSafeRemoteUrl("http://127.0.0.1", { resolveDns: makeResolver() }), /privee/);
await assert.rejects(() => assertSafeRemoteUrl("http://[::1]/", { resolveDns: makeResolver() }), /privee/);
await assert.rejects(
  () => assertSafeRemoteUrl("https://example.com", { resolveDns: makeResolver("192.168.1.10") }),
  /privee/,
);

await assert.rejects(
  () =>
    readResponseBuffer(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-length": "999999" },
      }),
      10,
    ),
  /volumineuse/,
);

{
  const res = makeResponseRecorder();
  await creatorLinkIconHandler({ method: "POST", query: { url: "https://example.com" } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
}

{
  const res = makeResponseRecorder();
  await creatorLinkIconHandler({ method: "GET", query: { url: `https://example.com/${"a".repeat(2050)}` } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "url_too_long" });
}

assert.deepEqual(
  extractFaviconCandidates(
    '<html><head><link rel="icon" href="/icon.png"><link rel="apple-touch-icon" href="https://cdn.example.com/apple.png"></head></html>',
    "https://example.com/page",
  ),
  ["https://example.com/icon.png", "https://cdn.example.com/apple.png"],
);

{
  const requestedUrls = [];
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/page")) {
        return htmlResponse('<link rel="icon" href="/assets/favicon.png">');
      }
      return imageResponse();
    },
  });

  assert.equal(favicon.contentType, "image/png");
  assert.deepEqual(requestedUrls, ["https://example.com/page", "https://example.com/assets/favicon.png"]);
}

{
  const requestedUrls = [];
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/page")) {
        return htmlResponse("<html><head></head><body>No icon</body></html>");
      }
      return imageResponse("image/x-icon");
    },
  });

  assert.equal(favicon.contentType, "image/x-icon");
  assert.deepEqual(requestedUrls, ["https://example.com/page", "https://example.com/favicon.ico"]);
}

{
  const requestedUrls = [];
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith("/page")) {
        return htmlResponse('<link rel="icon" href="/redirect-private.png">');
      }
      return redirectResponse("http://127.0.0.1/private.png");
    },
  });

  assert.equal(favicon, null);
  assert.deepEqual(requestedUrls, [
    "https://example.com/page",
    "https://example.com/redirect-private.png",
    "https://example.com/favicon.ico",
  ]);
  assert.equal(requestedUrls.some((url) => url.includes("127.0.0.1")), false);
}

{
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async () => new Response("bad", { status: 200, headers: { "content-type": "text/plain" } }),
  });

  assert.equal(favicon, null);
}

{
  const bigBody = new Uint8Array(300 * 1024).fill(1);
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async (url) => {
      if (String(url).endsWith("/page")) return htmlResponse('<link rel="icon" href="/big.png">');
      return imageResponse("image/png", bigBody);
    },
  });

  assert.equal(favicon, null);
}

{
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async (url) => {
      if (String(url).includes("hop4")) return imageResponse();
      const current = Number(String(url).match(/hop(\d+)/)?.[1] || 0);
      return redirectResponse(`https://example.com/hop${current + 1}`);
    },
  });

  assert.equal(favicon, null);
}

{
  const favicon = await fetchCreatorLinkFavicon("https://example.com/page", {
    resolveDns: makeResolver(),
    fetchImpl: async () => {
      throw new Error("timeout");
    },
  });

  assert.equal(favicon, null);
}

console.log("creator link icon route validation ok");
