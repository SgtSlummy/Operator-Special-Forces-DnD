export function runtimeFixture() {
  return { contract: 'raph-obus-game-runtime-v1', bootEpoch: '11111111-1111-4111-8111-111111111111',
    generation: '22222222-2222-4222-8222-222222222222', sessionPolicyRevision: 0, leaseExpiresAtMs: Date.now() + 30000 };
}
export function speechFixture(store, id, owner, requestId, captureEpoch = store.privacy(id, owner).captureEpoch) {
  return { captureEpoch, authorizeParticipant: async () => true,
    context: { scope: { campaign: store.get(id).campaign, owner, role: 'player' }, session: id, requestId,
      capturedRuntime: runtimeFixture(), capturedConsentEpoch: captureEpoch } };
}
