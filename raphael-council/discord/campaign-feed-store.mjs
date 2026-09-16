import { DatabaseSync } from 'node:sqlite';
import { createCampaignFeed } from './campaign-feed-contract.mjs';

const encode = feed => JSON.stringify({ ...feed, checks: [...feed.checks.entries()], mapNames: [...feed.mapNames.entries()] });
const decode = value => { const raw = JSON.parse(value); raw.checks = new Map(raw.checks); raw.mapNames = new Map(raw.mapNames); return raw; };

export class CampaignFeedStore {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS campaign_feeds (campaign_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);');
  }
  close() { this.db.close(); }
  read(campaignId) { const row = this.db.prepare('SELECT payload FROM campaign_feeds WHERE campaign_id=?').get(campaignId); return row ? decode(row.payload) : null; }
  create(campaignId, options = {}) {
    const feed = createCampaignFeed({ campaignId, ...options });
    this.db.prepare('INSERT OR IGNORE INTO campaign_feeds(campaign_id, revision, payload) VALUES (?, ?, ?)').run(campaignId, feed.revision, encode(feed));
    return this.read(campaignId);
  }
  write(feed, expectedRevision = feed.revision - 1) {
    const current = this.read(feed.campaignId);
    if (!current) {
      if (expectedRevision !== feed.revision) return { saved: false, reason: 'STALE_REVISION', feed: null };
      const inserted = this.db.prepare('INSERT OR IGNORE INTO campaign_feeds(campaign_id, revision, payload) VALUES (?, ?, ?)').run(feed.campaignId, feed.revision, encode(feed));
      if (!Number(inserted.changes)) return { saved: false, reason: 'STALE_REVISION', feed: this.read(feed.campaignId) };
      return { saved: true, feed };
    }
    const updated = this.db.prepare('UPDATE campaign_feeds SET revision=?, payload=? WHERE campaign_id=? AND revision=?').run(feed.revision, encode(feed), feed.campaignId, expectedRevision);
    if (!Number(updated.changes)) return { saved: false, reason: 'STALE_REVISION', feed: this.read(feed.campaignId) };
    return { saved: true, feed };
  }
}
