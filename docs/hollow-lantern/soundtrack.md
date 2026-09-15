# Operation Hollow Lantern soundtrack

Five tracks by Kevin MacLeod were selected for this campaign and downloaded directly from Incompetech on 9 September 2026. The official [catalog](https://incompetech.com/music/royalty-free/pieces.json) confirms their titles, ISRCs and filenames. The artist’s [license page](https://incompetech.com/music/royalty-free/licenses/) offers a free Creative Commons license with attribution and generates Attribution 4.0 credits. The governing license is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| Track | ISRC | Suggested use |
|---|---|---|
| Lord of the Land | USUAN1400022 | Briefing and road travel |
| Darkest Child | USUAN1100783 | Scouting and uncertain rooms |
| Five Armies | USUAN1100875 | Combat |
| Suonatore di Liuto | USUAN1400023 | Quartermaster and recovery |
| Teller of the Tales | USUAN1400020 | Debrief and quiet conversation |

## Credits to keep with the campaign

Music by **Kevin MacLeod — [Incompetech](https://incompetech.com/)**:

- **Lord of the Land**, ISRC USUAN1400022.
- **Darkest Child**, ISRC USUAN1100783.
- **Five Armies**, ISRC USUAN1100875.
- **Suonatore di Liuto**, ISRC USUAN1400023.
- **Teller of the Tales**, ISRC USUAN1400020.

All five recordings are used under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Original audio files are unchanged. Live playback may adjust volume, pause or resume. Keep these credits visible in the campaign information/recap and include them with any recordings or redistributed game packet containing the music. This local document does not itself establish that credits have been published in Discord.

## Local preparation and integration

Verified cache: `C:\Users\Hermes\LocalFiles\hollow-lantern\licensed-audio`. It contains five ISRC-named MP3 files and `manifest.json` with fixed source URLs, SHA-256 hashes, exact sizes, attribution and ffprobe results. All five are stereo 44.1 kHz MP3; each is below 15 MiB. Six tests passed, including real validation of every downloaded track, tampered hashes/sizes, redirects/origins, path traversal, junctions and missing ffprobe.

Run the project’s `raphael-council/hollow-lantern/prepare-soundtrack.mjs` to verify an existing cache or download missing approved tracks. An altered existing file fails; it is never silently replaced. An upstream byte change also fails until the fixed manifest is independently reviewed. Downloads use only exact HTTPS artist paths with redirects disabled and strict size caps. The artist currently returns application/octet-stream; this narrow path accepts it only because the audio’s pinned size/hash and ffprobe validation all succeed. The general AuthorizedAudioResolver remains unchanged.

The Davy module `src/music/licensed-campaign-audio.js` exports `LICENSED_CAMPAIGN_TRACKS`, `LicensedCampaignAudioResolver` and the preparation helper. Configure the resolver with the canonical cache root. `resolve(isrc)` or `resolve(exactCanonicalCachePath)` revalidates the file and returns a local playback path. `resolveTrack({licensedTrackId:isrc,sourceUrl:approvedTrack.url})` additionally checks the exact artist source URL. Preserve `licensedTrackId` in queued campaign track records; do not substitute a temporary playback UUID. A wrapper may route these fixed IDs/paths to this resolver and leave all ordinary music inputs with the existing resolver.

The parent integration must still publish the credits, authorize the selected campaign cue, and use Davy’s existing voice lifecycle. No voice channel was joined, audio played, or deployment changed during preparation. Cue suggestions above do not authorize automatic live playback.
