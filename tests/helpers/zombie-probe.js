import './combat-online-probe.js';
import * as zc from '../../src/features/zombie-cave.js';
import * as execution from '../../src/engine/execution.js';
import * as combat from '../../src/engine/combat.js';
import * as actions from '../../src/engine/actions.js';
Object.assign(window.probe,{zc,execution,combatRules:combat,actions});
window.zombieFixture=(seed='zc-test',deck=['hermit','mole','boar','mantis'])=>{
  const g=window.__redTimeoraBossRaid.createGame(deck,null,false,{host:null},'zombie');
  g.seed=seed;
  return g;
};
