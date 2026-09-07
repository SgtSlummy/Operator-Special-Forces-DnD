# Forge character interface: observed reference and adaptation

Observed September 6, 2026, from the user-supplied [Forge website](https://forge-vtt.com/). This records visible behavior, not recovered backend code or a complete Foundry implementation.

## Source evidence

The public home page's **Discover → Live Demo** link led to [the demo description](https://forge-vtt.com/demo), then the public Forge demo launch and `https://demo.forge-vtt.com/join`. The site explicitly provides the demo player access key. The demo had zero connected players before inspection. A public demo player session reached `https://demo.forge-vtt.com/game`; the join page identified Foundry Version 10 Build 291. No private campaign credential was requested or used.

The observed interface has a map/canvas in the center, a left tool palette and a right sidebar. The sidebar's Actors tab has `data-tab="actors"`. Opening its Hero folder reveals a character portrait and name. Clicking the character-name anchor opened its sheet; clicking only the thumbnail did not open it in the tested state.

The sheet is a floating 720 × 680 window at the observed desktop viewport. Its header includes a portrait, name and resource/stat summary. Its navigation has Attributes, Inventory, Features, Spellbook, Effects and Biography. The Attributes, Inventory and Spellbook states were visually inspected. The Inventory state groups equipment in rows; the Spellbook groups entries by spell level. No sheet values were edited and no dice, item-use or rest actions were invoked.

The window has a dark frame, parchment body and Signika text. DOM styles, tab identities and window bounds were read from the visible sheet. The public home-page extraction using pinned `design-extract` revision `f9e0c4770a78b3d99733b77e097da9d13b029aef` completed with `html_observed` coverage in `C:/Users/Hermes/.agent-reach/evidence/raph/forge-character-reference-2026-09-06`. That automated extraction covers the home page only; the authenticated public-demo observations above came from browser interaction.

## Companion adaptation

| Observed feature / user requirement | Raphael implementation |
| --- | --- |
| Character directory opens a floating sheet | Accessible character buttons open an inspector over the existing tactical table. |
| Portrait and quick statistics | Use an honest initials token where no player portrait is supplied; display authorized live encounter statistics. |
| Tabbed information groups | Organize the shared approved/live display groups in a responsive sheet. Preserve the Witnesslight palette and existing typefaces. |
| Map remains underneath | Keep map, target selection, movement and other required controls available. |
| Discord remains required | Discord gets the same character groups and notes through private paginated cards and buttons. |
| Static image where Discord cannot provide a canvas | Preserve authenticated map PNGs and offer controls/text for character details, effects, rolls and revision history. |

No Forge logo, demo portrait, character data, rules code, proprietary font or background art is copied into the player UI. The user requested the interaction pattern and a working campaign companion; matching all of Forge/Foundry's features, editing mechanics or visual pixels is not claimed. Unconfigured player data is labeled rather than fabricated, and private information stays private in both interfaces.
