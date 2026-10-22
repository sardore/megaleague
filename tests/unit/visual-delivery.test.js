import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualDelivery, visualDelivery } from '../../src/online/visual-delivery.js';
test('lost action visuals survive a newer empty snapshot and leave only after visual ACK', () => {
  const host = new VisualDelivery('match'), guest = new VisualDelivery('match');
  const first = host.publish(1, [{type:'skillFx'}]);
  const overtaking = {visualBatches:host.publish(2, [])};
  assert.deepEqual(guest.unseen(overtaking),first);
  guest.received.add(first[0].id);
  assert.deepEqual(guest.unseen({visualBatches:first}),[]);
  host.acknowledge([]);
  assert.equal(host.publish(3,[]).length,1);
  host.acknowledge([first[0].id]);
  assert.deepEqual(host.publish(4,[]),[]);
});
test('same-revision publications have distinct visual identities and session state resets', () => {
  const peer = {};
  const d = visualDelivery(peer,'one');
  d.publish(7,[{type:'damage'}]);
  const batches = d.publish(7,[{type:'heal'}]);
  assert.equal(new Set(batches.map(b=>b.id)).size,2);
  assert.equal(visualDelivery(peer,'two').outgoing.size,0);
});
