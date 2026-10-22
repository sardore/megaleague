// Visual acknowledgements are independent of canonical state revisions: a
// heartbeat may overtake an action snapshot without consuming its effects.
export class VisualDelivery {
  constructor(matchId) {
    this.matchId = matchId;
    this.serial = 0;
    this.outgoing = new Map();
    this.received = new Set();
  }
  publish(revision, visuals) {
    if (visuals.length) {
      const id = `${this.matchId}:${revision}:${++this.serial}`;
      this.outgoing.set(id, { id, visuals });
    }
    return [...this.outgoing.values()];
  }
  acknowledge(ids = []) {
    for (const id of ids) this.outgoing.delete(id);
  }
  batches(message) {
    return Array.isArray(message.visualBatches) ? message.visualBatches :
      message.visualPacketId ? [{ id: message.visualPacketId, visuals: message.visuals || [] }] : [];
  }
  unseen(message) {
    return this.batches(message).filter(batch => batch?.id && !this.received.has(batch.id));
  }
}
export function visualDelivery(peer, matchId) {
  if (peer.visualDelivery?.matchId !== matchId) peer.visualDelivery = new VisualDelivery(matchId);
  return peer.visualDelivery;
}
