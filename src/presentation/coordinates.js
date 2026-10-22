import { TimerManager } from "../runtime/timers.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_presentation_coordinates = {
  RenderedBattleEntityMapOwner: undefined,
  battleEntityElement: undefined,
  battleVisualElement: undefined,
  VfxCoordinateOwner: undefined,
  DamagePresentationAnchorOwner: undefined
};
import { findUnit } from "../engine/combat.js";
import { dmCleanDisplayText, dmDebug, dmEscapeSelector, dmFieldEntity, state_features_dragon_memory } from "../features/dragon-memory.js";
import { normalizeGameNumberText } from "./audio.js";
import { systems } from "../runtime/systems.js";
import { combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { safeCssValue } from "../ui/cards.js";
import { displaySideFor } from "../ui/setup.js";
export function initializePresentationCoordinates() {
  state_presentation_coordinates.RenderedBattleEntityMapOwner = Object.freeze({
    field(uid) {
      if (uid == null || uid === "") return null;
      const safeUid = safeCssValue(uid);
      return document.querySelector(`.arena [data-zone="field"][data-uid="${safeUid}"]`);
    },
    visual(uid) {
      const entity = this.field(uid);
      return entity?.querySelector('.unit-stage .char-emoji, .unit-stage .pictogram, .char-emoji, .summon-emoji') || entity;
    }
  });
  state_presentation_coordinates.battleEntityElement = uid => state_presentation_coordinates.RenderedBattleEntityMapOwner.field(uid);
  state_presentation_coordinates.battleVisualElement = uid => state_presentation_coordinates.RenderedBattleEntityMapOwner.visual(uid);
  state_presentation_coordinates.VfxCoordinateOwner = (() => {
    const clientId = `vfx-client:${Math.random().toString(36).slice(2)}`;
    const finiteRect = rect => !!rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite);
    const epoch = () => Number(systems.ActionRenderEngine?.snapshot?.().renderSerial || 0);
    const point = (overlay, element) => {
      if (!overlay?.getBoundingClientRect || !element?.getBoundingClientRect || !overlay.isConnected || !element.isConnected) return null;
      const overlayRect = overlay.getBoundingClientRect(),
        elementRect = element.getBoundingClientRect();
      if (!finiteRect(overlayRect) || !finiteRect(elementRect) || elementRect.width <= 0 || elementRect.height <= 0) return null;
      const boxWidth = Number(overlay.offsetWidth || overlay.clientWidth || 0),
        boxHeight = Number(overlay.offsetHeight || overlay.clientHeight || 0);
      const scaleX = boxWidth > 0 ? overlayRect.width / boxWidth : 1,
        scaleY = boxHeight > 0 ? overlayRect.height / boxHeight : 1;
      if (![scaleX, scaleY].every(value => Number.isFinite(value) && Math.abs(value) > 1e-7)) return null;
      const originX = overlayRect.left + Number(overlay.clientLeft || 0) * scaleX;
      const originY = overlayRect.top + Number(overlay.clientTop || 0) * scaleY;
      const scrollLeft = Number(overlay.scrollLeft || 0),
        scrollTop = Number(overlay.scrollTop || 0);
      const left = (elementRect.left - originX) / scaleX + scrollLeft;
      const top = (elementRect.top - originY) / scaleY + scrollTop;
      const width = elementRect.width / Math.abs(scaleX),
        height = elementRect.height / Math.abs(scaleY);
      const result = {
        x: left + width / 2,
        y: top + height / 2,
        left,
        top,
        width,
        height,
        scaleX,
        scaleY,
        scrollLeft,
        scrollTop,
        elementRect: {
          left: elementRect.left,
          top: elementRect.top,
          width: elementRect.width,
          height: elementRect.height
        },
        overlayRect: {
          left: overlayRect.left,
          top: overlayRect.top,
          width: overlayRect.width,
          height: overlayRect.height
        }
      };
      return [result.x, result.y, result.left, result.top, result.width, result.height, result.scaleX, result.scaleY].every(Number.isFinite) ? Object.freeze(result) : null;
    };
    const pair = (overlay, sourceElement, targetElement) => {
      const layoutEpoch = epoch(),
        source = point(overlay, sourceElement),
        target = point(overlay, targetElement),
        finalEpoch = epoch();
      if (!source || !target || layoutEpoch !== finalEpoch) return null;
      return Object.freeze({
        source,
        target,
        layoutEpoch,
        viewport: Object.freeze({
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          visualScale: Number(window.visualViewport?.scale || 1)
        }),
        devicePixelRatio: Number(window.devicePixelRatio || 1)
      });
    };
    const resolveByIdentity = (event, {
      requireSource = true
    } = {}) => {
      const overlay = document.querySelector(".arena");
      if (!overlay) return null;
      const sourceUid = event?.sourceInstanceId || event?.uid || null;
      const targetUids = [...new Set((event?.targetUids || [event?.targetInstanceId || event?.targetUid]).filter(Boolean).map(String))];
      const sourceElement = sourceUid ? state_presentation_coordinates.RenderedBattleEntityMapOwner.field(sourceUid) : null;
      const targetElements = targetUids.map(uid => [uid, state_presentation_coordinates.RenderedBattleEntityMapOwner.field(uid)]);
      if (requireSource && !sourceElement || targetElements.some(([, element]) => !element)) return null;
      const layoutEpoch = epoch(),
        source = sourceElement ? point(overlay, sourceElement) : null,
        targets = {};
      if (requireSource && !source) return null;
      for (const [uid, element] of targetElements) {
        const target = point(overlay, element);
        if (!target) return null;
        targets[uid] = target;
      }
      const finalEpoch = epoch();
      if (layoutEpoch !== finalEpoch) return null;
      return Object.freeze({
        source,
        targets: Object.freeze(targets),
        layoutEpoch,
        viewport: Object.freeze({
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          visualScale: Number(window.visualViewport?.scale || 1)
        }),
        devicePixelRatio: Number(window.devicePixelRatio || 1)
      });
    };
    const field = (overlay, canonicalTeam) => {
      if (!overlay || !state_ui_battle_state.game || !["P", "A"].includes(canonicalTeam)) return null;
      const displaySide = displaySideFor(state_ui_battle_state.game, canonicalTeam);
      const element = document.getElementById(`${displaySide}Slots`);
      const layoutEpoch = epoch(),
        bounds = point(overlay, element),
        finalEpoch = epoch();
      if (!bounds || layoutEpoch !== finalEpoch) return null;
      return Object.freeze({
        canonicalTeam,
        displaySide,
        elementId: element.id,
        bounds,
        layoutEpoch
      });
    };
    const captureInto = event => {
      const snapshot = resolveByIdentity(event);
      if (snapshot) event.vfxAnchorSnapshot = {
        ...snapshot,
        clientId
      };
      return snapshot;
    };
    const resolveEvent = (event, options) => event?.vfxAnchorSnapshot?.clientId === clientId ? event.vfxAnchorSnapshot : resolveByIdentity(event, options);
    return Object.freeze({
      point,
      pair,
      field,
      epoch,
      resolveByIdentity,
      captureInto,
      resolveEvent
    });
  })();
  state_presentation_coordinates.DamagePresentationAnchorOwner = (() => {
    const clientId = `damage-client:${Math.random().toString(36).slice(2)}`;
    const shown = new Set();
    const remember = item => item;
    const arena = () => document.querySelector(".arena");
    const entity = id => state_presentation_coordinates.RenderedBattleEntityMapOwner.field(id);
    const capture = (g, event) => {
      const recipientEntityId = String(event?.recipientEntityId || event?.uid || "");
      const overlay = arena(),
        target = entity(recipientEntityId);
      const point = overlay && target ? state_presentation_coordinates.VfxCoordinateOwner.point(overlay, target) : null;
      if (!point) return null;
      return Object.freeze({
        clientId,
        recipientEntityId,
        actionId: event?.actionId || g?.pendingTransaction?.actionId || null,
        transactionId: event?.transactionId || g?.pendingTransaction?.transactionId || null,
        skillId: event?.skillId || null,
        hitIndex: Number(event?.hitIndex || 1),
        x: point.x,
        y: point.y,
        layoutEpoch: state_presentation_coordinates.VfxCoordinateOwner.epoch(),
        targetRect: point.elementRect,
        overlayRect: point.overlayRect,
        lethal: !!event?.lethal || !!g && Number(findUnit(g, recipientEntityId)?.hp || 0) <= 0,
        capturedAt: performance.now()
      });
    };
    const captureInto = (g, event) => {
      if (!event || !["damage", "directHp"].includes(event.type)) return event;
      const snap = capture(g, event);
      if (snap) event.presentationAnchor = snap;
      return event;
    };
    const resolve = event => {
      const local = event?.presentationAnchor;
      if (local?.clientId === clientId && [local.x, local.y].every(Number.isFinite)) return local;
      return capture(state_ui_battle_state.game, event);
    };
    const layer = overlay => {
      let node = overlay?.querySelector(":scope > .damage-popup-layer");
      if (!node && overlay) {
        node = document.createElement("div");
        node.className = "damage-popup-layer";
        node.setAttribute("aria-hidden", "true");
        overlay.appendChild(node);
      }
      return node;
    };
    const present = event => {
      const recipientEntityId = String(event?.recipientEntityId || event?.uid || "");
      const eventId = String(event?.damageEventId || event?.visualEventId || `${recipientEntityId}:${event?.type}:${event?.hitIndex || 1}:${event?.amount}`);
      if (!recipientEntityId || shown.has(eventId)) return false;
      const overlay = arena(),
        anchor = resolve(event);
      if (!overlay || !anchor) {
        systems.PresentationFailureChannel?.emit?.({
          surface: "damage-popup",
          phase: "VFX_ANCHOR_RESOLUTION_FAILED",
          error: "damage target anchor unavailable",
          battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
          damageEventId: event?.damageEventId || null,
          recipientEntityId
        });
        remember({
          damageEventId: event?.damageEventId || null,
          recipientEntityId,
          status: "VFX_ANCHOR_RESOLUTION_FAILED",
          at: performance.now()
        });
        return false;
      }
      const host = layer(overlay);
      if (!host) return false;
      shown.add(eventId);
      const node = document.createElement("span");
      node.className = event.type === "directHp" ? "float-num direct-hp" : "float-num damage";
      node.textContent = `-${combatInt(event.amount || 0)}`;
      node.style.left = `${anchor.x}px`;
      node.style.top = `${anchor.y}px`;
      node.dataset.damageEventId = String(event?.damageEventId || "");
      node.dataset.recipientEntityId = recipientEntityId;
      node.dataset.layoutEpoch = String(anchor.layoutEpoch);
      host.appendChild(node);
      const createdAt = performance.now();
      const current = entity(recipientEntityId);
      if (current) {
        current.classList.remove("hit-flash");
        void current.offsetWidth;
        current.classList.add("hit-flash");
      }
      const record = remember({
        damageEventId: event?.damageEventId || null,
        recipientEntityId,
        actionId: anchor.actionId,
        transactionId: anchor.transactionId,
        skillId: event?.skillId || anchor.skillId || null,
        hitIndex: Number(event?.hitIndex || anchor.hitIndex || 1),
        amount: combatInt(event?.amount || 0),
        lethal: !!anchor.lethal,
        targetHp: Number((state_ui_battle_state.game ? findUnit(state_ui_battle_state.game, recipientEntityId) : null)?.hp ?? NaN),
        anchor,
        popup: {
          x: anchor.x,
          y: anchor.y
        },
        createdAt,
        removedAt: null,
        status: "presented"
      });
      TimerManager.setTimeout(() => {
        node.remove();
        if (!host.children.length) host.remove();
        record.removedAt = performance.now();
      }, 800);
      return true;
    };
    return Object.freeze({
      clientId,
      capture,
      captureInto,
      resolve,
      present
    });
  })();
}
export function visualNode(parent, cls, text = "", life = 900) {
  if (!parent) return null;
  let n = document.createElement("span");
  n.className = cls;
  n.textContent = normalizeGameNumberText(text);
  parent.appendChild(n);
  TimerManager.setTimeout(() => n.remove(), life);
  return n;
}
export function battlefieldCardForUid(g, uid) {
  if (!g || !uid || !dmFieldEntity(g, uid)) return null;
  const sel = `.arena .battle-unit-card[data-zone="field"][data-entity-id="${dmEscapeSelector(uid)}"]`;
  const el = document.querySelector(sel);
  return el?.dataset?.entityId === String(uid) ? el : null;
}
export function showCombatNotice(v) {
  const recipientEntityId = String(v?.recipientEntityId || v?.uid || "");
  const clean = dmCleanDisplayText(v?.displayText || v?.text || "");
  if (!recipientEntityId || !clean) return;
  const eventId = String(v.effectEventId || `${v.battleInstanceId || "battle"}:${recipientEntityId}:${v.kind || "effect"}:${clean}:${v.createdAt || 0}`);
  if (state_features_dragon_memory.dmShownEffectEventIds.has(eventId)) {
    dmDebug("effect-duplicate-blocked", {
      eventId,
      recipientEntityId
    });
    return;
  }
  const cardEl = battlefieldCardForUid(state_ui_battle_state.game, recipientEntityId);
  dmDebug("effect-dom-lookup", {
    eventId,
    recipientEntityId,
    found: !!cardEl,
    domEntityId: cardEl?.dataset?.entityId || null
  });
  if (!cardEl || cardEl.dataset.entityId !== recipientEntityId) return;
  state_features_dragon_memory.dmShownEffectEventIds.add(eventId);
  let layer = cardEl.querySelector(":scope > .character-effect-popup-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "character-effect-popup-layer";
    cardEl.prepend(layer);
  }
  let stack = layer.querySelector(":scope > .combat-notice-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "combat-notice-stack";
    layer.appendChild(stack);
  }
  const node = document.createElement("div");
  node.className = `combat-notice ${v.kind || v.effectType || "effect"}`;
  node.textContent = clean;
  node.dataset.effectEventId = eventId;
  stack.appendChild(node);
  while (stack.children.length > 5) stack.firstElementChild?.remove();
  TimerManager.setTimeout(() => {
    if (node.dataset.effectEventId === eventId) node.remove();
    if (!stack.children.length) stack.remove();
  }, 2200);
}
export function positionFx(node, point) {
  if (!node || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  node.style.setProperty("--fx-x", `${point.x}px`);
  node.style.setProperty("--fx-y", `${point.y}px`);
  if (node.classList?.contains("fox-strike-cycle")) {
    node.style.setProperty("left", `${point.x}px`, "important");
    node.style.setProperty("top", `${point.y}px`, "important");
  }
  return true;
}
export function playInstantUnitPopup(v, delay = 0) {
  if (!v || !["damage", "heal", "directHp"].includes(v.type)) return false;
  if (["damage", "directHp"].includes(v.type)) {
    TimerManager.setTimeout(() => state_presentation_coordinates.DamagePresentationAnchorOwner.present(v), Math.max(0, Number(delay) || 0));
    return true;
  }
  const recipientEntityId = v.recipientEntityId || v.uid || null;
  const host = battlefieldCardForUid(state_ui_battle_state.game, recipientEntityId);
  if (!host) return false;
  TimerManager.setTimeout(() => {
    const currentHost = battlefieldCardForUid(state_ui_battle_state.game, recipientEntityId);
    if (!currentHost) return;
    const popupHost = currentHost.querySelector(":scope > .character-effect-popup-layer") || currentHost;
    const popup = visualNode(popupHost, "float-num heal", `+${v.amount}`, 800);
    if (popup && recipientEntityId) popup.dataset.recipientEntityId = recipientEntityId;
    currentHost.classList.remove("heal-flash");
    void currentHost.offsetWidth;
    currentHost.classList.add("heal-flash");
  }, Math.max(0, Number(delay) || 0));
  return true;
}
