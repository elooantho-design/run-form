import assert from "node:assert/strict";

import {
  canPortalMemberUseSupport,
  getSupportAmountLimitsCents,
  isPortalSupportLiveMode,
  isPortalSupportPublicEnabled,
} from "../src/lib/portalSupportConfig.js";

assert.equal(isPortalSupportPublicEnabled({}), false);
assert.equal(isPortalSupportPublicEnabled({ PORTAL_SUPPORT_PUBLIC_ENABLED: "false" }), false);
assert.equal(isPortalSupportPublicEnabled({ PORTAL_SUPPORT_PUBLIC_ENABLED: "true" }), true);
assert.equal(isPortalSupportPublicEnabled({ PORTAL_SUPPORT_PUBLIC_ENABLED: "1" }), true);

assert.equal(canPortalMemberUseSupport({ role: "leader" }, {}), true);
assert.equal(canPortalMemberUseSupport({ role: "admin" }, {}), true);
assert.equal(canPortalMemberUseSupport({ role: "member" }, {}), true);
assert.equal(
  canPortalMemberUseSupport({ role: "member" }, { PORTAL_SUPPORT_PUBLIC_ENABLED: "true" }),
  true,
);
assert.equal(canPortalMemberUseSupport(null, { PORTAL_SUPPORT_PUBLIC_ENABLED: "true" }), false);

assert.equal(isPortalSupportLiveMode({ STRIPE_SECRET_KEY: "sk_test_123" }), false);
assert.equal(isPortalSupportLiveMode({ STRIPE_SECRET_KEY: "sk_live_123" }), true);
assert.equal(isPortalSupportLiveMode({}), false);

assert.deepEqual(
  getSupportAmountLimitsCents({
    PORTAL_SUPPORT_MIN_AMOUNT_EUR: "5",
    PORTAL_SUPPORT_MAX_AMOUNT_EUR: "200",
  }),
  { minCents: 500, maxCents: 20000 },
);

console.log("portal-support config tests passed");
