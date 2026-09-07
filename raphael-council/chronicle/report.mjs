import { createCanvas, loadImage } from '@napi-rs/canvas';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function thumbnail(bytes, width = 640) {
  const image = await loadImage(bytes);
  const ratio = Math.min(1, width / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { bytes: await canvas.encode('jpeg', 65), width: canvas.width, height: canvas.height };
}
export async function makeReport({ session, recap, chapters, entries, imageBytes }) {
  const scenes = entries.filter(e => e.kind === 'image');
  const gallery = [];
  for (const entry of scenes) {
    try {
      const thumb = await thumbnail(await imageBytes(entry), 640);
      gallery.push(`<figure><img width="${thumb.width}" height="${thumb.height}" alt="${escapeHtml(entry.title)}" src="data:image/jpeg;base64,${thumb.bytes.toString('base64')}"><figcaption>[E${entry.seq}] ${escapeHtml(entry.title)} · scene E${entry.scene} · illustration, not additional story evidence</figcaption></figure>`);
    } catch { gallery.push(`<p>[E${entry.seq}] ${escapeHtml(entry.title)} — image unavailable in this export.</p>`); }
  }
  const transcript = entries.map(e => `<article id="e${e.seq}"><small>[E${e.seq}] [${escapeHtml(e.kind.toUpperCase())}] ${escapeHtml(new Date(e.at).toISOString())}${e.speaker ? ` · ${escapeHtml(e.speaker)}` : ''}${e.target ? ` · corrects E${e.target}` : ''}</small><p>${escapeHtml(e.text ?? e.title ?? '')}</p></article>`).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escapeHtml(session.title)} · Session chronicle</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;background:#f5eedf;color:#28231b;font:17px/1.6 Georgia,serif}h1,h2{line-height:1.2;color:#634319}p{white-space:pre-wrap}small{font:13px/1.5 system-ui}figure{margin:24px 0;break-inside:avoid}img{max-width:100%;height:auto;border-radius:6px}figcaption{font:14px/1.5 system-ui;color:#625641}article{border-top:1px solid #cfbea2;padding:12px 0}summary{cursor:pointer;font-weight:bold}@media print{body{background:white;margin:0;max-width:none}details{display:block}summary{display:none}}</style><h1>${escapeHtml(session.title)}</h1><small>Session ${escapeHtml(session.id)} · ${escapeHtml(new Date(session.started).toISOString())} · ${escapeHtml(session.mode)} DM</small><p>AI-assisted story recap. Speech recognition is unverified; corrections below take precedence. The captured record may contain gaps. DM drafts are excluded.</p><h2>The story</h2><p>${escapeHtml(recap)}</p><h2>Chronological chapters</h2>${chapters.map(c => `<p>${escapeHtml(c)}</p>`).join('')}<h2>Scenes</h2>${gallery.join('')}<details><summary>Searchable source record and corrections</summary>${transcript}</details></html>`;
}
