import { state_catalog_cards } from '../catalog/cards.js';
import { applyStatus, damageRange, dealDamage, nonAttackDamage, queueVisual, teamOf } from '../engine/combat.js';
import { addHpProtectionBarrier, setAttack, setDefense } from '../engine/effects.js';
import { aliveUnits, costGap, initializeDeployment } from '../engine/energy.js';
import { RNG, card, freshOnceUseState, makeUnit, registerRuntimeSkillContainer } from '../engine/entities.js';
import { revealUnit } from '../engine/execution.js';
import { log, queueCombatNotice } from '../presentation/audio.js';
import { state_ui_cards } from '../ui/cards.js';

/*
 * 좀비굴: 좀비가 끝없이 쏟아지는 협동 던전. 목표는 최대한 깊은 층.
 *
 * 규칙은 전부 이 모듈 한 곳에 있다.
 * - 한 지역(깊이 1칸)에서 나오는 좀비는 정해진 마리 수뿐이다. 깊을수록 마리 수가 늘고 좀비가 훨씬 강해진다.
 * - 적 필드 한 칸이 비면 그 칸에 입장 카운트다운(라운드 단위)이 생기고, 0이 되면 다음 좀비가 들어온다. 마리 수를 다 채우면 더는 오지 않는다.
 * - 지역의 좀비를 모두 처치하면 적 두 칸이 돌벽 문이 된다. 문 하나가 다음 지형 하나이고, 하나를 고르면 새 지역이 시작된다.
 * - 좀비는 자기 차례를 RAGE_AFTER_TURNS번 넘기면 그때부터 매 자기 차례 끝마다 공격력이 RAGE_STEP씩 오른다.
 *   쉬운 좀비 하나만 살려 두고 버티는 플레이를 막는다.
 * - "능력치 초기화" 좀비는 아군의 공격·방어 상승분을 지운다. 능력치 쌓기로 격노를 버티는 플레이를 막는다.
 * 규칙 호출 지점은 execution.js(턴 종료·승패)와 boss-raid.js(사망 처리)뿐이다.
 */
export const ZOMBIE_CAVE = Object.freeze({
  kind: 'zombie',
  rageAfterTurns: 10,
  rageStep: 10,
  /* 층이 깊을수록 빈 칸이 빨리 채워진다. */
  respawnRounds: depth => Math.max(1, 2 - Math.floor((Math.max(1, depth) - 1) / 6)),
  /* 지역 하나를 넘길 때마다 급격히 강해진다. */
  hpScale: depth => 1 + 0.3 * (Math.max(1, depth) - 1),
  attackScale: depth => 15 * (Math.max(1, depth) - 1),
  /* 한 지역에서 나오는 좀비 수. 깊을수록 많다. */
  zoneSize: depth => Math.min(12, 3 + Math.max(1, depth)),
  /* 표·등급 해금에 쓰는 위험도. 지역 하나가 예전 두 단계에 해당한다. */
  danger: depth => 2 * Math.max(1, depth) - 1,
  /* 3층부터 일부 좀비가 특수 강화를 달고 나온다. 깊을수록 자주. */
  affixChance: depth => depth < 3 ? 0 : Math.min(0.8, 0.2 + 0.08 * depth)
});

const Z_KIND = 'zombie';

/* 쓰러진 좀비의 재입장까지 라운드. 바리케이드 보상은 그 지역 동안 늘린다. */
const respawnDelay = cave => ZOMBIE_CAVE.respawnRounds(cave.depth) + BARRICADE_ROUNDS * Number(cave.boons?.barricade || 0);
const BARRICADE_ROUNDS = 2;
const TORCH_RAGE_TURNS = 4;

export function isZombieCave(g) {
  return g?.bossRaid?.kind === Z_KIND;
}
export function zombieCaveState(g) {
  return isZombieCave(g) ? g.bossRaid.cave : null;
}

/* ---------------------------------------------------------------- 카드 정의 */

const ZOMBIE_TABLE = [];
const PLAYABLE_ROW = 'zc_playable';
const PLAYABLE_PREFIX = 'zp:';
const ZOMBIE_CARDS = [];

/* 입장 표: from(첫 등장 층), weight(뽑힐 비중). weight는 깊이를 받아 층마다 달라질 수 있다. */
function zombie(id, name, hp, role, trait, skills, extra = {}, spawn = {}) {
  const { C } = state_catalog_cards;
  const def = C(id, name, hp, role, '좀비굴', trait, skills, {
    grade: '2☆',
    league: 'zombie',
    maxEnergy: 4,
    hiddenUntilRevealed: false,
    ...extra,
    tags: ['zombie', ...(extra.tags || [])]
  });
  ZOMBIE_CARDS.push(def);
  ZOMBIE_TABLE.push({ id, from: spawn.from ?? 1, weight: spawn.weight ?? 6 });
  return def;
}

function defineZombies() {
  const { S } = state_catalog_cards;
  const hit = (id, name, cost, desc, effects, tags = ['damage'], extra = {}) => S(id, name, cost, desc, 'enemy', effects, tags, extra);
  const self = (id, name, cost, desc, effects, tags, extra = {}) => S(id, name, cost, desc, 'self', effects, tags, extra);
  const area = (id, name, cost, desc, effects, tags, extra = {}) => S(id, name, cost, desc, 'enemyField', effects, tags, extra);

  zombie('zc_walker', '워커', 70, '무리 근접', '없음. 끝없이 몰려오는 기본 좀비.', [
    hit('zc_bite', '물어뜯기', '*', '30D.', [{ type: 'damage', amount: 30 }])
  ], {}, { from: 1, weight: 10 });

  zombie('zc_runner', '러너', 50, '속공 다단', '없음. 체력은 낮지만 연속 타격으로 몰아친다.', [
    hit('zc_claws', '연속할퀴기', '*', '20D씩 2회.', [{ type: 'damage', amount: 20, hits: 2 }], ['damage', 'multi']),
    hit('zc_frenzy', '광란', '***', '20D씩 5회.', [{ type: 'damage', amount: 20, hits: 5 }], ['damage', 'multi'])
  ], { speed: 1 }, { from: 1, weight: 8 });

  zombie('zc_hound', '좀비견', 60, '다단 사냥', '없음. 물고 놓지 않는다.', [
    hit('zc_maul', '물어찢기', '**', '20D씩 3회.', [{ type: 'damage', amount: 20, hits: 3 }], ['damage', 'multi']),
    self('zc_growl', '으르렁', '*', '자신 공격 +10.', [{ type: 'attackMod', target: 'self', amount: 10 }], ['buff'])
  ], { speed: 1 }, { from: 2, weight: 6 });

  zombie('zc_rotter', '부패자', 110, '독 살포', '없음. 닿은 곳이 썩어 든다.', [
    hit('zc_rotspit', '썩은침', '**', '40D. 독 3턴.', [{ type: 'damage', amount: 40 }, { type: 'status', status: 'poison', duration: 3 }], ['damage', 'status']),
    hit('zc_meltdown', '녹아내림', 'B***', '대상 현재 HP의 30% 피해. 방어와 피해 난수를 적용하지 않는다.', [{ type: 'proportionalDamage', basis: 'current', ratio: 0.3 }], ['damage', 'proportional']),
    hit('zc_rotbreath', '썩은숨', '*', '10D. 대상 언데드 2턴.', [{ type: 'damage', amount: 10 }, { type: 'status', status: 'undead', duration: 2 }], ['damage', 'status'], { aiProfile: { kind: 'zombieCave', mode: 'undeadFoe' } }),
    hit('zc_rotburst', '부패 폭발', 'B***', '80D. 독 4턴.', [{ type: 'damage', amount: 80 }, { type: 'status', status: 'poison', duration: 4 }], ['damage', 'status'])
  ], {}, { from: 3, weight: 7 });

  zombie('zc_shield', '방패 좀비', 100, '방벽 근접', '실드 60으로 시작한다.', [
    hit('zc_bash', '방패치기', '**', '60D.', [{ type: 'damage', amount: 60 }]),
    self('zc_wall', '방벽', 'W**', '자신에게 HP 보호막 90(턴마다 30 감소).', [{ type: 'hpBarrier', amount: 90, decayPerTurn: 30 }], ['shield']),
    self('zc_brace', '버티기', '*', '다음 두 공격 타격의 피해를 각각 30 감소(최대 2회).', [{ type: 'nextHitReduction', amount: 30, hits: 2 }], ['shield']),
    self('zc_fortress', '철옹성', 'W***', '자신에게 HP 보호막 180(턴마다 30 감소).', [{ type: 'hpBarrier', amount: 180, decayPerTurn: 30 }], ['shield'])
  ], { shield: 60, baseDefense: 10, grade: '3☆' }, { from: 4, weight: 6 });

  zombie('zc_spitter', '스피터', 80, '산성 약화', '없음. 맞은 자의 방어를 녹인다.', [
    hit('zc_acid', '산성침', '**', '40D. 방어 -20.', [{ type: 'damage', amount: 40 }, { type: 'defenseMod', amount: -20 }], ['damage', 'debuff']),
    area('zc_acidrain', '산성비', 'B***', '적 전체 50D. 방어 -20.', [{ type: 'zFieldHit', amount: 50, defense: -20 }], ['damage', 'debuff', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } })
  ], {}, { from: 5, weight: 6 });

  zombie('zc_brute', '브루트', 210, '중장갑 탱커', '방어 15로 시작한다.', [
    hit('zc_slam', '내려찍기', 'R**', '100D.', [{ type: 'damage', amount: 100 }]),
    self('zc_roar', '포효', '*', '자신 방어 +10(최대 50).', [{ type: 'selfDefense', amount: 10, max: 50 }], ['buff']),
    hit('zc_earthsplit', '대지가르기', 'RR**', '130D.', [{ type: 'damage', amount: 130 }])
  ], { baseDefense: 20, grade: '3☆', speed: -1 }, { from: 6, weight: 6 });

  zombie('zc_ghoul', '구울', 120, '포식·성장', '없음. 먹을수록 강해진다.', [
    self('zc_feast', '시체포식', '**', '자신 HP 50 회복, 공격 +10.', [{ type: 'selfHeal', amount: 50 }, { type: 'attackMod', target: 'self', amount: 10 }], ['heal', 'buff']),
    hit('zc_rend', '찢기', 'R**', '70D.', [{ type: 'damage', amount: 70 }]),
    self('zc_rise', '일어나라', '**', '자신 언데드 2턴(HP가 0이 되어도 죽지 않는다). 자신 HP 60 회복, 공격 +10.', [{ type: 'zStatus', scope: 'self', status: 'undead', duration: 2 }, { type: 'selfHeal', amount: 60 }, { type: 'attackMod', target: 'self', amount: 10 }], ['status', 'heal', 'buff'], { aiProfile: { kind: 'zombieCave', mode: 'undeadSelf' } }),
    self('zc_gorge2', '대식', 'B***', '자신 HP 80 회복, 공격 +20.', [{ type: 'selfHeal', amount: 80 }, { type: 'attackMod', target: 'self', amount: 20 }], ['heal', 'buff'])
  ], { grade: '3☆' }, { from: 4, weight: 5 });

  zombie('zc_bloater', '자폭 좀비', 80, '죽음의 폭발', '죽으면 폭발해 적 필드 전체에 40 피해를 준다.', [
    hit('zc_burstblow', '터지는 일격', '**', '50D.', [{ type: 'damage', amount: 50 }]),
    hit('zc_suicide', '몸통박치기', 'R***', '70D. 가한 피해만큼 자신도 받는다.', [{ type: 'damage', amount: 70, recoilFraction: 1 }], ['damage']),
    hit('zc_pyre', '연쇄폭발', 'R***', '100D. 가한 피해의 절반을 자신도 받는다.', [{ type: 'damage', amount: 100, recoilFraction: 0.5 }], ['damage'])
  ], { deathBurst: 40 }, { from: 5, weight: 6 });

  zombie('zc_wight', '망각의 사제', 110, '능력치 초기화', '없음. 쌓아 올린 힘을 지운다.', [
    hit('zc_oblivion', '망각', '**', '40D. 대상의 공격·방어 상승분을 전부 초기화.', [{ type: 'damage', amount: 40 }, { type: 'zStatReset', scope: 'target' }], ['damage', 'debuff'], { aiProfile: { kind: 'zombieCave', mode: 'reset' } }),
    hit('zc_mark', '사자의 낙인', '*', '대상 언데드 3턴(회복이 피해로 바뀐다).', [{ type: 'status', status: 'undead', duration: 3 }], ['status'], { aiProfile: { kind: 'zombieCave', mode: 'undeadFoe' } }),
    hit('zc_doomcall', '죽음의 선고', 'B***', '40D. 특성봉인 3턴, 대상 언데드 3턴.', [{ type: 'damage', amount: 40 }, { type: 'status', status: 'traitSeal', duration: 3 }, { type: 'status', status: 'undead', duration: 3 }], ['damage', 'status'])
  ], { grade: '3☆' }, { from: 5, weight: 5 });

  zombie('zc_carrier', '보균자', 90, '에너지 오염', '없음. 에너지를 갉아먹는다.', [
    hit('zc_contagion', '오염', '**', '40D. 대상 에너지 1개 제거.', [{ type: 'damage', amount: 40 }, { type: 'removeEnergy', amount: 1 }], ['damage', 'energy']),
    hit('zc_drought', '고갈', 'B**', '대상의 에너지를 전부 제거.', [{ type: 'removeAllEnergy' }], ['energy']),
    hit('zc_outbreak', '감염 폭발', 'B***', '60D. 대상 에너지 2개 제거.', [{ type: 'damage', amount: 60 }, { type: 'removeEnergy', amount: 2 }], ['damage', 'energy'])
  ], {}, { from: 6, weight: 5 });

  zombie('zc_howler', '하울러', 85, '공격 고취', '없음. 울부짖음이 무리를 광폭하게 만든다.', [
    self('zc_howl', '괴성', '*', '필드의 좀비 전원 공격 +10.', [{ type: 'zRally', attack: 10 }], ['buff', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'rally' } }),
    area('zc_shriek', '초음파', 'W**', '적 전체 40D. 감속 1턴.', [{ type: 'zFieldHit', amount: 40, status: 'slow', duration: 1 }], ['damage', 'status', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } }),
    self('zc_warcry', '전쟁 함성', 'W***', '필드의 좀비 전원 공격 +30.', [{ type: 'zRally', attack: 30 }], ['buff', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'rally' } })
  ], { grade: '3☆' }, { from: 7, weight: 5 });

  zombie('zc_stalker', '스토커', 90, '암습 치명', '없음. 약한 곳만 노린다.', [
    hit('zc_ambush', '암습', '**', '80D. 33% 크리티컬.', [{ type: 'damage', amount: 80, crit: 0.33 }]),
    hit('zc_lurk', '잠복', 'B**', '1턴간 무적 후 120D.', [{ type: 'delayedAttack', amount: 120, invulnerable: true }], ['damage', 'scheduled']),
    hit('zc_deathblow', '급소 찌르기', 'RB**', '120D. 50% 크리티컬.', [{ type: 'damage', amount: 120, crit: 0.5 }])
  ], { crit: 0.33, grade: '3☆' , speed: 1 }, { from: 7, weight: 5 });

  zombie('zc_necro', '네크로맨서', 130, '방벽·회복 봉인', '없음. 죽음을 다루는 자.', [
    self('zc_wardead', '사자의 방벽', '**', '필드의 좀비 전원에게 HP 보호막 60(턴마다 20 감소).', [{ type: 'zBarrier', amount: 60, decay: 20 }], ['shield', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'barrier' } }),
    self('zc_march', '죽은 자의 행진', 'B***', '필드의 좀비 전원 언데드 2턴, 공격 +20.', [{ type: 'zStatus', scope: 'field', status: 'undead', duration: 2 }, { type: 'zRally', attack: 20 }], ['status', 'buff', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'undeadSelf' } }),
    hit('zc_touch', '죽음의 손길', '**', '70D. 회복봉인 3턴.', [{ type: 'damage', amount: 70 }, { type: 'status', status: 'healSeal', duration: 3 }], ['damage', 'status']),
    self('zc_raise', '대규모 부활의식', 'BB**', '필드의 좀비 전원 HP 보호막 100(턴마다 20 감소).', [{ type: 'zBarrier', amount: 100, decay: 20 }], ['shield', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'barrier' } })
  ], { grade: '3☆' }, { from: 8, weight: 4 });

  zombie('zc_juggernaut', '거인', 320, '초중량 광역', '방어 25로 시작한다.', [
    hit('zc_crush', '분쇄', 'R***', '140D.', [{ type: 'damage', amount: 140 }]),
    area('zc_tremor', '땅울림', 'R**', '적 전체 60D.', [{ type: 'zFieldHit', amount: 60 }], ['damage', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } }),
    self('zc_unyield', '불굴', '**', '자신 언데드 2턴(HP가 0이 되어도 죽지 않는다). 자신 방어 +10(최대 50), HP 보호막 90(턴마다 30 감소).', [{ type: 'zStatus', scope: 'self', status: 'undead', duration: 2 }, { type: 'selfDefense', amount: 10, max: 50 }, { type: 'hpBarrier', amount: 90, decayPerTurn: 30 }], ['status', 'shield', 'buff'], { aiProfile: { kind: 'zombieCave', mode: 'undeadSelf' } }),
    area('zc_quake', '대지진', 'RR**', '적 전체 80D.', [{ type: 'zFieldHit', amount: 80 }], ['damage', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } })
  ], { baseDefense: 30, grade: '4☆', speed: -1 }, { from: 8, weight: 4 });

  zombie('zc_hexer', '침묵의 현자', 120, '광역 능력치 초기화', '없음. 전장 전체의 힘을 지운다.', [
    area('zc_silence', '전장의 침묵', 'B***', '적 필드 전체의 공격·방어 상승분을 전부 초기화.', [{ type: 'zStatReset', scope: 'field' }], ['debuff', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'reset' } }),
    hit('zc_hex', '흑마법', '**', '50D. 특성봉인 2턴.', [{ type: 'damage', amount: 50 }, { type: 'status', status: 'traitSeal', duration: 2 }], ['damage', 'status']),
    hit('zc_doom', '파멸의 주문', 'BB**', '70D. 특성봉인 3턴, 방어 -20.', [{ type: 'damage', amount: 70 }, { type: 'status', status: 'traitSeal', duration: 3 }, { type: 'defenseMod', amount: -20 }], ['damage', 'status', 'debuff'])
  ], { grade: '4☆' }, { from: 10, weight: 4 });

  zombie('zc_leech', '흡혈 좀비', 90, '흡혈 지속', '없음. 물어뜯으며 회복한다.', [
    hit('zc_drain', '흡혈', '**', '50D. 자신 HP 40 회복.', [{ type: 'damage', amount: 50 }, { type: 'selfHeal', amount: 40 }], ['damage', 'heal']),
    hit('zc_gorge', '포식 난타', 'R**', '30D씩 3회. 자신 HP 20 회복.', [{ type: 'damage', amount: 30, hits: 3 }, { type: 'selfHeal', amount: 20 }], ['damage', 'multi', 'heal']),
    hit('zc_bloodfeast', '피의 연회', 'R***', '30D씩 3회. 자신 HP 50 회복.', [{ type: 'damage', amount: 30, hits: 3 }, { type: 'selfHeal', amount: 50 }], ['damage', 'multi', 'heal'])
  ], {}, { from: 4, weight: 5 });

  zombie('zc_shocker', '감전 좀비', 85, '마비 제어', '없음. 닿으면 몸이 굳는다.', [
    hit('zc_jolt', '감전', '**', '40D. 마비 1턴.', [{ type: 'damage', amount: 40 }, { type: 'status', status: 'paralyze', duration: 1 }], ['damage', 'status']),
    area('zc_arc', '방전', 'W***', '적 전체 50D. 마비 1턴.', [{ type: 'zFieldHit', amount: 50, status: 'paralyze', duration: 1 }], ['damage', 'status', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } }),
    area('zc_storm', '뇌우', 'WW**', '적 전체 50D. 마비 1턴.', [{ type: 'zFieldHit', amount: 50, status: 'paralyze', duration: 1 }], ['damage', 'status', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } })
  ], { grade: '3☆' , speed: 1 }, { from: 6, weight: 5 });

  zombie('zc_butcher', '도살자', 170, '광폭 처형', '없음. 피를 볼수록 날뛴다.', [
    hit('zc_cleave', '난도질', '**', '40D. 자신 공격 +10.', [{ type: 'damage', amount: 40 }, { type: 'attackMod', target: 'self', amount: 10 }], ['damage', 'buff']),
    hit('zc_execute', '도축', 'R***', '120D.', [{ type: 'damage', amount: 120 }]),
    hit('zc_massacre', '대학살', 'RR**', '40D씩 4회.', [{ type: 'damage', amount: 40, hits: 4 }], ['damage', 'multi'])
  ], { grade: '3☆' }, { from: 5, weight: 5 });

  zombie('zc_plaguelord', '역병의 왕', 150, '광역 중독', '없음. 숨결이 곧 역병이다.', [
    area('zc_blight', '대역병', 'B**', '적 전체 40D. 독 3턴.', [{ type: 'zFieldHit', amount: 40, status: 'poison', duration: 3 }], ['damage', 'status', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } }),
    hit('zc_festerbite', '부패의 이빨', '**', '70D. 독 2턴, 언데드 2턴.', [{ type: 'damage', amount: 70 }, { type: 'status', status: 'poison', duration: 2 }, { type: 'status', status: 'undead', duration: 2 }], ['damage', 'status']),
    area('zc_pestilence', '종말의 역병', 'BB**', '적 전체 40D. 독 4턴.', [{ type: 'zFieldHit', amount: 40, status: 'poison', duration: 4 }], ['damage', 'status', 'field'], { aiProfile: { kind: 'zombieCave', mode: 'field' } })
  ], { grade: '4☆' }, { from: 7, weight: 4 });

  /* 웰러는 이미 있는 카드를 그대로 쓴다. 후반 층에서만 나오고, 깊을수록 자주 나온다. */
  /* 플레이어블 캐릭터가 좀비가 되어 나온다. 어떤 캐릭터인지는 입장 때 정한다. */
  ZOMBIE_TABLE.push({ id: PLAYABLE_ROW, from: 3, weight: level => Math.min(60, 14 + level * 2.2) });
  ZOMBIE_TABLE.push({ id: 'weller', from: 10, weight: level => Math.min(12, 5 + (level - 10) * 0.5) });

  const emoji = {
    zc_walker: ['🧟'], zc_runner: ['🧟‍♂️', '💨'], zc_hound: ['🐕', '🦴'], zc_rotter: ['🤢'],
    zc_shield: ['🧟', '🛡️'], zc_spitter: ['🧪'], zc_brute: ['🦍'], zc_ghoul: ['👹'],
    zc_bloater: ['🎈', '💥'], zc_wight: ['💀', '🕯️'], zc_carrier: ['🦠'], zc_howler: ['😱'],
    zc_stalker: ['🥷', '🧟'], zc_leech: ['🧛'], zc_shocker: ['⚡', '🧟'], zc_butcher: ['🪓'], zc_plaguelord: ['☣️', '👑'], zc_necro: ['☠️'], zc_juggernaut: ['🗿'], zc_hexer: ['🔮', '💀']
  };
  Object.assign(state_ui_cards.CARD_EMOJI_MAP, emoji);
}

export function initializeFeaturesZombieCave() {
  defineZombies();
  registerRuntimeSkillContainer(ZOMBIE_CARDS);
}

export function zombieCaveCards() {
  return ZOMBIE_CARDS;
}

/* ---------------------------------------------------------------- 지역 */

/* 지역: 입장하는 좀비의 구성과 배경 색이 달라진다. */
export const ZOMBIE_REGIONS = Object.freeze({
  graveyard: { phase: 'early', name: '공동묘지', hue: 0, rgb: '143,227,106', blurb: '묻힌 자들이 깨어난다. 식시귀와 사제가 많다.', ids: ['zc_walker', 'zc_ghoul', 'zc_wight', 'zc_necro', 'zc_hound'], playables: ['hermit','mole','mushroom','sandcastle','bush','phantomMuner','heroncaptain','yggdrasil','iceknight','dragonfish'] },
  sewer: { phase: 'early', name: '하수도', hue: 300, rgb: '196,206,70', blurb: '독과 역병이 고여 있다. 중독과 폭발을 조심.', ids: ['zc_rotter', 'zc_spitter', 'zc_plaguelord', 'zc_carrier', 'zc_bloater'], playables: ['snail','frog','axshrimp','snakeArmor','tube','jetski','aquamarine','thornJellyfish','helmetShark','sweetna','toxious','shuvi','abigate','eterna'] },
  hospital: { phase: 'early', name: '폐병원', hue: 100, rgb: '96,176,255', blurb: '회복과 마비가 뒤섞인 병동.', ids: ['zc_leech', 'zc_ghoul', 'zc_shocker', 'zc_necro', 'zc_hexer'], playables: ['sunflower','bee','tail','frost','cherryberry','iruma','flameflower','silvrae','turtle','elixian','horizintal','lunari','angel'] },
  slaughter: { phase: 'late', name: '도살장', hue: 240, rgb: '255,96,104', blurb: '피 냄새를 쫓는 사냥꾼과 거구들.', ids: ['zc_butcher', 'zc_brute', 'zc_stalker', 'zc_runner', 'zc_hound'], playables: ['boar','birdKnight','mantis','fang','hawk','bkeno','wayli','ruby','huve','grange','galewing','megaWing','kingprawn'] },
  lab: { phase: 'late', name: '연구소', hue: 160, rgb: '190,124,255', blurb: '실험체의 전기와 광역 기술.', ids: ['zc_shocker', 'zc_hexer', 'zc_howler', 'zc_juggernaut', 'zc_bloater'], playables: ['chameleon','cloud','ember','circuit','magSnail','foxious','jungles','master','awakenedIruma','stareel','flappis'] }
});
export function zombieRegionInfo(key) {
  const r = ZOMBIE_REGIONS[key];
  if (!r) return null;
  const names = r.ids.map(id => ZOMBIE_CARDS.find(c => c.id === id)?.name).filter(Boolean);
  return { ...r, zombies: names };
}
/* 이웃 지형: 묘지-하수도-도살장-연구소-폐병원-묘지 순환. 문은 지금 지형이거나 이웃 지형으로만 열린다. */
const REGION_RING = ['graveyard', 'sewer', 'slaughter', 'lab', 'hospital'];
const regionNeighbors = key => {
  const i = REGION_RING.indexOf(key);
  return [REGION_RING[(i + 4) % 5], REGION_RING[(i + 1) % 5]];
};
/* 다음 지형 두 곳(문 두 개). 시드와 깊이로만 정해서 온라인에서도 같다. */
/* 초반형 지역(묘지·하수도·폐병원)은 얕은 층에서 자주, 후반형 지역(도살장·연구소)은 깊은 층에서 자주 문으로 나온다. */
export const regionDoorWeight = (key, depth) => {
  const d = Math.max(1, depth) - 1;
  return ZOMBIE_REGIONS[key].phase === 'late' ? Math.min(4, 0.5 + 0.4 * d) : Math.max(0.3, 3 - 0.35 * d);
};
export function zombieCaveDoorRegions(g) {
  const cave = g.bossRaid.cave,
    rng = new RNG(`${g.seed}:zc-door:${cave.depth}`),
    pool = [cave.region || 'graveyard', ...regionNeighbors(cave.region || 'graveyard')];
  return [0, 1].map(() => {
    let roll = rng.next() * pool.reduce((n, key) => n + regionDoorWeight(key, cave.depth + 1), 0),
      at = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= regionDoorWeight(pool[i], cave.depth + 1);
      if (roll <= 0) {
        at = i;
        break;
      }
    }
    return pool.splice(at, 1)[0];
  });
}

/* ---------------------------------------------------------------- 던전 상태 */

const foeField = (g, t) => (g.teams[t === 'A' ? 'P' : 'A'].field || []).filter(u => u && !u.dead);
const ownField = (g, t) => (g.teams[t].field || []).filter(u => u && !u.dead);

/* 새 판의 적 진영을 비우고 던전 상태를 만든 뒤 처음 두 좀비를 입장시킨다. */
export function zombieCaveSetup(g) {
  const A = g.teams.A;
  A.field = A.field.map(() => null);
  A.bench = [];
  A.graveyard = [];
  g.revealed.A = [];
  g.bossRaid.kind = Z_KIND;
  g.bossRaid.bossId = 'zombie-cave';
  g.bossRaid.cave = { depth: 1, kills: 0, serial: 0, timers: A.field.map(() => null), bestDepth: 1, region: 'graveyard', zoneSize: ZOMBIE_CAVE.zoneSize(1), spawned: 0, cleared: false, boons: { torch: 0, barricade: 0 }, nextBoons: { torch: 0, barricade: 0 } };
  g.matchType = '좀비굴';
  spawnZombie(g, 0, 'zc_walker');
  spawnZombie(g, 1, 'zc_walker');
  return g;
}

function tableWeight(row, depth) {
  const level = ZOMBIE_CAVE.danger(depth),
    w = typeof row.weight === 'function' ? row.weight(level) : row.weight;
  /* 초반 잡졸은 깊어질수록 줄고, 위험한 좀비일수록 지역을 넘길 때마다 더 자주 나온다. */
  if (row.id === 'zc_walker') return Math.max(1, w - level / 2);
  return w * (1 + (Math.max(1, row.from) - 1) / 9 * (depth - 1) * 0.5);
}

/* 좀비가 될 수 있는 플레이어블: 이미 좀비이거나 시간 계열·이차원 침입자는 뺀다. 깊을수록 높은 등급이 섞인다.
   4.5☆는 일반 입장에 섞이지 않고, 문턱 깊이부터 지역의 마지막 적(보스)으로만 나온다. */
const playableGate = depth => depth < 2 ? 2 : depth < 3 ? 3 : depth < 4 ? 3.5 : depth < 6 ? 4 : 4.5;
const BOSS_GRADE = 4.5;
const gradeOf = c => Number.parseFloat(String(c.grade));
const playableBase = () => state_catalog_cards.CARDS.filter(c => !c.tags?.includes('zombie') && !c.tags?.includes('transdimensional-invader') && c.id !== 'timeora' && c.id !== 'red_timeora');
const playablePool = depth => playableBase().filter(c => gradeOf(c) <= playableGate(depth) && gradeOf(c) < BOSS_GRADE);
/* 지역 테마: 지역에 배정된 캐릭터는 3배, 나머지는 0.35배로 뽑힌다. */
const playableRegionWeight = (c, region) => !region ? 1 : region.playables.includes(c.id) ? 3 : 0.35;
const bossReady = depth => playableGate(depth) >= BOSS_GRADE;
function pickBossCard(g, cave) {
  const rng = new RNG(`${g.seed}:zc-boss:${cave.serial}`),
    all = playableBase().filter(c => gradeOf(c) >= BOSS_GRADE),
    themed = all.filter(c => ZOMBIE_REGIONS[cave.region]?.playables.includes(c.id));
  return rng.pick(themed.length ? themed : all);
}

/* 지역의 대표 좀비는 조금 일찍 나온다. */
const unlockLevel = (row, regionKey) => ZOMBIE_REGIONS[regionKey]?.ids.includes(row.id) ? Math.max(1, row.from - 3) : row.from;

/* 다음 좀비. g.rng를 건드리지 않고 (시드, 입장 번호)로 정해서 시뮬레이션·온라인 복원에도 결과가 같다. */
export function pickZombieId(g) {
  const cave = g.bossRaid.cave,
    depth = cave.depth,
    rng = new RNG(`${g.seed}:zc:${cave.serial}`),
    onField = g.teams.A.field.filter(u => u && !u.dead).map(u => u.card),
    resetOnField = onField.some(id => id === 'zc_wight' || id === 'zc_hexer');
  const rows = ZOMBIE_TABLE.filter(row => ZOMBIE_CAVE.danger(depth) >= unlockLevel(row, cave.region)).map(row => {
    let w = tableWeight(row, depth);
    const region = ZOMBIE_REGIONS[cave.region];
    if (region && row.id.startsWith('zc_') && row.id !== PLAYABLE_ROW) w *= region.ids.includes(row.id) ? 3 : 0.35;
    if (onField.includes(row.id)) w *= 0.35;
    if (resetOnField && (row.id === 'zc_wight' || row.id === 'zc_hexer')) w = 0;
    return { id: row.id, w: Math.max(0, w) };
  }).filter(row => row.w > 0);
  let roll = rng.next() * rows.reduce((n, row) => n + row.w, 0),
    picked = rows.at(-1).id;
  for (const row of rows) {
    roll -= row.w;
    if (roll <= 0) {
      picked = row.id;
      break;
    }
  }
  if (picked !== PLAYABLE_ROW) return picked;
  const pool = playablePool(depth).filter(c => !onField.includes(c.id)).map(c => ({ c, w: playableRegionWeight(c, ZOMBIE_REGIONS[cave.region]) }));
  if (!pool.length) return 'zc_walker';
  let pr = rng.next() * pool.reduce((n, e) => n + e.w, 0);
  for (const e of pool) {
    pr -= e.w;
    if (pr <= 0) return PLAYABLE_PREFIX + e.c.id;
  }
  return PLAYABLE_PREFIX + pool.at(-1).c.id;
}

function makeZombie(g, id, boss = false) {
  const cave = g.bossRaid.cave,
    depth = cave.depth,
    zombified = id.startsWith(PLAYABLE_PREFIX),
    z = makeUnit(zombified ? id.slice(PLAYABLE_PREFIX.length) : id, `zc${++cave.serial}`),
    hp = Math.max(10, Math.round(card(z).maxHp * ZOMBIE_CAVE.hpScale(depth) * (boss ? 2 : 1) / 10) * 10);
  if (zombified) {
    z.zombified = true;
    z.name = `좀비 ${z.name}`;
  }
  z.maxHp = hp;
  z.hp = hp;
  z.turnEndHp = hp;
  z.attackMod = Number(z.attackMod || 0) + ZOMBIE_CAVE.attackScale(depth);
  z.zcBaseAttack = z.attackMod;
  z.zcRage = 0;
  z.spawnDepth = depth;
  const torch = Number(cave.boons?.torch || 0);
  if (torch) z.zcRageAfter = ZOMBIE_CAVE.rageAfterTurns + TORCH_RAGE_TURNS * torch;
  if (boss) z.zcBoss = true;
  else if (!torch) applyAffix(g, z, depth);
  return z;
}

/* 특수 강화: 같은 좀비도 매번 다르게 움직이도록 입장 때 (시드, 입장 번호)로 정한다. */
const AFFIXES = Object.freeze({
  plated: { name: '중갑', title: '실드를 두르고 입장한다.' },
  berserk: { name: '광폭', title: '공격력이 높고 6턴 생존하면 격노가 시작된다.' },
  regen: { name: '재생', title: '자기 차례가 끝날 때마다 HP를 회복한다.' }
});
function applyAffix(g, z, depth) {
  const rng = new RNG(`${g.seed}:zc-affix:${z.uid}`),
    roll = rng.next();
  if (roll >= ZOMBIE_CAVE.affixChance(depth)) return;
  const key = rng.pick(Object.keys(AFFIXES));
  z.zcAffix = key;
  if (key === 'plated') z.shield = Number(z.shield || 0) + 10 * Math.round((30 + 8 * depth) / 10);
  if (key === 'berserk') {
    z.attackMod += 20;
    z.zcBaseAttack = z.attackMod;
    z.zcRageAfter = 6;
  }
}

export function spawnZombie(g, slot, forcedId = null) {
  const cave = g.bossRaid.cave,
    field = g.teams.A.field,
    occupant = field[slot];
  if (occupant && !occupant.dead) return null;
  if (occupant?.dead) g.teams.A.graveyard.push(occupant);
  const boss = !forcedId && bossReady(cave.depth) && cave.spawned === cave.zoneSize - 1,
    id = forcedId || (boss ? PLAYABLE_PREFIX + pickBossCard(g, cave).id : pickZombieId(g)),
    z = makeZombie(g, id, boss);
  field[slot] = z;
  cave.timers[slot] = null;
  cave.spawned++;
  initializeDeployment(g, z);
  revealUnit(g, 'A', z);
  log(g, `지하 ${cave.depth}층 · ${z.name} 입장 (슬롯 ${slot + 1}).`, 'turn');
  queueVisual(g, { type: 'zombieSpawnFx', uid: z.uid, slot });
  return z;
}

/* 입장 카운트다운. 빈 칸이 아니면 null. */
export function zombieCaveSlotInfo(g, team, slot) {
  if (!isZombieCave(g) || team !== 'A') return null;
  const due = g.bossRaid.cave.timers[slot];
  if (due == null) return null;
  return { remaining: Math.max(0, due - g.round), rounds: respawnDelay(g.bossRaid.cave) };
}

/* checkWinner 자리: 라운드가 지나 입장 시간이 된 칸을 채우고, 승패는 아군 전멸로만 정한다. */
export function zombieCaveCheckWinner(g) {
  if (g.winner === 'P' || g.winner === 'A') return;
  const cave = g.bossRaid.cave;
  cave.timers.forEach((due, slot) => {
    if (due != null && g.round >= due && cave.spawned < cave.zoneSize) spawnZombie(g, slot);
  });
  if (!aliveUnits(g.teams.P).length) {
    g.winner = 'A';
    cave.bestDepth = Math.max(cave.bestDepth || 1, cave.depth);
    log(g, `좀비굴 탐험 종료 · 지하 ${cave.depth}층, 처치 ${cave.kills}.`, 'turn');
  }
}

/* 좀비 사망. 지역의 좀비를 모두 처치했으면 true(보상과 문 선택 발생). */
export function zombieCaveUnitDefeated(g, u) {
  const cave = g.bossRaid.cave;
  if (!cave || teamOf(g, u) !== 'A') return false;
  const slot = g.teams.A.field.findIndex(x => x?.uid === u.uid);
  cave.kills++;
  if (slot >= 0 && cave.timers[slot] == null && cave.spawned < cave.zoneSize) {
    cave.timers[slot] = g.round + respawnDelay(cave);
    log(g, `${u.name} 처치 · 슬롯 ${slot + 1} 입장까지 ${respawnDelay(cave)}라운드.`, 'turn');
  }
  const burst = Number(card(u).deathBurst || 0);
  if (burst > 0) {
    queueVisual(g, { type: 'zombieBurstFx', uid: u.uid });
    for (const victim of foeField(g, 'A')) nonAttackDamage(g, victim, burst, `${u.name} 폭발`);
  }
  if (cave.cleared || cave.spawned < cave.zoneSize || foeField(g, 'P').length || !aliveUnits(g.teams.P).length) return false;
  cave.cleared = true;
  cave.timers = cave.timers.map(() => null);
  log(g, `지하 ${cave.depth}층 정리 · 처치 ${cave.kills}. 문이 열린다.`, 'turn');
  return true;
}

/* 층을 넘을 때 아군을 HP만 빼고 전부 되돌린다: 상태이상·기술봉인·깎인 공방, 한 번만 쓰는 기술의 사용 기록.
   보호막은 카드의 기본값까지 다시 채운다(더 많이 쌓여 있으면 그대로). 에너지, HP, 쓰러진 아군은 그대로다. */
export function zombieCaveRestoreParty(g) {
  for (const u of aliveUnits(g.teams.P)) {
    const hadStatus = Object.keys(u.statuses || {}).length + Object.keys(u.skillSeals || {}).length > 0;
    u.statuses = {};
    u.statusAppliedTurnSerial = {};
    u.skillSeals = {};
    if (Number(u.attackMod) < 0) setAttack(g, u, -Number(u.attackMod));
    if (Number(u.defenseMod) < 0) setDefense(g, u, -Number(u.defenseMod));
    Object.assign(u, freshOnceUseState(card(u)));
    u.shield = Math.max(Number(u.shield || 0), Number(card(u).shield || 0));
    if (hadStatus) queueCombatNotice(g, u, '상태 회복', 'cure');
    queueCombatNotice(g, u, '기술 재충전', 'cure');
  }
  log(g, '층을 넘으며 HP를 제외한 상태, 보호막, 한 번만 쓰는 기술이 회복됨.', 'turn');
}

/* 문을 골라 새 지역에 들어선다: 깊이가 오르고, 정해진 마리 수가 새로 채워지며 두 칸에 좀비가 입장한다. */
export function zombieCaveEnterZone(g, region) {
  const cave = g.bossRaid.cave;
  cave.depth++;
  cave.bestDepth = Math.max(cave.bestDepth || 1, cave.depth);
  cave.region = region;
  cave.zoneSize = ZOMBIE_CAVE.zoneSize(cave.depth);
  cave.spawned = 0;
  cave.cleared = false;
  cave.timers = g.teams.A.field.map(() => null);
  cave.boons = { torch: 0, barricade: 0, ...cave.nextBoons };
  cave.nextBoons = { torch: 0, barricade: 0 };
  zombieCaveRestoreParty(g);
  log(g, `${ZOMBIE_REGIONS[region].name} 진입 · 지하 ${cave.depth}층.`, 'turn');
  g.teams.A.field.forEach((_, slot) => spawnZombie(g, slot));
}

/* 칸 하나의 문 상태. 지역을 정리했을 때만 있다. open은 문 선택이 열린 뒤. */
export function zombieCaveDoorInfo(g, team, slot) {
  if (!isZombieCave(g) || team !== 'A' || !g.bossRaid.cave.cleared) return null;
  const q = g.pendingTraitChoices?.find(x => x.door),
    option = q?.options?.[slot] || null;
  return { open: !!q && g.pendingTraitChoices[0] === q, serial: q?.serial || 0, option, index: slot };
}

/* 좀비의 자기 차례가 끝날 때(execution.endTurn): 생존 턴이 차면 공격력이 계속 오른다. */
export function zombieCaveOwnTurnEnded(g, t, u) {
  if (!isZombieCave(g) || t !== 'A' || !u || u.dead) return;
  if (u.zcAffix === 'regen' && u.hp < u.maxHp) {
    const heal = 10 * (1 + Math.floor(Number(u.spawnDepth || 1) / 3));
    u.hp = Math.min(u.maxHp, u.hp + heal);
    log(g, `${u.name}: 재생 · HP ${heal} 회복.`, 'heal');
  }
  if (Number(u.turns || 0) < rageAfterOf(u)) return;
  u.attackMod = Number(u.attackMod || 0) + ZOMBIE_CAVE.rageStep;
  u.zcRage = Number(u.zcRage || 0) + ZOMBIE_CAVE.rageStep;
  log(g, `${u.name}: ${u.turns}턴 생존 · 격노 공격 +${ZOMBIE_CAVE.rageStep} (누적 +${u.zcRage}).`, 'turn');
  queueCombatNotice(g, u, `격노 +${u.zcRage}`, 'effect');
}

/* 보상(횃불 보급, 바리케이드): 보상을 고를 때는 필드에 좀비가 없으므로 다음 지역에 적용한다. */
export function zombieCaveAddBoon(g, kind) {
  const cave = g.bossRaid.cave;
  cave.nextBoons ||= { torch: 0, barricade: 0 };
  cave.nextBoons[kind] = Number(cave.nextBoons[kind] || 0) + 1;
}

/* 카드 위에 보여 줄 생존·격노 뱃지. */
const rageAfterOf = u => Number(u?.zcRageAfter || ZOMBIE_CAVE.rageAfterTurns);
export function zombieCaveAffixBadge(g, u) {
  if (isZombieCave(g) && u?.zcBoss && !u.dead) return { text: '보스', kind: 'zombie-affix', title: '이 지역의 마지막 적. HP가 두 배다.' };
  const info = AFFIXES[u?.zcAffix];
  if (!isZombieCave(g) || !info || u.dead) return null;
  return { text: info.name, kind: 'zombie-affix', title: `${info.name}: ${info.title}` };
}
export function zombieCaveBadge(g, u) {
  if (!isZombieCave(g) || !u || u.dead || teamOf(g, u) !== 'A') return null;
  const turns = Number(u.turns || 0),
    need = rageAfterOf(u);
  if (turns >= need) return { text: `격노 +${Number(u.zcRage || 0)}`, kind: 'zombie-rage', title: `${turns}턴 생존: 자기 차례마다 공격력 +${ZOMBIE_CAVE.rageStep}` };
  return { text: `생존 ${turns}/${need}`, kind: 'zombie-clock', title: `${need}턴 생존하면 매 차례 공격력이 ${ZOMBIE_CAVE.rageStep}씩 오릅니다.` };
}

/* ---------------------------------------------------------------- 효과 */

/* 아군의 공격·방어 "상승분"만 지운다. 감소분(디버프)은 그대로 둔다. */
export function resetStatBoosts(g, victim) {
  const attack = Math.max(0, Number(victim.attackMod || 0)),
    defense = Math.max(0, Number(victim.defenseMod || 0));
  if (!attack && !defense) return 0;
  if (attack) victim.attackMod = Number(victim.attackMod || 0) - attack;
  if (defense) {
    victim.defenseMod = Number(victim.defenseMod || 0) - defense;
    victim.defense = victim.baseDefense + victim.defenseMod;
  }
  log(g, `${victim.name}: 능력치 초기화 · 공격 -${attack}, 방어 -${defense}.`);
  queueCombatNotice(g, victim, '능력치 초기화', 'debuff');
  return attack + defense;
}

export function applyZombieEffect(g, actor, target, e, skill, ctx = {}) {
  const t = ctx.team ?? teamOf(g, actor) ?? 'A';
  switch (e.type) {
    case 'zFieldHit': {
      let total = 0;
      for (const victim of foeField(g, t)) {
        if (e.amount) total += dealDamage(g, actor, victim, { amount: e.amount }, skill, !!ctx.sim);
        if (victim.dead) continue;
        if (e.status) applyStatus(g, victim, e.status, e.duration, actor);
        if (e.defense) setDefense(g, victim, e.defense);
      }
      return total;
    }
    case 'zStatReset': {
      const victims = e.scope === 'field' ? foeField(g, t) : [target].filter(x => x && !x.dead);
      return victims.reduce((n, victim) => n + resetStatBoosts(g, victim), 0);
    }
    case 'zRally': {
      for (const ally of ownField(g, t)) setAttack(g, ally, e.attack);
      return e.attack;
    }
    case 'zStatus': {
      const who = e.scope === 'field' ? ownField(g, t) : [actor];
      for (const z of who) applyStatus(g, z, e.status, e.duration, actor);
      return who.length;
    }
    case 'zBarrier': {
      let total = 0;
      for (const ally of ownField(g, t)) total += addHpProtectionBarrier(g, ally, e.amount, actor.uid, 'standard', { decayPerTurn: e.decay });
      return total;
    }
  }
  return 0;
}

/* aiProfile {kind:'zombieCave', mode}를 쓰는 기술의 AI 점수. 새 효과는 기본 휴리스틱이 모르기 때문에 여기서 가치를 매긴다. */
/* 좀비의 행동 고르기: 죽을 것 같지 않으면 싼 기술만 쓰지 않고, 더 센 기술을 쓰거나 에너지를 모아 센 기술을 노린다.
   기본 점수는 일반 AI가 매기고(score), 여기서는 그 결과를 코스트 관점에서 다듬는다. */
const costSize = cost => String(cost || '').replace(/[^RWB*]/g, '').length;
export function zombieCaveRefineChoice(g, t, s, chosen, acts, score) {
  const u = g.teams[t]?.field[s];
  if (!chosen || !u || t !== 'A' || chosen.type !== 'skill' || u.hp <= u.maxHp * 0.4) return chosen;
  const skillOf = a => card(u).skills.find(k => k.id === a.skill),
    sizeOf = a => costSize(a.costOverride ?? skillOf(a)?.cost),
    mine = sizeOf(chosen),
    base = score(chosen),
    floor = base - Math.abs(base) * 0.4,
    better = acts.filter(a => a.type === 'skill' && sizeOf(a) > mine).map(a => ({ a, sc: score(a) })).filter(x => x.sc >= floor).sort((x, y) => y.sc - x.sc)[0];
  if (better) return better.a;
  if (mine > 1) return chosen;
  const castable = new Set(acts.filter(a => a.type === 'skill').map(a => a.skill)),
    gather = acts.find(a => a.type === 'gather'),
    saving = card(u).skills.some(k => costSize(k.cost) >= 2 && costSize(k.cost) <= 4 && !castable.has(k.id) && costGap(u, k.cost) <= 2);
  return saving && gather ? gather : chosen;
}

export function zombieSkillAiScore({ g, u, tar, skill, profile }) {
  const t = teamOf(g, u) || 'A',
    foes = foeField(g, t),
    friends = ownField(g, t);
  switch (profile?.mode) {
    case 'field': {
      const fx = skill.effects.find(x => x.type === 'zFieldHit') || {};
      const damage = foes.reduce((n, v) => n + (fx.amount ? damageRange(g, u, v, { amount: fx.amount }, skill).mean : 0), 0);
      return damage + foes.length * ((fx.defense ? 16 : 0) + (fx.status ? 14 : 0)) - 12;
    }
    case 'reset': {
      const fx = skill.effects.find(x => x.type === 'zStatReset') || {},
        victims = fx.scope === 'field' ? foes : [tar].filter(Boolean),
        value = victims.reduce((n, v) => n + Math.max(0, Number(v.attackMod || 0)) * 3 + Math.max(0, Number(v.defenseMod || 0)) * 4, 0);
      return value > 0 ? value + 60 : -300;
    }
    case 'rally': {
      const fresh = friends.filter(z => Number(z.attackMod || 0) - Number(z.zcBaseAttack || 0) < 36).length;
      return fresh * 28 - 10;
    }
    case 'undeadSelf': {
      const fx = skill.effects.find(x => x.type === 'zStatus') || {},
        who = fx.scope === 'field' ? friends : [u],
        weak = who.filter(z => !(z.statuses?.undead > 0) && z.hp < z.maxHp * 0.55);
      return weak.length * 90 - 30;
    }
    case 'undeadFoe':
      return tar && !(tar.statuses?.undead > 0) ? 45 : -300;
    case 'barrier': {
      const bare = friends.filter(z => !(z.hpProtectionBarriers || []).length).length;
      return bare * 45 - 10;
    }
  }
  return 0;
}
