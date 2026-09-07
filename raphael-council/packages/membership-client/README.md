# Operator membership client

Private, server-side client for the existing Davy Jones runtime. This package contains one import-free ES module and has no runtime dependencies. Node 22.16.0 or newer is required. Keep the service credential out of browser bundles, Discord messages and logs.

```js
import { createMembershipClient } from '@operator/membership-client';
const access = createMembershipClient({
  url: 'http://127.0.0.1:38176',
  token: privateMembershipCredential,
});
const runtime = createChronicleRuntimeCore({
  // Supply all other explicit chronicle dependencies from the gateway composition root.
  ...dependencies,
  authorizeCommand: access.authorizeCommand,
});
```

`authorizeCommand({campaign,owner,role})` returns a promise of a boolean. It sends only campaign and owner. The server uses current `GameStore.member({campaign,owner})` and allows only the saved host role. A caller-supplied role never grants access. Configure a campaign allowlist on the server. Discord guild/channel and fresh Discord membership checks remain required in the chronicle adapter.

Version 0.1.1 adds `authorizeParticipant({campaign,owner,role})`, a separate promise of a boolean. It calls `POST /v1/authorize-participant` and sends only campaign and owner. The server checks current saved membership and accepts a host or player; `authorizeCommand` remains host-only. Each call makes a fresh request, so removal or a role change takes effect on the next check. A caller-supplied role is never authority. Participant membership does not grant recording consent, external-processing consent, session/channel access, or AI dispatch permission; the chronicle and voice adapters must enforce those independently before capture/upload and when accepting results.

`status()` returns a promise of a boolean. All operations fail closed on outage, invalid responses, timeout or redirects. Calls have a three-second default deadline, no retries, no cached authorization, a 1024-byte response limit, and accept only a literal `http://127.0.0.1[:port]` origin. Campaign IDs contain 1–64 letters, numbers, underscores or hyphens; owner IDs contain 17–20 digits. The independent service token contains 32–512 non-whitespace printable ASCII bytes.

The service binds a separate loopback port. Keep it outside the public tunnel. It owns no AI policy, does not route models, and never writes game actions. Obus remains the only game AI runtime and provider-routing authority.

Build from the Operator checkout with `npm run build` in this package, then create the local artifact with `npm pack --pack-destination artifacts`. Version 0.1.1 produces `artifacts/operator-membership-client-0.1.1.tgz`; preserve the previously handed-off 0.1.0 archive unchanged. Run `npm test` after packing to verify the old archive digest and install 0.1.1 in a temporary directory outside the checkout using an offline, script-disabled install. The isolated probe checks the package exports, separate authorization routes, fresh membership checks, and denial on invalid responses or outage with controlled transport responses. These tests do not activate a bridge or connect to Discord. Installing the resulting tarball requires no sibling checkout, database access, Discord SDK, provider credentials, or registry publication. The host-side service is supplied separately by Operator's `bridge/host.mjs`; this client does not start it or any other process.
