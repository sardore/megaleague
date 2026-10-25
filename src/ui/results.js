import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_ui_results = {
  ResultContributionViewModelOwner: undefined,
  ResultContributionPresentationOwner: undefined,
  NavigationApplication: undefined
};
import { evaluate, maskedStateFor } from "../ai/search.js";
import { chooseAI } from "../ai/specialists.js";
import { state_catalog_cards } from "../catalog/cards.js";
import { legalActions, other } from "../engine/actions.js";
import { RNG, card, newGame } from "../engine/entities.js";
import { endTurn, execute } from "../engine/execution.js";
import { mvpResultHTML } from "../online/connection.js";
import { showZombieCaveResult } from "../features/boss-raid.js";
import { isZombieCave } from "../features/zombie-cave.js";
import { log } from "../presentation/audio.js";
import { systems } from "../runtime/systems.js";
import { startBattle } from "./action-choices.js";
import { combatInt, state_ui_battle_state } from "./battle-state.js";
import { cardEmoji, hideCardTooltip } from "./cards.js";
import { characterTileClass, characterTileInner } from "./tiles.js";
import { poolForLeague, stopBgm, state_ui_deck } from "./deck.js";
import { render, syncGrandFieldBackground } from "./payment.js";
import { arrangeAIDeck, localTeamFor } from "./setup.js";
export function initializeUiResults() {
  state_ui_results.ResultContributionViewModelOwner = Object.freeze({
    metrics: Object.freeze([Object.freeze({
      id: "damageDealt",
      label: "가한 피해량",
      aliases: ["damageDealt"]
    }), Object.freeze({
      id: "healingDealt",
      label: "가한 회복량",
      aliases: ["healingDealt", "healingDone", "healingProvided"]
    }), Object.freeze({
      id: "damageTaken",
      label: "받은 피해량",
      aliases: ["damageTaken"]
    }), Object.freeze({
      id: "healingTaken",
      label: "받은 회복량",
      aliases: ["healingTaken", "healingReceived", "receivedHealing"]
    })]),
    raw(unit, metric, g = null) {
      const def = this.metrics.find(item => item.id === metric);
      if (!def) return 0;
      if (g && systems.GenericBattleStatisticsOwner) return systems.GenericBattleStatisticsOwner.projectedMetric(g, unit, def.id);
      for (const key of def.aliases) if (Number.isFinite(Number(unit?.[key]))) return Number(unit[key]);
      return 0;
    },
    percentages(units, metric, g = null) {
      const rows = units.map((unit, index) => ({
        unit,
        index,
        raw: this.raw(unit, metric, g)
      }));
      const corrupt = rows.filter(row => row.raw < 0);
      if (corrupt.length) return Object.freeze({
        metric,
        total: NaN,
        corrupt: true,
        rows: Object.freeze(rows.map(row => Object.freeze({
          ...row,
          percent: 0
        })))
      });
      const total = rows.reduce((sum, row) => sum + row.raw, 0);
      if (total <= 0) return Object.freeze({
        metric,
        total: 0,
        corrupt: false,
        rows: Object.freeze(rows.map(row => Object.freeze({
          ...row,
          percent: 0
        })))
      });
      const shares = rows.map(row => {
        const exact = row.raw / total * 100,
          floor = Math.floor(exact);
        return {
          ...row,
          exact,
          floor,
          remainder: exact - floor,
          percent: floor
        };
      });
      let remain = 100 - shares.reduce((sum, row) => sum + row.percent, 0);
      shares.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index || String(a.unit.uid).localeCompare(String(b.unit.uid))).slice(0, remain).forEach(row => row.percent++);
      return Object.freeze({
        metric,
        total,
        corrupt: false,
        rows: Object.freeze(shares.map(row => Object.freeze(row)))
      });
    },
    canonicalLocalTeam(g) {
      const team = localTeamFor(g);
      return team === "A" ? "A" : "P";
    },
    units(g, teamId) {
      const seen = new Map(),
        team = g?.teams?.[teamId];
      for (const unit of [...(team?.field || []), ...(team?.bench || []), ...(team?.graveyard || [])]) if (unit && !seen.has(unit.uid)) seen.set(unit.uid, unit);
      return [...seen.values()];
    },
    section(g, teamId, metric, label, kind) {
      const contribution = this.percentages(this.units(g, teamId), metric, g);
      return Object.freeze({
        teamId,
        label,
        kind,
        ...contribution
      });
    },
    view(g, metric = "damageDealt") {
      const localTeam = this.canonicalLocalTeam(g),
        opponentTeam = localTeam === "P" ? "A" : "P";
      return Object.freeze({
        metric,
        localTeam,
        opponentTeam,
        sections: Object.freeze([this.section(g, localTeam, metric, "내 진영", "local"), this.section(g, opponentTeam, metric, "상대 진영", "opponent")])
      });
    }
  });
  state_ui_results.ResultContributionPresentationOwner = Object.freeze({
    teamHTML(section) {
      const rows = section.rows.map(row => `<div class="result-contribution-row" data-result-uid="${row.unit.uid}" data-result-team="${section.teamId}"><span class="result-character">${cardEmoji(row.unit.card)} ${state_catalog_cards.EffectiveCardPresentationOwner.resolve(card(row.unit), row.unit, {
        surface: "result",
        sourceRevision: state_ui_battle_state.game?.networkRevision || 0
      }).displayName}</span><span class="result-raw">${combatInt(row.raw)}</span><span class="result-percent">${row.percent}%</span><span class="result-bar" aria-hidden="true"><i style="width:${row.percent}%"></i></span></div>`).join("");
      const total = Number(section.total || 0);
      return `<section class="result-team-section ${section.kind}" data-result-team-section="${section.teamId}" data-result-team-kind="${section.kind}" aria-label="${section.label}"><h4 class="result-team-title"><span>${section.label}</span><small>${section.rows.length}명</small></h4><div class="result-contribution-rows">${rows}</div><div class="result-contribution-total">합계 ${combatInt(total)}</div>${section.corrupt ? '<div class="error">RESULT_STATISTICS_CORRUPTION</div>' : ''}</section>`;
    },
    html(g, metric = "damageDealt") {
      const view = state_ui_results.ResultContributionViewModelOwner.view(g, metric),
        defs = state_ui_results.ResultContributionViewModelOwner.metrics;
      return `<section class="result-contribution" data-result-contribution data-metric="${metric}" data-local-result-team="${view.localTeam}"><div class="result-metric-tabs" role="tablist" aria-label="캐릭터 기여도 지표">${defs.map(def => `<button type="button" role="tab" data-result-metric="${def.id}" aria-selected="${def.id === metric}" class="${def.id === metric ? "active" : ""}">${def.label}</button>`).join("")}</div><div class="result-team-sections">${view.sections.map(section => state_ui_results.ResultContributionPresentationOwner.teamHTML(section)).join("")}</div></section>`;
    },
    bind(root, g) {
      const host = root?.querySelector?.("[data-result-contribution]");
      if (!host || host.dataset.resultContributionBound === "1") return;
      host.dataset.resultContributionBound = "1";
      host.addEventListener("click", event => {
        const button = event.target.closest?.("[data-result-metric]");
        if (!button || !host.contains(button)) return;
        const metric = button.dataset.resultMetric;
        const holder = document.createElement("div");
        holder.innerHTML = state_ui_results.ResultContributionPresentationOwner.html(g, metric);
        const replacement = holder.firstElementChild;
        if (!replacement) return;
        host.replaceWith(replacement);
        state_ui_results.ResultContributionPresentationOwner.bind(root, g);
      });
    }
  });
  state_ui_results.NavigationApplication = (() => {
    const project = id => {
      hideCardTooltip();
      state_ui_battle_state.$$(".screen").forEach(x => x.classList.toggle("active", x.id === id));
      if (id !== "game") stopBgm();
      if (id === "setup") {
        document.querySelectorAll(".battle-emote").forEach(node => node.remove());
        (document.scrollingElement || document.documentElement)?.scrollTo({
          top: 0,
          left: 0,
          behavior: "auto"
        });
        syncGrandFieldBackground(null);
      }
      systems.__megaSyncOnlineChatUI?.();
      return true;
    };
    const request = (id, reason = "navigation") => {
      if (id === "setup" && state_ui_battle_state.game) state_ui_battle_state.game.paused = true;
      const committed = project(id);
      return Object.freeze({
        committed,
        id,
        reason,
        paused: !!state_ui_battle_state.game?.paused
      });
    };
    const resumeBattle = (reason = "battle-resume", options = {}) => {
      if (state_ui_battle_state.game && !state_ui_battle_state.game.winner) state_ui_battle_state.game.paused = false;
      if (options.render === true && state_ui_battle_state.game) render();
      return Object.freeze({
        committed: true,
        reason,
        paused: !!state_ui_battle_state.game?.paused
      });
    };
    return Object.freeze({
      request,
      resumeBattle
    });
  })();
}
export function showVictoryResult() {
  if (isZombieCave(state_ui_battle_state.game)) return showZombieCaveResult(state_ui_battle_state.game);
  const mine = pvpTeamStats(state_ui_battle_state.game, "P");
  const enemy = pvpTeamStats(state_ui_battle_state.game, "A");
  const won = state_ui_battle_state.game.winner === "P";
  state_ui_battle_state.$("#modalContent").innerHTML = `
          <div class="victory-window ${won ? "" : "defeat"}">
            <div class="victory-title">${won ? "VICTORY" : "DEFEAT"}</div>
            <div class="victory-sub">${won ? "전투에서 승리했습니다!" : "전투에서 패배했습니다."}</div>
            ${mvpResultHTML(state_ui_battle_state.game, "P")}
            ${state_ui_results.ResultContributionPresentationOwner.html(state_ui_battle_state.game)}
            <div class="victory-stats">
              <span><b>총 행동</b><br>${state_ui_battle_state.game.stats.turns}</span>
              <span><b>아군 생존</b><br>${mine.alive}/${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_battle_state.game.league)}</span>
              <span><b>가한 피해</b><br>${Math.round(mine.dealt)}</span>
              <span><b>받은 피해</b><br>${Math.round(mine.taken)}</span>
              <span><b>기술 사용</b><br>${mine.skills}회</span>
              <span><b>적 생존</b><br>${enemy.alive}/${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_battle_state.game.league)}</span>
            </div>
            <div class="choice-list" style="justify-content:center">
              <button id="victoryField">전장 결과 보기</button>
              <button id="victoryRematch" class="primary">같은 덱으로 재대결</button>
              <button id="victoryMenu">메인 메뉴</button>
            </div>
          </div>`;
  state_ui_battle_state.$("#modal").classList.add("open");
  state_ui_results.ResultContributionPresentationOwner.bind(state_ui_battle_state.$("#modalContent"), state_ui_battle_state.game);
  state_ui_battle_state.$("#victoryField").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  state_ui_battle_state.$("#victoryMenu").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
    state_ui_results.NavigationApplication.request("setup");
  };
  state_ui_battle_state.$("#victoryRematch").onclick = () => {
    state_ui_battle_state.$("#modal").classList.remove("open");
    const cfg = state_ui_battle_state.lastBattleConfig;
    startBattle(String(Date.now()), {
      pDeck: [...cfg.pDeck],
      aDeck: [...cfg.aDeck],
      mode: state_ui_battle_state.game.mode,
      rules: state_ui_deck.p2p.rules,
      leagueCompositions: cfg.leagueCompositions || null
    });
  };
}
export function pvpTeamStats(g, t) {
  let map = new Map();
  for (const u of [...g.teams[t].field, ...g.teams[t].bench, ...g.teams[t].graveyard]) if (u) map.set(u.uid, u);
  let units = [...map.values()],
    sum = key => units.reduce((n, u) => n + (systems.GenericBattleStatisticsOwner ? systems.GenericBattleStatisticsOwner.projectedMetric(g, u, key) : u[key] || 0), 0);
  return {
    units,
    alive: units.filter(u => !u.dead).length,
    dealt: sum("damageDealt"),
    taken: sum("damageTaken"),
    skills: sum("skillUses"),
    status: sum("statusScore"),
    reflect: sum("reflectDealt"),
    shield: sum("shieldAbsorbed"),
    disrupt: sum("energyDisrupt"),
    switches: g.teams[t].switchUses || sum("switches")
  };
}
export function pvpHistoryRecord(win) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem("megaPvpHistory") || "[]");
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "inline-1:L8888");
  }
  if (!history.some(x => x.matchId === state_ui_battle_state.game.matchId)) history.push({
    matchId: state_ui_battle_state.game.matchId,
    at: Date.now(),
    win,
    turns: state_ui_battle_state.game.stats.turns,
    seed: state_ui_battle_state.game.seed
  });
  history = history.slice(-100);
  try {
    localStorage.setItem("megaPvpHistory", JSON.stringify(history));
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "inline-1:L8892");
  }
  try {
    const row = history.find(x => x.matchId === state_ui_battle_state.game?.matchId);
    if (row) {
      row.resultType = state_ui_battle_state.game?.resultType || "normal";
      row.finishedAt = state_ui_battle_state.game?.finishedAt || Date.now();
      localStorage.setItem("megaPvpHistory", JSON.stringify(history));
    }
  } catch (error) {
    systems.__megaRecordRecoveredError(error, "pvpHistoryRecord.enrich");
  }
  return {
    matches: history.length,
    wins: history.filter(x => x.win).length,
    losses: history.filter(x => !x.win).length
  };
}
export function showPvpResult() {
  let local = state_ui_deck.onlineSide,
    enemy = other(local),
    mine = pvpTeamStats(state_ui_battle_state.game, local),
    theirs = pvpTeamStats(state_ui_battle_state.game, enemy),
    won = state_ui_battle_state.game.winner === local,
    history = pvpHistoryRecord(won);
  state_ui_battle_state.$("#modalContent").innerHTML = `<div class="victory-window ${won ? "" : "defeat"}"><div class="victory-title">${won ? "VICTORY" : "DEFEAT"}</div><div class="victory-sub">온라인 대전에서 ${won ? "승리했습니다!" : "패배했습니다."}</div>${mvpResultHTML(state_ui_battle_state.game, local)}${state_ui_results.ResultContributionPresentationOwner.html(state_ui_battle_state.game)}</div><p>총 ${state_ui_battle_state.game.stats.turns}행동 · 공용 판정: 피해 난수 OFF</p><div class="stats"><span>내 생존 ${mine.alive}/${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_battle_state.game.league)}</span><span>가한 피해 ${Math.round(mine.dealt)}</span><span>받은 피해 ${Math.round(mine.taken)}</span><span>기술 ${mine.skills}회</span><span>상태 기여 ${Math.round(mine.status)}</span><span>실드 흡수 ${Math.round(mine.shield)}</span><span>에너지 방해 ${Math.round(mine.disrupt)}</span><span>교체 ${mine.switches}</span></div><h3>상대 요약</h3><p>생존 ${theirs.alive}/${state_ui_deck.LeagueFormatOwner.deckSize(state_ui_battle_state.game.league)} · 가한 피해 ${Math.round(theirs.dealt)} · 받은 피해 ${Math.round(theirs.taken)} · 기술 ${theirs.skills}회 · 교체 ${theirs.switches}</p><h3>이 기기 PvP 누적</h3><p>${history.matches}전 ${history.wins}승 ${history.losses}패 · 승률 ${history.matches ? Math.round(history.wins / history.matches * 100) : 0}%</p><div class="choice-list"><button id="pvpResultClose">전장 결과 보기</button><button id="pvpResultMenu">메인 메뉴</button></div>`;
  state_ui_battle_state.$("#modal").classList.add("open");
  state_ui_results.ResultContributionPresentationOwner.bind(state_ui_battle_state.$("#modalContent"), state_ui_battle_state.game);
  state_ui_battle_state.$("#pvpResultClose").onclick = () => state_ui_battle_state.$("#modal").classList.remove("open");
  state_ui_battle_state.$("#pvpResultMenu").onclick = () => systems.OnlineRuntime?.returnToSetup?.("pvp-result-menu");
}
export function openChoice(html, items) {
  state_ui_battle_state.$("#modalContent").innerHTML = html + '<div class="choice-list"></div>';
  let list = state_ui_battle_state.$("#modalContent .choice-list");
  items.forEach(x => {
    let b = document.createElement("button");
    b.textContent = x.label;
    b.onclick = () => {
      state_ui_battle_state.$("#modal").classList.remove("open");
      x.fn();
    };
    list.appendChild(b);
  });
  state_ui_battle_state.$("#modal").classList.add("open");
}
export function showCodex() {
  let html = `<h2>카드 도감 — 총 ${state_catalog_cards.CARDS.length}장</h2><p>카드 설명은 컴퓨터에서 마우스를 올리거나 모바일에서 반초간 길게 눌러 확인합니다. 브케노↔휴브, 이루마↔각성이루마, 화락나리↔루나리↔호리진탈은 하나의 폼 패밀리이며, 리그 편성에서는 해당 구성에서 사용 가능한 폼만 표시·전환됩니다.</p><div class="cards-grid">` + state_catalog_cards.CARDS.map(c => `<div class="card compact-card ${characterTileClass(c, null)}" data-info-card="codex" data-card-id="${c.id}">${characterTileInner(c, null)}</div>`).join("") + "</div>";
  openChoice(html, []);
}
export function severeDeckConflict(ids) {
  return ids.includes("flameflower") && (ids.includes("kingprawn") || ids.includes("iceknight"));
}
export function randomBattleDeck(r, league = "mega", composition = state_ui_deck.comprehensiveComposition) {
  league = state_ui_deck.LeagueFormatOwner.normalizeLeague(league);
  composition = state_ui_deck.LeagueFormatOwner.normalizeComposition(composition);
  let pool = [...poolForLeague(league, composition)],
    d = [];
  while (d.length < state_ui_deck.LeagueFormatOwner.deckSize(league)) {
    const valid = pool.filter(id => state_ui_deck.LeagueFormatOwner.fitsPattern([...d, id], league, composition)),
      compatible = state_ui_deck.LeagueFormatOwner.free(league) ? valid.filter(id => !severeDeckConflict([...d, id])) : valid,
      choices = compatible.length ? compatible : valid;
    if (!choices.length) throw new Error(`random deck composition exhausted: ${league}/${composition}/${d.join(",")}`);
    const id = r.pick(choices);
    d.push(id);
    pool = pool.filter(x => x !== id);
  }
  return league === "mega" ? arrangeAIDeck(d) : d;
}
export function quickBattle(seed, variance, stats, league = "mega", composition = state_ui_deck.comprehensiveComposition) {
  composition = state_ui_deck.LeagueFormatOwner.normalizeComposition(composition);
  let r = new RNG(seed),
    pd = randomBattleDeck(r, league, composition),
    ad = randomBattleDeck(r, league, composition),
    g = newGame(pd, ad, {
      seed,
      variance,
      difficulty: "normal",
      mode: "aivai",
      league,
      leagueComposition: composition
    }),
    limit = 5000;
  while (!g.winner && limit--) {
    let [t, s] = g.order[g.turn],
      view = maskedStateFor(g, t),
      a = chooseAI(view, t, s, true);
    let acted = a ? execute(g, t, s, a, {
      sim: false
    }) : false;
    if (!acted) {
      const fallbacks = legalActions(g, t, s);
      for (const fallback of fallbacks) {
        if (execute(g, t, s, fallback, {
          sim: false
        })) {
          acted = true;
          break;
        }
      }
    }
    if (!acted) endTurn(g, t, s, false);
  }
  if (!g.winner) {
    if (stats.__meta) stats.__meta.timeouts++;
    g.winner = evaluate(g, "P") >= 0 ? "P" : "A";
    log(g, `5000행동 상한 판정승: ${g.winner}.`, "turn");
  }
  if (stats.__meta) {
    stats.__meta.totalActions = (stats.__meta.totalActions || 0) + g.stats.turns;
    stats.__meta.maxActions = Math.max(stats.__meta.maxActions || 0, g.stats.turns);
    if (g.stats.turns >= 400) stats.__meta.longBattles = (stats.__meta.longBattles || 0) + 1;
  }
  for (const [t, deck] of [["P", pd], ["A", ad]]) for (const id of deck) {
    let st = stats[id],
      won = g.winner === t;
    st.picks++;
    st.wins += won;
    let units = [...g.teams[t].field, ...g.teams[t].bench, ...g.teams[t].graveyard].filter(x => x && x.card === id);
    for (const u of units) {
      st.turns += u.turns;
      st.dealt += u.damageDealt;
      st.taken += u.damageTaken;
      st.skills += u.skillUses;
      st.status += u.statusScore;
      st.reflect += u.reflectDealt;
      st.absorb += u.shieldAbsorbed;
      st.disrupt += u.energyDisrupt;
      st.switches += u.switches;
      st.roars = (st.roars || 0) + (u.roarUses || 0);
      st.memories = (st.memories || 0) + (u.memoryUses || 0);
      st.bloomTargets = (st.bloomTargets || 0) + (u.bloomTargets || 0);
      st.bloomEvaded = (st.bloomEvaded || 0) + (u.bloomEvaded || 0);
    }
  }
  return g.winner;
}
export async function runSimulation() {
  let n = Math.max(100, Math.min(10000, +state_ui_battle_state.$("#simCount").value || 1000)),
    res = {},
    currentLeague = state_ui_deck.LeagueFormatOwner.normalizeLeague(state_ui_deck.leagueSelection),
    currentComposition = state_ui_deck.LeagueFormatOwner.normalizeComposition(state_ui_deck.comprehensiveComposition),
    formatLabel = state_ui_deck.LeagueFormatOwner.definition(currentLeague).label + (currentLeague === "comprehensive" ? ` · 구성 ${currentComposition === "2335" ? "B" : "A"}` : ""),
    groups = [{
      key: `${formatLabel} · 난수 ON`,
      league: currentLeague,
      composition: currentComposition,
      variance: true
    }, {
      key: `${formatLabel} · 난수 OFF`,
      league: currentLeague,
      composition: currentComposition,
      variance: false
    }];
  state_ui_battle_state.$("#simProgress").classList.remove("hidden");
  state_ui_battle_state.$("#simBtn").disabled = true;
  for (let gi = 0; gi < groups.length; gi++) {
    let gr = groups[gi],
      ids = poolForLeague(gr.league, gr.composition),
      stats = Object.fromEntries(ids.map(id => [id, {
        picks: 0,
        wins: 0,
        turns: 0,
        dealt: 0,
        taken: 0,
        skills: 0,
        status: 0,
        reflect: 0,
        absorb: 0,
        disrupt: 0,
        switches: 0,
        roars: 0,
        memories: 0,
        bloomTargets: 0,
        bloomEvaded: 0
      }]));
    stats.__meta = {
      timeouts: 0,
      totalActions: 0,
      maxActions: 0,
      longBattles: 0
    };
    for (let i = 0; i < n; i++) {
      quickBattle(`balance-${gr.key}-${i}`, gr.variance, stats, gr.league, gr.composition);
      if (i % 20 === 0) {
        state_ui_battle_state.$("#simProgress i").style.width = `${(gi * n + i) / (n * groups.length) * 100}%`;
        await new Promise(r => TimerManager.setTimeout(r, 0));
      }
    }
    res[gr.key] = stats;
  }
  state_ui_battle_state.$("#simProgress i").style.width = "100%";
  state_ui_battle_state.$("#simBtn").disabled = false;
  let html = "";
  for (const gr of groups) {
    let stats = res[gr.key],
      ids = poolForLeague(gr.league, gr.composition);
    html += `<h4>${gr.key} · ${n}판</h4><p>5000행동 상한 판정 ${stats.__meta.timeouts}판 · 평균 전투 행동 ${Math.round(stats.__meta.totalActions / n)} · 400행동 이상 ${stats.__meta.longBattles}판 · 최장 ${stats.__meta.maxActions}행동</p><div style="overflow:auto"><table class="summary-table"><tr><th>카드</th><th>채용</th><th>승률</th><th>자기턴</th><th>가한D</th><th>받은D</th><th>기술</th><th>상태</th><th>포효</th><th>메모리</th><th>피어회피</th><th>실드흡수</th><th>에너지방해</th><th>교체</th></tr>`;
    for (const id of ids) {
      let c = state_catalog_cards.CARDS.find(x => x.id === id),
        s = stats[id],
        d = s.picks || 1,
        avg = x => Math.round(x / d);
      html += `<tr><td>${c.name}</td><td>${s.picks}</td><td>${Math.round(s.wins / d * 100)}%</td><td>${avg(s.turns)}</td><td>${avg(s.dealt)}</td><td>${avg(s.taken)}</td><td>${avg(s.skills)}</td><td>${avg(s.status)}</td><td>${avg(s.roars || 0)}</td><td>${avg(s.memories || 0)}</td><td>${s.bloomTargets ? `${(s.bloomEvaded / s.bloomTargets * 100).toFixed(0)}%` : "-"}</td><td>${avg(s.absorb)}</td><td>${avg(s.disrupt)}</td><td>${avg(s.switches)}</td></tr>`;
    }
    html += "</table></div>";
  }
  state_ui_battle_state.$("#simResult").innerHTML = html;
}
