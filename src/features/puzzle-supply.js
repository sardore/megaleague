/* 전술 퍼즐 공급(버퍼). 플레이하는 동안 다음 퍼즐을 미리 만들어 둔다 — 영상 버퍼처럼.
   - request(level): 그 단계의 퍼즐을 돌려준다. 이미 만들어 뒀으면 즉시, 아니면 지금 만들며 기다린다.
   - prefetch(level): 앞으로 필요할 단계를 배경에서 미리 만든다(화면에 부담이 적게 천천히).
   - 판을 두며 찾은 후보 중 다른 단계에 맞는 것은 재고로 남겨 두었다가 그 단계가 필요할 때 쓴다.
   만드는 일은 모두 시간 조각으로 쪼개져 있어 전투 화면을 멈추지 않는다. */
import { RNG } from "../engine/entities.js";
import { CANCELLED, SCAN_MAX_K, levelSpec, drawLeague, scanGame, provePuzzle, finishPuzzle, URGENT_PACE, BACKGROUND_PACE } from "./puzzle-generator.js";

/* 정확히 맞는 후보가 없을 때 가까운 후보로 타협하기 전에 더 둬 볼 판 수(급할 때 / 배경). */
const PATIENCE_URGENT = 4;
const PATIENCE_BACKGROUND = 8;
const HARD_LIMIT = 60;
export class PuzzleSupply {
  constructor({
    makeDecks,
    seed = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  }) {
    this.makeDecks = makeDecks;
    this.seed = seed;
    this.stock = [];
    this.ready = new Map();
    this.wants = new Set();
    this.waiters = new Map();
    this.pace = {
      ...BACKGROUND_PACE
    };
    this.signal = {
      cancelled: false
    };
    this.ctx = {
      pace: this.pace,
      signal: this.signal,
      since: 0,
      nodes: 0
    };
    this.games = 0;
    this.lastLeague = "";
    this.leagueRng = new RNG(`${seed}:league`);
    this.running = false;
  }
  /* 누군가 기다리는 중이면 급하게, 아니면 배경 속도로. */
  updatePace() {
    Object.assign(this.pace, this.waiters.size ? URGENT_PACE : BACKGROUND_PACE);
  }
  isReady(level) {
    return this.ready.has(level);
  }
  request(level) {
    if (this.ready.has(level)) {
      const def = this.ready.get(level);
      this.ready.delete(level);
      return Promise.resolve(def);
    }
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(level) || [];
      list.push({
        resolve,
        reject
      });
      this.waiters.set(level, list);
      this.wants.add(level);
      this.updatePace();
      this.pump();
    });
  }
  prefetch(level) {
    if (this.signal.cancelled || this.ready.has(level)) return;
    this.wants.add(level);
    this.pump();
  }
  cancel() {
    this.signal.cancelled = true;
    for (const list of this.waiters.values()) for (const w of list) w.reject(CANCELLED);
    this.waiters.clear();
    this.wants.clear();
    this.ready.clear();
    this.stock.length = 0;
  }
  async pump() {
    if (this.running || this.signal.cancelled) return;
    this.running = true;
    try {
      while (!this.signal.cancelled) {
        /* 기다리는 사람이 있는 단계부터, 없으면 낮은 단계부터 */
        const level = [...this.waiters.keys()].sort((a, b) => a - b)[0] ?? [...this.wants].filter(l => !this.ready.has(l)).sort((a, b) => a - b)[0];
        if (level == null) break;
        let def = null;
        try {
          def = await this.produce(level);
        } catch (error) {
          if (error === CANCELLED) return;
          console.warn("[puzzle] produce failed", error);
        }
        this.wants.delete(level);
        const list = this.waiters.get(level);
        if (list?.length) {
          this.waiters.delete(level);
          for (const w of list) def ? w.resolve(def) : w.reject(new Error("puzzle generation failed"));
        } else if (def) this.ready.set(level, def);
        this.updatePace();
      }
    } finally {
      this.running = false;
    }
  }
  /* 재고에서 단계에 맞는 후보를 꺼낸다. 정확히 맞는 것이 우선, 참을성이 다하면 가장 가까운 것. */
  takeCandidate(spec, scanned) {
    let pick = -1,
      gap = Infinity;
    this.stock.forEach((c, i) => {
      const g = Math.abs(c.moves - spec.moves);
      if (g < gap || g === gap && pick >= 0 && c.cost < this.stock[pick].cost) {
        gap = g;
        pick = i;
      }
    });
    if (pick < 0) return null;
    /* 처음엔 정확히 맞는 후보만, 오래 못 찾으면 ±1, 그래도 없으면 가장 가까운 것 */
    const patience = this.waiters.size ? PATIENCE_URGENT : PATIENCE_BACKGROUND;
    const allowed = scanned < patience ? 0 : scanned < patience * 3 ? 1 : Infinity;
    if (gap > allowed) return null;
    return this.stock.splice(pick, 1)[0];
  }
  async produce(level) {
    const spec = levelSpec(level);
    let scanned = 0,
      weak = 0,
      fallback = null;
    for (;;) {
      if (this.signal.cancelled) throw CANCELLED;
      const cand = this.takeCandidate(spec, scanned);
      if (cand) {
        let def = null;
        try {
          const proved = await provePuzzle(cand, this.ctx);
          def = proved && finishPuzzle(cand, proved, level);
        } catch (error) {
          if (error === CANCELLED) throw error;
        }
        if (def) {
          if (def.bits >= spec.minBits || weak >= 2) return def;
          weak++;
          fallback = !fallback || def.bits > fallback.bits ? def : fallback;
        }
        if (weak >= 3 && fallback) return fallback;
        continue;
      }
      if (scanned >= HARD_LIMIT) return fallback;
      await this.scanOne(spec);
      scanned++;
    }
  }
  async scanOne(spec) {
    const slot = drawLeague(this.leagueRng, this.lastLeague);
    this.lastLeague = `${slot.league}${slot.comp || ""}`;
    const gameSeed = `${this.seed}-${this.games++}`;
    try {
      const decks = this.makeDecks(new RNG(gameSeed), slot.league, slot.comp);
      const found = await scanGame({
        gameSeed,
        league: slot.league,
        comp: slot.comp,
        p: decks.p,
        a: decks.a
      }, this.ctx, {
        maxK: Math.min(SCAN_MAX_K, spec.moves + 1),
        stopAt: spec.moves
      });
      this.stock.push(...found);
    } catch (error) {
      if (error === CANCELLED) throw error;
    }
  }
}
