import '../../src/main.js';
import * as combat from '../../src/engine/combat.js';
import * as snapshots from '../../src/online/snapshots.js';
import { state_ui_battle_state as battle, visibleDefense } from '../../src/ui/battle-state.js';
import { state_ui_deck as deck } from '../../src/ui/deck.js';
import { state_engine_actions as actions } from '../../src/engine/actions.js';
import { state_online_commands as commands } from '../../src/online/commands.js';
import { serializeOnlineGame, cloneOnlineVisualEvents } from '../../src/online/connection.js';
import { render } from '../../src/ui/payment.js';
import { playVisuals } from '../../src/presentation/animations.js';
import { systems } from '../../src/runtime/systems.js';
import { state_presentation_coordinates as coordinates } from '../../src/presentation/coordinates.js';
import { cloneAndSanitizeOnlineDeck } from '../../src/online/start.js';
import { state_catalog_cards as catalog } from '../../src/catalog/cards.js';
import { timeCommitPendingTurnAdvance } from '../../src/features/timeora.js';
import { afterAction } from '../../src/ui/action-choices.js';
import { effectApply } from '../../src/engine/effects.js';
import { card } from '../../src/engine/entities.js';
import { cardTooltipHTML } from '../../src/ui/cards.js';
import { timeClockMiniHTML } from '../../src/features/timeora.js';
function setupGuest() {
  battle.game = window.Megaleague.newGame(['wayli','hermit','wayli','hermit'], ['wayli','hermit','wayli','hermit'], {mode:'online',seed:'visuals'});
  battle.game.matchId = 'visual-test';
  deck.onlineSide = 'A';
  const sent = [];
  Object.assign(deck.p2p, {role:'guest',matchId:'visual-test',battleStarted:true,lastAuthoritativeRevision:0,
    conn:{open:true,send:packet=>{sent.push(packet);return true;}}});
  let phase = 'IN_BATTLE';
  systems.OnlineRuntime = {
    identity: () => ({phase}),
    sessionScope:{setInterval:()=>1,cancel:()=>true,requestAnimationFrame:callback=>requestAnimationFrame(()=>{if(phase==='IN_BATTLE')callback();})},
    restore:{pending:()=>false,authoritativeApplied:()=>false},
    projection:{request:()=>{render();return true;}},
    markBattleEnded:()=>{phase='TERMINAL';return true;},
  };
  document.querySelector('#setup').classList.remove('active');
  document.querySelector('#game').classList.add('active');
  render();
  return sent;
}
window.probe = { combat, snapshots, battle, deck, actions, commands, systems, render,
  serializeOnlineGame, cloneOnlineVisualEvents, visibleDefense, playVisuals, coordinates,
  setupGuest, cloneAndSanitizeOnlineDeck, catalog, timeCommitPendingTurnAdvance, afterAction, effectApply, card, cardTooltipHTML, timeClockMiniHTML };
