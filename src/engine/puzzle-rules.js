/* 전술 퍼즐 전용 규칙. 퍼즐 게임은 g.puzzle 을 가진다.
   - 에너지 사전배열: 양 진영이 하나의 배열(g.puzzle.energy = {list, pos})을 공유한다.
     자연 수급·무작위 에너지 지급 모두 누가 먼저 뽑든 같은 배열에서 순서대로 하나씩 나온다. 난수는 쓰지 않는다. */
export function isPuzzleGame(g) {
  return !!g?.puzzle;
}
function queueOf(g) {
  const q = g?.puzzle?.energy;
  return q && Array.isArray(q.list) && q.list.length ? q : null;
}
/* pool 안에서 배열의 다음 색. 배열 머리가 pool에 없으면 pool에 속한 가장 가까운 색을 쓴다(건너뛴 색은 버려진다). */
export function peekPuzzleColor(g, pool) {
  const q = queueOf(g);
  if (!q || !pool?.length) return null;
  const n = q.list.length;
  for (let i = 0; i < n; i++) {
    const color = q.list[(q.pos + i) % n];
    if (pool.includes(color)) return {
      color,
      advance: i + 1
    };
  }
  return null;
}
export function drawPuzzleColor(g, pool) {
  const pick = peekPuzzleColor(g, pool);
  if (!pick) return null;
  const q = queueOf(g);
  q.pos = (q.pos + pick.advance) % q.list.length;
  return pick.color;
}
/* 앞으로 나올 색 목록(HUD 표시용). */
export function upcomingPuzzleColors(g, count = 8) {
  const q = queueOf(g);
  if (!q) return [];
  return Array.from({
    length: Math.min(count, q.list.length)
  }, (_, i) => q.list[(q.pos + i) % q.list.length]);
}
/* 퍼즐 런타임이 등록하는 훅. 엔진은 퍼즐 기능(솔버·UI)을 직접 import 하지 않는다.
   gate(g, team, slot, action, options) → false 면 그 행동은 오답으로 거부된다. */
export const puzzleHooks = {
  gate: null
};
