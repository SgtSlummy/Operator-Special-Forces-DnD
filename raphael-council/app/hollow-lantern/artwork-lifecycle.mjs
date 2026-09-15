// Tokens rotate on every poll. They belong in the request URL, not React's key.
// A changed authorization scope or revision must create a fresh image element.
export function artworkIdentity(view, level, kind) {
  return JSON.stringify([view.campaignId, view.viewer, view.audience,
    view.selectedActor, view.sceneId, view.revision, level, kind]);
}

export function artworkLoaded(event) { event.currentTarget.hidden = false; }
export function artworkFailed(event) { event.currentTarget.hidden = true; }
