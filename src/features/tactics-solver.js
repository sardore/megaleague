/* 전술 퍼즐 솔버.
   퍼즐의 정답은 "플레이어가 앞으로 k수 안에, 적이 어떻게 응수하든 승리를 강제할 수 있는가"로 정의한다.
   - 플레이어 차례는 OR(하나라도 이기면 정답), 적 차례는 AND(적의 모든 합법 행동을 이겨야 한다).
   - 에너지는 사전배열에서 순서대로 나오므로 우연이 없다(g.puzzle.energy). 그 밖의 난수는 엔진 상태(g.rng)가
     그대로 이어지므로 같은 상태·같은 행동이면 항상 같은 결과다.
   - 자동으로 넘어가는 강제 행동(예약 실행/출전 지연/행동 불가)은 수로 세지 않는다. */
import { RNG, clone } from "../engine/entities.js";
import { legalActions, prepareCurrentTurn } from "../engine/actions.js";
import { execute, endTurn } from "../engine/execution.js";
import { actionHeuristic } from "../ai/specialists.js";

const FORCED_TYPES = new Set(["scheduled", "speedDelay", "noLegalPass"]);
export function isForcedList(acts) {
  return acts.length === 1 && FORCED_TYPES.has(acts[0].type);
}
/* 풀이용 복제: 기록용 필드(로그·이벤트 기록·공개 기록)는 결과에 영향을 주지 않으므로 복제하지 않고 비워 둔다. */
export function cloneForSolve(g) {
  const {
    logs,
    eventLog,
    publicHistory,
    ...rest
  } = g;
  const c = clone(rest);
  c.logs = [];
  c.eventLog = [];
  c.publicHistory = [];
  const rng = new RNG(1);
  rng.s = g.rng.s;
  c.rng = rng;
  return c;
}
function currentPair(g) {
  return g.order[g.turn];
}
/* 상태 서명: 전투 상태 전체의 해시(로그·식별자·남은 수 같은 기록용 필드는 제외). 같은 서명이면 어떤 경로로 왔든 이후 전개가 같다. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
export function hashText(text) {
  return cyrb53(text);
}
/* 판마다 달라지는 이름표(판 번호·경기 번호·에너지 번호)는 상태가 아니므로 서명에서 뺀다. */
export function stripIdentity(text, g) {
  for (const id of [g.battleId, g.matchId]) if (typeof id === "string" && id) text = text.split(id).join("#");
  return text.replace(/"energy:[^"]*"/g, '"energy"');
}
export function signature(g) {
  const {
    logs,
    matchId,
    battleId,
    eventLog,
    eventSequence,
    publicHistory,
    networkRevision,
    puzzle,
    ...rest
  } = g;
  rest.energyPos = puzzle?.energy ? puzzle.energy.pos : null;
  return cyrb53(stripIdentity(JSON.stringify(rest), g));
}
export function currentActions(g) {
  const [t, s] = currentPair(g);
  prepareCurrentTurn(g);
  return legalActions(g, t, s);
}
export function applyAction(g, a, options = {}) {
  const [t, s] = currentPair(g);
  const c = cloneForSolve(g);
  const ok = execute(c, t, s, a, {
    ...options,
    sim: false,
    __puzzleInternal: true
  });
  return ok ? c : null;
}
const IGNORED_KEYS = new Set(["label", "reason", "displayCost", "preview"]);
/* 행동 동일성: 화면용 문구를 뺀 나머지 필드. */
export function actionKeyOf(a) {
  return JSON.stringify(a, (k, v) => IGNORED_KEYS.has(k) ? undefined : v);
}
export function passTurn(g) {
  const [t, s] = currentPair(g);
  const c = cloneForSolve(g);
  endTurn(c, t, s, false);
  return c;
}
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
export class TacticsSolver {
  constructor({
    maxNodes = 600000,
    order = "heuristic"
  } = {}) {
    this.order = order;
    this.maxNodes = maxNodes;
    this.actionCache = new Map();
    this.nodes = 0;
    this.tt = new Map();
    /* 간선 기억: (국면, 남은 수, 행동 번호) → 그 수를 둔 뒤의 결과. 중단된 계산을 이어갈 때 이미 끝난 가지를 다시 두어 보지 않게 한다. */
    this.edge = new Map();
    this.exhausted = false;
    /* 시간 조각: deadline 을 넘기면 interrupted 가 서고 계산이 중단된다. 끝난 가지는 기억되어 있으므로 같은 질의를 다시 하면 이어서 계산된다. */
    this.deadline = Infinity;
    this.interrupted = false;
  }
  /* 한 번의 질의를 시간 조각 안에서 끝낸다(끝나지 않았으면 undefined). 끝나지 않은 결과는 믿을 수 없으니 호출한 쪽이 버리고 다시 부른다. */
  slice(ms, fn) {
    this.interrupted = false;
    this.deadline = now() + ms;
    const out = fn();
    this.deadline = Infinity;
    if (this.interrupted) {
      this.interrupted = false;
      return undefined;
    }
    return out;
  }
  /* 플레이어가 지금부터 k수 안에 승리를 강제할 수 있는가. */
  wins(g, k) {
    if (g.winner) return g.winner === "P";
    if (this.interrupted) return false;
    const [t] = currentPair(g);
    const mine = t === "P";
    const sig = signature(g);
    const key = `${k}|${sig}`;
    const hit = this.tt.get(key);
    if (hit !== undefined) return hit;
    if (++this.nodes > this.maxNodes) {
      this.exhausted = true;
      return false;
    }
    if ((this.nodes & 15) === 0 && now() > this.deadline) {
      this.interrupted = true;
      return false;
    }
    const acts = this.ordered(g, sig);
    let result;
    if (!acts.length) result = this.wins(passTurn(g), k);else {
      const forced = isForcedList(acts);
      if (mine && !forced && k <= 0) result = false;else {
        const kk = mine && !forced ? k - 1 : k;
        result = !mine;
        for (let i = 0; i < acts.length; i++) {
          const edgeKey = `${key}|${i}`;
          let r = this.edge.get(edgeKey);
          if (r === undefined) {
            const c = applyAction(g, acts[i]);
            if (!c) continue;
            r = this.wins(c, kk);
            if (this.interrupted) return false;
            if (!this.exhausted) this.edge.set(edgeKey, r);
          }
          if (mine ? r : !r) {
            result = mine;
            break;
          }
        }
      }
    }
    if (!this.exhausted && !this.interrupted) this.tt.set(key, result);
    return result;
  }
  ordered(g, sig = signature(g)) {
    const [t, s] = currentPair(g);
    let acts = this.actionCache.get(sig);
    if (!acts) {
      acts = currentActions(g);
      if (acts.length > 1 && this.order === "heuristic") acts = acts.map(a => ({
        a,
        h: actionHeuristic(g, t, s, a)
      })).sort((x, y) => y.h - x.h).map(x => x.a);
      if (this.actionCache.size > 300000) this.actionCache.clear();
      this.actionCache.set(sig, acts);
    }
    return acts;
  }
  /* 플레이어 차례에서 k수 안에 승리를 강제하는 첫 수 전부. */
  winningFirstMoves(g, k) {
    const acts = currentActions(g);
    const good = [];
    for (const a of acts) {
      const c = applyAction(g, a);
      if (c && this.wins(c, isForcedList(acts) ? k : k - 1)) good.push(a);
    }
    return {
      all: acts,
      good,
      nodes: this.nodes,
      exhausted: this.exhausted
    };
  }
  /* 이 상태에서 플레이어가 이기는 데 필요한 최소 수(없으면 Infinity). */
  distance(g, maxK) {
    for (let k = 0; k <= maxK; k++) if (this.wins(g, k)) return k;
    return Infinity;
  }
  /* 적의 최선 방어: 플레이어가 이기는 데 가장 오래 걸리는(가능하면 아예 못 이기는) 응수. */
  bestDefense(g, maxK) {
    const [t, s] = currentPair(g);
    const acts = currentActions(g);
    let best = null;
    for (const a of acts) {
      const c = applyAction(g, a);
      if (!c) continue;
      const d = this.distance(c, maxK);
      const h = actionHeuristic(g, t, s, a);
      if (!best || d > best.d || d === best.d && h > best.h) best = {
        a,
        d,
        h
      };
    }
    return best;
  }
}
