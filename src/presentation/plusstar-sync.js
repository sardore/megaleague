/* Plus-star gold shimmer: keep its phase on one global clock.
   Battle and setup UIs rebuild card markup on every update, which restarts a CSS animation from zero and made the gold
   sweep visibly cut off and jump. Whenever a plus-star banner appears we hand it a negative delay equal to the current
   phase, so a rebuilt card resumes exactly where the old one was. */
const PERIOD_MS = 780;

function align(root) {
  const list = [];
  if (root.matches?.('.plusstar-active-banner')) list.push(root);
  if (root.querySelectorAll) list.push(...root.querySelectorAll('.plusstar-active-banner'));
  if (!list.length) return;
  const delay = `${-((performance.now() % PERIOD_MS) / 1000).toFixed(3)}s`;
  for (const el of list) if (el.style.getPropertyValue('--ps-delay') !== delay && el.dataset.psAligned !== String(Math.floor(performance.now() / 50))) {
    el.style.setProperty('--ps-delay', delay);
    el.dataset.psAligned = String(Math.floor(performance.now() / 50));
  }
}

export function startPlusStarShimmerSync() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || document.body?.dataset.plusstarSync) return;
  document.body.dataset.plusstarSync = '1';
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') { if (r.target.classList?.contains('plusstar-active-banner') && !r.target.style.getPropertyValue('--ps-delay')) align(r.target); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 1) align(n);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  align(document.body);
}
