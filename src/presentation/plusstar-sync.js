/* Plus-star gold shimmer: one global clock.
   Card markup is rebuilt constantly (every battle render, every setup refresh) and a rebuilt element would start its CSS
   animation from zero, so the gold sweep visibly jumped. Every plus-star shimmer animation is pinned to the document
   timeline origin instead (startTime = 0), so its phase is simply `timeline time mod period` no matter how often the
   card is recreated, hovered, toggled or restyled. */
function pin(root) {
  const list = [];
  if (root.matches?.('.plusstar-active-banner')) list.push(root);
  if (root.querySelectorAll) list.push(...root.querySelectorAll('.plusstar-active-banner'));
  for (const el of list) {
    for (const a of el.getAnimations({ subtree: true })) {
      if (a.animationName === 'plusStarShimmer' && a.startTime !== 0) a.startTime = 0;
    }
  }
}

export function startPlusStarShimmerSync() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || document.body?.dataset.plusstarSync) return;
  document.body.dataset.plusstarSync = '1';
  const run = records => {
    for (const r of records) {
      if (r.type === 'attributes') { if (r.target.classList?.contains('plusstar-active-banner')) pin(r.target); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 1) pin(n);
    }
  };
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  pin(document.body);
}
