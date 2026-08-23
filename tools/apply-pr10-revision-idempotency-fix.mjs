import fs from 'node:fs';

const file = 'index.html';
const source = fs.readFileSync(file, 'utf8');
const before = `        const currentRevision=Math.max(Number(onlineAuthoritativeRevision||0),Number(game.networkRevision||0));
        onlineAuthoritativeRevision=force?currentRevision:currentRevision+1;
        game.networkRevision = onlineAuthoritativeRevision;
        const revision = onlineAuthoritativeRevision;`;
const after = `        const currentRevision=Math.max(Number(onlineAuthoritativeRevision||0),Number(game.networkRevision||0));
        // A publication attempt is not a canonical mutation. Re-sending an unchanged PVP
        // snapshot (sync probe, duplicate action request, reconnect, reliable retry) must reuse
        // the already committed revision instead of manufacturing another revision.
        const previousReliableState=!bossOnline&&p2p?.__reliableStatePacket?.state?p2p.__reliableStatePacket:null;
        const currentCanonicalState=!bossOnline?serializeOnlineGame():null;
        const sameCanonicalState=!!previousReliableState
          && String(previousReliableState.matchId||\"\")===String(onlineCurrentMatchId()||\"\")
          && onlineSnapshotEquivalentForInput(currentCanonicalState,previousReliableState.state);
        const nextRevision=sameCanonicalState
          ? Number(previousReliableState.revision||currentRevision)
          : (force?currentRevision:currentRevision+1);
        onlineAuthoritativeRevision=Math.max(0,nextRevision);
        game.networkRevision = onlineAuthoritativeRevision;
        const revision = onlineAuthoritativeRevision;`;

const beforeCount = source.split(before).length - 1;
const afterCount = source.split(after).length - 1;
if (afterCount === 1 && beforeCount === 0) {
  console.log('revision idempotency fix already applied');
  process.exit(0);
}
if (beforeCount !== 1 || afterCount !== 0) {
  throw new Error(`REVISION_PATCH_ANCHOR_MISMATCH before=${beforeCount} after=${afterCount}`);
}
const patched = source.replace(before, after);
if (patched === source) throw new Error('REVISION_PATCH_NO_CHANGE');
fs.writeFileSync(file, patched);
console.log('applied publication/revision idempotency fix');
