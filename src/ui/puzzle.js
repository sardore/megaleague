/* 전술 퍼즐 — 화면·진행(퍼즐 러시).
   정답 판정과 적의 최선 방어는 features/tactics-puzzle.js 가 맡고, 여기서는 진행·표시만 한다.
   - 같은 전투 화면/행동 패널을 그대로 쓴다. 플레이어의 행동은 엔진 execute 입구의 gate 에서 판정된다.
   - 오답은 실행되지 않고 되돌려지며 실수 1회로 센다. 실수 3회면 게임 오버. */
import { state_ui_battle_state } from "./battle-state.js";
import { state_ui_action_panel } from "./action-panel.js";
import { state_ui_deck } from "./deck.js";
import { enterBattleSession } from "./action-choices.js";
import { render } from "./payment.js";
import { state_ui_results, randomBattleDeck } from "./results.js";
import { buildPuzzleGame, reviewMove, resetPuzzleCaches } from "../features/tactics-puzzle.js";
import { PuzzleSupply } from "../features/puzzle-supply.js";
import { CANCELLED } from "../features/puzzle-generator.js";
import { puzzleHooks, upcomingPuzzleColors } from "../engine/puzzle-rules.js";
import { log } from "../presentation/audio.js";

export const PUZZLE_LIVES = 3;
/* 다음 퍼즐을 미리 만들어 두는 개수(현재 퍼즐 다음부터). */
const PREFETCH_AHEAD = 2;
const BEST_KEY = "megaleague.puzzle.best";
export const state_ui_puzzle = {
  run: null,
  supply: null
};
function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(n) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {}
}
const modal = () => state_ui_battle_state.$("#modal");
function leagueLabel(def) {
  return state_ui_deck.LeagueFormatOwner.definition(def.league).label + (def.league === "comprehensive" ? ` ${def.comp === "2335" ? "B" : "A"}` : "");
}
/* 공급기는 퍼즐 모드를 쓰는 동안 하나만 둔다(다시 시작해도 미리 만들어 둔 퍼즐과 재고를 이어 쓴다).
   덱 구성 규칙은 UI 쪽에 있으므로 덱 만드는 함수를 넘긴다. */
function ensureSupply() {
  return state_ui_puzzle.supply ||= new PuzzleSupply({
    makeDecks: (r, league, comp) => ({
      p: randomBattleDeck(r, league, comp),
      a: randomBattleDeck(r, league, comp)
    })
  });
}
export function openPuzzleIntro() {
  const best = readBest();
  state_ui_battle_state.$("#modalContent").innerHTML = `<div class="puzzle-intro"><h2>전술 퍼즐</h2>
    <p>매번 새로 만들어지는 전투 국면이 주어집니다. 여러 리그의 전투가 무작위로 나옵니다.</p>
    <ul>
      <li>목표는 <b>패배하지 않고 적을 전멸</b>시키는 것입니다.</li>
      <li>상대는 내가 이기기 가장 어려운 응수를 <b>모든 경우를 따져서</b> 고릅니다.</li>
      <li>정답이 아닌 수로는 이길 수 없습니다. 오답은 실행되지 않고 <b>실수</b>로 기록됩니다.</li>
      <li>실수 <b>${PUZZLE_LIVES}번</b>이면 게임 오버. 갈수록 어려워집니다.</li>
      <li>에너지는 양 진영이 <b>하나의 정해진 순서</b>를 공유해 뽑습니다. 누가 먼저 모으느냐에 따라 받는 색이 달라지며, 다음 에너지는 화면 위에서 미리 볼 수 있습니다.</li>
    </ul>
    ${best ? `<p class="puzzle-best">최고 기록 · ${best}문제 해결</p>` : ""}
    <div class="choice-list"><button id="puzzleStart" class="primary">퍼즐 시작</button><button id="puzzleIntroClose">닫기</button></div></div>`;
  state_ui_battle_state.$("#puzzleIntroClose").onclick = () => modal().classList.remove("open");
  state_ui_battle_state.$("#puzzleStart").onclick = () => startPuzzleRun();
  modal().classList.add("open");
  /* 규칙을 읽는 동안 첫 퍼즐을 미리 만들기 시작한다. */
  ensureSupply().prefetch(1);
}
function showWaiting(text) {
  state_ui_battle_state.$("#modalContent").innerHTML = `<div class="puzzle-intro"><h2>전술 퍼즐</h2><p class="puzzle-wait" role="status">${text}</p>
    <div class="choice-list"><button id="puzzleWaitCancel">취소</button></div></div>`;
  state_ui_battle_state.$("#puzzleWaitCancel").onclick = () => {
    modal().classList.remove("open");
    leavePuzzle();
  };
  modal().classList.add("open");
}
export function startPuzzleRun() {
  ensureSupply();
  state_ui_puzzle.run = {
    level: 1,
    def: null,
    lives: PUZZLE_LIVES,
    solved: 0,
    over: false,
    credited: false,
    message: ""
  };
  showWaiting("퍼즐을 만드는 중…");
  openLevel(1);
}
/* level 단계 퍼즐을 공급기에서 받아 연다. 아직 만드는 중이면 기다린다. */
async function openLevel(level) {
  const supply = state_ui_puzzle.supply,
    run = state_ui_puzzle.run;
  if (!supply || !run) return;
  let def;
  try {
    def = await supply.request(level);
  } catch (error) {
    if (error === CANCELLED || supply !== state_ui_puzzle.supply) return;
    console.warn("[puzzle] generation failed", error);
    state_ui_battle_state.$("#modalContent").innerHTML = `<div class="puzzle-intro"><h2>전술 퍼즐</h2><p>퍼즐을 만들지 못했습니다.</p>
      <div class="choice-list"><button id="puzzleWaitRetry" class="primary">다시 시도</button><button id="puzzleWaitCancel">메인 메뉴</button></div></div>`;
    state_ui_battle_state.$("#puzzleWaitRetry").onclick = () => {
      showWaiting("퍼즐을 만드는 중…");
      openLevel(level);
    };
    state_ui_battle_state.$("#puzzleWaitCancel").onclick = () => {
      modal().classList.remove("open");
      leavePuzzle();
    };
    return;
  }
  if (supply !== state_ui_puzzle.supply || run !== state_ui_puzzle.run) return;
  let g;
  resetPuzzleCaches();
  try {
    g = buildPuzzleGame(def);
  } catch (error) {
    console.warn("[puzzle] unusable puzzle, making another", error);
    return openLevel(level);
  }
  run.level = level;
  run.def = def;
  run.credited = false;
  run.message = "";
  modal().classList.remove("open");
  state_ui_battle_state.game = g;
  g.matchType = `전술 퍼즐 · ${leagueLabel(def)}`;
  enterBattleSession(`퍼즐 ${level}: 패배하지 않고 적을 쓰러뜨리세요.`);
  for (let i = 1; i <= PREFETCH_AHEAD; i++) supply.prefetch(level + i);
}
function activeRun(g) {
  return g?.puzzle && g === state_ui_battle_state.game ? state_ui_puzzle.run : null;
}
/* 엔진 execute 입구: 플레이어의 모든 행동은 여기서 정답 여부를 판정받는다. */
function puzzleGate(g, t, s, action, options) {
  const run = activeRun(g);
  if (!run) return true;
  if (run.over || g.winner) return false;
  const review = reviewMove(g, action, options);
  if (!review.ok) {
    registerMistake(g, run);
    return false;
  }
  if (review.counted) g.puzzle.budget--;
  run.message = "";
  return true;
}
function registerMistake(g, run) {
  run.lives--;
  run.message = run.lives > 0 ? "오답 — 그 수로는 적을 확실히 이길 수 없습니다." : "오답 — 실수를 모두 사용했습니다.";
  log(g, run.message, "turn");
  if (run.lives <= 0) {
    run.over = true;
    g.winner = "A";
  }
  const hud = document.getElementById("puzzleHud");
  hud?.classList.remove("puzzle-shake");
  void hud?.offsetWidth;
  hud?.classList.add("puzzle-shake");
  state_ui_battle_state.pendingSkill = null;
  state_ui_battle_state.$("#modal")?.classList.remove("open");
  render();
  if (run.over) showRunEnd();
}
function chips(g) {
  return upcomingPuzzleColors(g, 10).map(c => `<span class="e ${c}"></span>`).join("");
}
/* battle render() 마다 호출: 퍼즐 전투일 때만 상단 안내를 보여준다. */
export function renderPuzzleHud() {
  const g = state_ui_battle_state.game,
    hud = document.getElementById("puzzleHud"),
    run = activeRun(g);
  document.body.classList.toggle("puzzle-active", !!run);
  if (!hud) return;
  hud.hidden = !run;
  if (!run) return;
  const def = run.def;
  if (g.winner === "P" && !run.credited) {
    run.credited = true;
    run.solved++;
    if (run.solved > readBest()) writeBest(run.solved);
  }
  hud.innerHTML = `<div class="puzzle-hud-top"><b>퍼즐 ${run.level}<small> · 해결 ${run.solved}</small></b><span class="puzzle-league">${def ? leagueLabel(def) : ""}</span>
    <span class="puzzle-lives" aria-label="남은 실수 기회">${Array.from({
    length: PUZZLE_LIVES
  }, (_, i) => `<i class="${i < run.lives ? "on" : ""}"></i>`).join("")}</span></div>
    <div class="puzzle-hud-goal"><b>패배하지 않고 적을 전멸시키세요</b></div>
    <div class="puzzle-hud-energy"><span class="puzzle-energy-row"><small>다음 에너지</small>${chips(g)}</span></div>
    <div class="puzzle-hud-msg" role="status">${run.message || ""}</div>`;
}
function showRunEnd() {
  const run = state_ui_puzzle.run;
  state_ui_battle_state.$("#modalContent").innerHTML = `<div class="puzzle-intro"><h2>게임 오버</h2>
    <p>${run.solved}문제를 해결했습니다.</p><p class="puzzle-best">최고 기록 · ${Math.max(readBest(), run.solved)}문제</p>
    <div class="choice-list"><button id="puzzleRetry" class="primary">처음부터 다시</button><button id="puzzleMenu">메인 메뉴</button></div></div>`;
  state_ui_battle_state.$("#puzzleRetry").onclick = () => startPuzzleRun();
  state_ui_battle_state.$("#puzzleMenu").onclick = () => {
    modal().classList.remove("open");
    leavePuzzle();
  };
  modal().classList.add("open");
}
function leavePuzzle() {
  resetPuzzleCaches();
  state_ui_puzzle.supply?.cancel();
  state_ui_puzzle.supply = null;
  state_ui_puzzle.run = null;
  document.body.classList.remove("puzzle-active");
  state_ui_battle_state.game = null;
  state_ui_results.NavigationApplication.request("setup");
}
/* 퍼즐 전투가 끝났을 때의 행동 패널(정답 → 다음 퍼즐, 실패 → 게임 오버). */
function renderPuzzleResult(ctx) {
  const g = ctx.game,
    run = state_ui_puzzle.run,
    box = ctx.box;
  box.innerHTML = "";
  const title = state_ui_battle_state.$("#actionTitle"),
    hint = state_ui_battle_state.$("#actionHint");
  const add = (text, cls, onclick) => {
    const b = document.createElement("button");
    b.textContent = text;
    b.dataset.actionPanelMeta = "terminal";
    if (cls) b.className = cls;
    b.onclick = onclick;
    box.appendChild(b);
  };
  if (g.winner === "P") {
    title.textContent = "정답!";
    hint.textContent = `${run.solved}문제 해결`;
    const supply = state_ui_puzzle.supply;
    if (supply?.isReady(run.level + 1)) add("다음 퍼즐 ▶", "primary", () => openLevel(run.level + 1));else {
      hint.textContent = `${run.solved}문제 해결 · 다음 퍼즐을 만드는 중…`;
      add("다음 퍼즐 ▶ (준비 중)", "primary", () => {
        showWaiting("다음 퍼즐을 만드는 중…");
        openLevel(run.level + 1);
      });
    }
  } else {
    title.textContent = "게임 오버";
    hint.textContent = `실수 ${PUZZLE_LIVES}번 · ${run.solved}문제 해결`;
    add("처음부터 다시", "primary", () => startPuzzleRun());
  }
  add("메인 메뉴", "", leavePuzzle);
}
export function initializeUiPuzzle() {
  state_ui_battle_state.$("#puzzleBtn").onclick = openPuzzleIntro;
  puzzleHooks.gate = puzzleGate;
  state_ui_action_panel.ActionRenderEngine.registerRoute("tactics-puzzle", 350, ctx => !!ctx.game?.puzzle && !!ctx.game.winner && !!state_ui_puzzle.run, renderPuzzleResult);
}
