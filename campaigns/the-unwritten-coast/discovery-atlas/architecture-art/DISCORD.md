# Architectural images in Discord

The existing `createDiscordTable` controller now offers Full room, Floor slice and Low cutaway after a recipient opens the known R01 scene. Each button is an opaque, expiring control bound to the requesting Discord user and their current role. The reply contains a PNG attachment, room dimensions, scale, clear cut-plane wording and navigation controls. No messages or threads are created by this integration.

The atlas now paginates all discovered/learned rooms in groups of 20. Previously only the first 25 locations could be selected. Every page is built from the current public projection; selecting a stale room still requires current discovery.

`architecture-art/png.mjs` renders the existing SVG through headless Chrome, correctly decoding its embedded local Stable Diffusion material images and illustrated portraits. Jobs are serialized, with at most four pending jobs. Browser instances close in `finally`; failed jobs do not poison the queue. Network requests are blocked, and the document permits only embedded image data. The local bundled Playwright runtime is used by default; `PLAYWRIGHT_MODULE` can select the host's installed module. Chrome must be installed on that host.

Delivery uses the existing shared projection and final membership/revision checks. It does not pass the raw GM state to the renderer. Architectural controls are hidden during room combat and existing controls refuse to render after combat begins, because enemy overlays still belong to the existing tactical map. This avoids showing an incomplete combat picture.

Verification: `node --test architecture-art/discord.test.mjs table-discord.test.mjs` passes 22 tests, including complete atlas pagination, recipient-bound controls, chosen image attachment, discovery/revision/membership revocation, combat guard, recovery after a failed rendering job, and an actual 1600×1200 PNG. The image was visually inspected at `qa/architecture/discord-cutaway.png`; its character position comes from an isolated test fixture. Interaction tests use a fake Discord client and do not prove a live Discord installation.

Live status: the available Discord browser tab displayed “Discord App Launched” rather than the conversation, and no Discord connector tools were available. No live publication, gateway restart, authentication configuration or thread provisioning occurred in this pass. The goal remains open for actual gateway/Activity integration, private thread topology, further art and end-to-end verification.
