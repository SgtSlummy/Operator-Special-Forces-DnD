# Saltglass shore arrival illustration

Asset: `saltglass-shore-arrival-v1.png`

SHA-256: `1cd986ed362a1aa059f95f2e06fe3092f4abac8263d5132d7066f7ec84df40aa`

Generated on 2026-09-13 with the built-in image generation tool. This is original 2D scene artwork for the Saltglass opening, before the courier is freed. It is not a scale map, tactical terrain, a camera view from Unity, or evidence of exact room geometry.

Source grounding: `RPG-Core/station/Assets/RpgIntegration/HollowLantern/LanternSaltglass.cs`, particularly `SaltglassObjects`, `InspectSaltglass`, and `SaltglassProjection`. The source establishes the overturned cart, trapped courier, shore location, and public courierFreed state. Coastal colors, weather, clothing, facial appearance and composition are art direction, not additional engine facts. No satchel contents, later locations or undiscovered routes are pictured.

Visual review: one clothed adult courier reaches from beneath a tilted wooden cart on a rocky shore. No text, grid, patrol, shelter, treasure or graphic injury. The central subject occupies much of the landscape frame. Actual phone rendering still requires consumer verification.

Display constraint: use only an authorized Saltglass player scene projection for `saltglass-shore` with an explicit `courierFreed === false`. Do not infer that condition from a missing field. Stop offering this artwork after rescue; preserve the existing fallback. Never bind this image to tactical or dungeon terrain.

Generation prompt:

> Use case: illustration-story. Asset type: atmospheric arrival illustration for Saltglass shore, a fully 2D fantasy Discord game viewed on phones. Create one landscape illustration, no interface or text. Scene: a rocky coastal shore, an overturned wooden courier cart at the center of attention and one adult courier visibly pinned beneath its tilted side, alive, clothed, reaching for help, no blood or graphic injury. The cart and courier must read immediately at small phone width. Ocean and weathered rocks frame the shore; distant geography fades into mist. Style: beautiful hand-painted 2D ink and gouache fantasy adventure art, expressive linework, layered flat shapes, textured brushwork, restrained atmospheric depth; no 3D render, no photorealism, no plastic materials. Composition: medium-wide landscape with central main action large enough to read, no tiny busy decorative details. Muted sea tones, warm weathered wood, subtle light separating the courier from the cart. Constraints: only this opening shore scene, no party heroes, patrols, shelters, buildings, monsters, treasure, magic signals, hidden passages or future locations. No exposed satchel contents; omit the satchel entirely from this arrival framing. No map grid, labels, numbers, UI, writing, border or watermark. This is scene illustration, not a scale tactical map.
