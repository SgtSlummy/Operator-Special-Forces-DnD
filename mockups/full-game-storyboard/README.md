# Raphael — Behind the Veil storyboard

Open **presentation.html** for the complete 30-slide presentation. All artwork and presentation controls are embedded, so this file can be copied elsewhere and opened offline in a browser.

Local preview: http://localhost:4186/presentation.html

## Viewing

- Left/right arrows, Page Up/Page Down, or Space move between slides. Home/End jump to the first/last slide.
- **All 30 slides** opens the complete episode index.
- **Enlarge screen** expands the mockup for reading small interface details. Scroll within its center or chronicle column to see longer content.
- **Full screen** enters the browser’s presentation mode.
- Source-reference buttons open the underlying story evidence.
- **Download presentation** saves the self-contained HTML presentation. **Try this screen** opens the interactive prototype; that optional companion link requires the surrounding folder or running local preview.

## Other deliverables

- `index.html`: interactive Admin, DM and Player walkthrough, storyboard board, searchable chronicle and recap.
- `storyboard.html`: all 30 frames in a printable landscape document. Enable background graphics when printing.
- `recap.html`: self-contained illustrated session recap, with smaller JPEG scene images and expandable source records.

## Start or rebuild

From this directory, run `node server.mjs`, then open the local preview above. The server listens only on 127.0.0.1 and serves this mockup folder.

`node build.mjs` rebuilds optimized artwork, the printable storyboard and portable recap using the existing project's canvas dependency. `node build-presentation.mjs` rebuilds the presentation and its script hash. `node --test storyboard.test.mjs` checks coverage, role separation, sources, corrections, image sizes and export content.

## Demonstration boundaries

The episode is illustrative, with fixed sample dialogue, outcomes and dice. Every requested storyboard frame is present. The interactive walkthrough provides local rehearsals; the presentation shows those screens as exhibits and links to the walkthrough for interactive controls. No microphone, Discord transport, model provider or live campaign is connected. Private DM notes are present in this design artifact for the DM slides; this is not a production authentication boundary.

Original Witnesslight campaign art is reused. The shore illustration is explicitly labeled an earlier establishing view after the courier rescue. Corrections preserve “Morrow” as the original recognition and “Mara” as the confirmed name. The final recap includes the entire sample session and acknowledges the speech gap.

The earlier experimental chronicle agent modules are separate from this presentation and remain outside its completion claim.
