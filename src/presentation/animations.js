import { bossPlayVisuals } from "../features/boss-raid.js";
// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_presentation_animations = {
  HorizonStrikeSequenceOwner: undefined,
  DynamicSkillVfxPresentationOwner: undefined
};
import { other } from "../engine/actions.js";
import { findUnit, teamOf } from "../engine/combat.js";
import { actionSkillHasEffect, state_engine_entities } from "../engine/entities.js";
import { playFoxStrikeVisual } from "../features/foxious.js";
import { playGenociderVisual } from "../features/genocider.js";
import { playJcVisual } from "../features/summons.js";
import { timeCommitPendingTurnAdvance, timeMarkTimeline, timePlayClockRotationOverlay, timePlayHyperVisual, timePlayRecallVisual, timeSetInputLock, timeTrackVisualTimers, state_features_timeora } from "../features/timeora.js";
import { battlefieldCardForUid, playInstantUnitPopup, positionFx, showCombatNotice, visualNode, state_presentation_coordinates } from "./coordinates.js";
import { systems } from "../runtime/systems.js";
import { afterAction, scheduleAI } from "../ui/action-choices.js";
import { combatInt, state_ui_battle_state } from "../ui/battle-state.js";
import { render } from "../ui/payment.js";
export function initializePresentationAnimations() {
  state_presentation_animations.HorizonStrikeSequenceOwner = (() => {
    const remember = entry => entry;
    const phase = (record, name, extra = null) => {
      const item = {
        phase: name,
        at: performance.now(),
        ...(extra || {})
      };
      record.phases.push(item);
      return item;
    };
    const wait = ms => new Promise(resolve => systems.TimerManager.setTimeout(resolve, ms));
    const animate = async (node, frames, options) => {
      if (!node) return;
      if (typeof node.animate === "function") {
        try {
          await node.animate(frames, {
            fill: "forwards",
            ...options
          }).finished;
          return;
        } catch (_) {}
      }
      await wait(Number(options?.duration || 0));
    };
    const resolveSnapshot = event => {
      const attempt = () => {
        const overlay = document.querySelector(".arena"),
          snapshot = state_presentation_coordinates.VfxCoordinateOwner.resolveEvent(event),
          targetUid = String(event.targetInstanceId || event.targetUid || ""),
          target = snapshot?.targets?.[targetUid] || null;
        if (!overlay || !snapshot?.source || !target) return null;
        return {
          overlay,
          anchors: Object.freeze({
            source: snapshot.source,
            target,
            layoutEpoch: snapshot.layoutEpoch,
            viewport: snapshot.viewport,
            devicePixelRatio: snapshot.devicePixelRatio
          })
        };
      };
      const immediate = attempt();
      if (immediate) return Promise.resolve(immediate);
      return new Promise(resolve => systems.TimerManager.requestAnimationFrame(() => resolve(attempt())));
    };
    const fail = (event, reason) => {
      const failure = {
        code: "VFX_ANCHOR_RESOLUTION_FAILED",
        reason,
        sequenceId: event.vfxSequenceId || null,
        sourceInstanceId: event.sourceInstanceId || event.uid || null,
        targetInstanceId: event.targetInstanceId || event.targetUid || null
      };
      systems.PresentationFailureChannel?.emit?.({
        surface: "vfx",
        phase: failure.code,
        error: reason,
        battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
        revision: Number(state_ui_battle_state.game?.networkRevision || 0),
        ...failure
      });
      remember({
        ...failure,
        phases: [],
        failed: true,
        at: performance.now()
      });
      return false;
    };
    const place = (node, point) => {
      if (!node || !point) return false;
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      return true;
    };
    const popupForHit = (events, hitIndex) => events.find(item => item?.type === "damage" && Number(item.hitIndex || 1) === hitIndex) || null;
    const statusNotice = events => events.find(item => item?.type === "combatNotice" && item.horizonStatus) || events.find(item => item?.type === "combatNotice") || null;
    const play = async (event, associatedEvents = []) => {
      const resolved = await resolveSnapshot(event);
      if (!resolved) return fail(event, "source or target rendered anchor unavailable after render-complete retry");
      const {
          overlay,
          anchors
        } = resolved,
        moon = event.element === "moon",
        palette = moon ? "moon" : "sun",
        source = anchors.source,
        target = anchors.target;
      const record = remember({
        sequenceId: event.vfxSequenceId || null,
        skillId: event.skillId || null,
        sourceInstanceId: event.sourceInstanceId || event.uid || null,
        targetInstanceId: event.targetInstanceId || event.targetUid || null,
        anchors,
        phases: [],
        failed: false,
        palette
      });
      const nodes = new Set(),
        add = (className, point, parent = overlay) => {
          const node = document.createElement("span");
          node.className = className;
          node.dataset.vfxSequenceId = event.vfxSequenceId || "";
          parent.appendChild(node);
          nodes.add(node);
          if (point) place(node, point);
          return node;
        };
      const cleanup = () => {
        for (const node of nodes) node.remove();
        nodes.clear();
        phase(record, "cleanup", {
          orphanCount: overlay.querySelectorAll(`[data-vfx-sequence-id="${CSS.escape(event.vfxSequenceId || "")}"]`).length
        });
      };
      try {
        const orb = add(`horizon-orb ${palette}`, source),
          chargeLayer = add(`horizon-charge-particles ${palette}`, source);
        for (let i = 0; i < 10; i++) {
          const p = document.createElement("i");
          p.style.setProperty("--i", i);
          p.style.setProperty("--charge-angle", `${i * 36}deg`);
          chargeLayer.appendChild(p);
        }
        phase(record, "orb-spawn", {
          x: source.x,
          y: source.y
        });
        phase(record, "orb-charge");
        await Promise.all([animate(orb, [{
          opacity: 0,
          transform: "translate(-50%,-50%) scale(.32)"
        }, {
          opacity: 1,
          transform: "translate(-50%,-50%) scale(1.18)",
          offset: .5
        }, {
          opacity: 1,
          transform: "translate(-50%,-50%) scale(1)"
        }], {
          duration: 390,
          easing: "cubic-bezier(.2,.72,.2,1)"
        }), animate(chargeLayer, [{
          opacity: 0,
          transform: "translate(-50%,-50%) scale(1.7)"
        }, {
          opacity: 1,
          transform: "translate(-50%,-50%) scale(.72)",
          offset: .72
        }, {
          opacity: 0,
          transform: "translate(-50%,-50%) scale(.42)"
        }], {
          duration: 390,
          easing: "ease-in"
        })]);
        chargeLayer.remove();
        nodes.delete(chargeLayer);
        const dx = target.x - source.x,
          dy = target.y - source.y,
          length = Math.max(1, Math.hypot(dx, dy)),
          angle = Math.atan2(dy, dx),
          targetWidth = Math.max(58, Math.min(138, target.width * 1.18));
        const cone = add(`horizon-light-cone ${palette}`, source);
        cone.style.setProperty("--cone-length", `${length}px`);
        cone.style.setProperty("--cone-angle", `${angle}rad`);
        cone.style.setProperty("--cone-end-width", `${targetWidth}px`);
        const targetGlow = add(`horizon-target-glow ${palette}`, target);
        phase(record, "tapered-light-cone-expand", {
          startWidth: 3,
          endWidth: targetWidth,
          startX: source.x,
          startY: source.y,
          endX: target.x,
          endY: target.y
        });
        await animate(cone, [{
          opacity: 0,
          transform: `translateY(-50%) rotate(${angle}rad) scaleX(.03)`
        }, {
          opacity: 1,
          transform: `translateY(-50%) rotate(${angle}rad) scaleX(1)`
        }], {
          duration: 410,
          easing: "cubic-bezier(.18,.72,.2,1)"
        });
        phase(record, "cone-full");
        await wait(145);
        phase(record, "first-hit-presentation");
        const first = popupForHit(associatedEvents, 1);
        if (first) playInstantUnitPopup(first);
        phase(record, "light-cone-collapse");
        await Promise.all([animate(cone, [{
          opacity: 1
        }, {
          opacity: 0,
          filter: "blur(9px) brightness(1.3)"
        }], {
          duration: 220,
          easing: "ease-in"
        }), animate(targetGlow, [{
          opacity: 1,
          transform: "translate(-50%,-50%) scale(1)"
        }, {
          opacity: 0,
          transform: "translate(-50%,-50%) scale(1.7)"
        }], {
          duration: 220
        })]);
        cone.remove();
        targetGlow.remove();
        nodes.delete(cone);
        nodes.delete(targetGlow);
        phase(record, "cone-remove");
        phase(record, "pause-start");
        await wait(170);
        phase(record, "pause-end");
        const trail = add(`horizon-orb-trail ${palette}`, source);
        trail.style.setProperty("--trail-dx", `${dx}px`);
        trail.style.setProperty("--trail-dy", `${dy}px`);
        phase(record, "orb-travel", {
          fromX: source.x,
          fromY: source.y,
          toX: target.x,
          toY: target.y
        });
        await Promise.all([animate(orb, [{
          left: `${source.x}px`,
          top: `${source.y}px`,
          opacity: 1,
          transform: "translate(-50%,-50%) scale(1)"
        }, {
          left: `${target.x}px`,
          top: `${target.y}px`,
          opacity: 1,
          transform: "translate(-50%,-50%) scale(.78)"
        }], {
          duration: 520,
          easing: "cubic-bezier(.35,.02,.55,1)"
        }), animate(trail, [{
          opacity: 0,
          transform: "translate(-50%,-50%) scale(.3)"
        }, {
          opacity: .8,
          offset: .35
        }, {
          opacity: 0,
          transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.15)`
        }], {
          duration: 520
        })]);
        trail.remove();
        nodes.delete(trail);
        place(orb, target);
        phase(record, "target-impact", {
          x: target.x,
          y: target.y
        });
        await wait(105);
        orb.remove();
        nodes.delete(orb);
        const core = add(`horizon-explosion-core ${palette}`, target),
          particles = [],
          sparks = [],
          rings = [];
        const particleCount = 18,
          sparkCount = 10,
          ringCount = 2;
        for (let i = 0; i < particleCount; i++) {
          const p = add(`horizon-spiral-particle ${palette}`, target);
          const angle0 = i / particleCount * Math.PI * 2 + i % 3 * .12,
            radius = 48 + i % 5 * 13,
            up = 30 + i % 4 * 12;
          p.style.setProperty("--spiral-x", `${Math.cos(angle0) * radius}px`);
          p.style.setProperty("--spiral-y", `${Math.sin(angle0) * radius - up}px`);
          p.style.setProperty("--spiral-rotate", `${180 + i * 37}deg`);
          p.style.setProperty("--spiral-delay", `${i % 4 * 18}ms`);
          particles.push(p);
        }
        for (let i = 0; i < sparkCount; i++) {
          const p = add(`horizon-spark ${palette}`, target);
          const a0 = i / sparkCount * Math.PI * 2,
            r = 36 + i % 4 * 14;
          p.style.setProperty("--spark-x", `${Math.cos(a0) * r}px`);
          p.style.setProperty("--spark-y", `${Math.sin(a0) * r - 18}px`);
          sparks.push(p);
        }
        for (let i = 0; i < ringCount; i++) {
          const ring = add(`horizon-explosion-ring ${palette}`, target);
          ring.style.setProperty("--ring-delay", `${i * 85}ms`);
          rings.push(ring);
        }
        phase(record, "spiral-particle-eruption", {
          particleCount,
          sparkCount
        });
        phase(record, "expanding-rings", {
          ringCount
        });
        const animations = [animate(core, [{
          opacity: 0,
          transform: "translate(-50%,-50%) scale(.18)"
        }, {
          opacity: 1,
          transform: "translate(-50%,-50%) scale(1.7)",
          offset: .35
        }, {
          opacity: 0,
          transform: "translate(-50%,-50%) scale(3.8)"
        }], {
          duration: 680,
          easing: "ease-out"
        }), ...particles.map(node => animate(node, [{
          opacity: 0,
          transform: "translate(-50%,-50%) scale(.35) rotate(0deg)"
        }, {
          opacity: 1,
          offset: .18
        }, {
          opacity: 0,
          transform: "translate(calc(-50% + var(--spiral-x)),calc(-50% + var(--spiral-y))) scale(.15) rotate(var(--spiral-rotate))"
        }], {
          duration: 650,
          delay: Number.parseInt(node.style.getPropertyValue("--spiral-delay")) || 0,
          easing: "cubic-bezier(.15,.64,.28,1)"
        })), ...sparks.map(node => animate(node, [{
          opacity: 0
        }, {
          opacity: 1,
          offset: .18
        }, {
          opacity: 0,
          transform: "translate(calc(-50% + var(--spark-x)),calc(-50% + var(--spark-y))) scale(.1)"
        }], {
          duration: 480,
          easing: "ease-out"
        })), ...rings.map((node, i) => animate(node, [{
          opacity: .9,
          transform: "translate(-50%,-50%) scale(.2)"
        }, {
          opacity: 0,
          transform: "translate(-50%,-50%) scale(3.5)"
        }], {
          duration: 600,
          delay: i * 85,
          easing: "ease-out"
        }))];
        await wait(95);
        phase(record, "second-hit-presentation");
        const second = popupForHit(associatedEvents, 2);
        if (second) playInstantUnitPopup(second);
        await wait(90);
        phase(record, moon ? "freeze-presentation" : "burn-presentation");
        const notice = statusNotice(associatedEvents);
        if (notice) showCombatNotice(notice);
        await Promise.all(animations);
        phase(record, "fade");
      } catch (error) {
        systems.PresentationFailureChannel?.emit?.({
          surface: "vfx",
          phase: "horizon-sequence",
          error: String(error),
          battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
          revision: Number(state_ui_battle_state.game?.networkRevision || 0),
          sequenceId: event.vfxSequenceId || null
        });
        record.failed = true;
        record.error = String(error);
      } finally {
        cleanup();
      }
      return true;
    };
    return Object.freeze({
      play
    });
  })();
  state_presentation_animations.DynamicSkillVfxPresentationOwner = (() => {
    const remember = entry => entry;
    const fail = (event, reason, code = "VFX_ANCHOR_RESOLUTION_FAILED") => {
      const failure = {
        code,
        reason,
        type: event?.type || null,
        sequenceId: event?.vfxSequenceId || null,
        sourceInstanceId: event?.sourceInstanceId || event?.uid || null,
        targetInstanceIds: [...(event?.targetUids || [event?.targetInstanceId || event?.targetUid]).filter(Boolean)]
      };
      systems.PresentationFailureChannel?.emit?.({
        surface: "vfx",
        phase: code,
        error: reason,
        battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
        revision: Number(state_ui_battle_state.game?.networkRevision || 0),
        ...failure
      });
      remember({
        ...failure,
        failed: true,
        at: performance.now()
      });
      return false;
    };
    const resolve = (event, {
      requireSource = true
    } = {}) => {
      const overlay = document.querySelector(".arena"),
        snapshot = state_presentation_coordinates.VfxCoordinateOwner.resolveEvent(event, {
          requireSource
        });
      return overlay && snapshot && (!requireSource || snapshot.source) ? {
        overlay,
        snapshot
      } : null;
    };
    const playLunaShard = (event, overlay, snapshot) => {
      const targetTeam = event.targetTeam || other(event.sourceTeam || teamOf(state_ui_battle_state.game, findUnit(state_ui_battle_state.game, event.sourceInstanceId || event.uid)) || "P"),
        field = state_presentation_coordinates.VfxCoordinateOwner.field(overlay, targetTeam);
      if (!field) return fail(event, "canonical target field unavailable", "LUNARSHARD_TARGET_FIELD_RESOLUTION_FAILED");
      const bounds = field.bounds,
        targetIds = (event.targetUids || []).map(String),
        width = Math.max(1, bounds.width),
        height = Math.max(1, bounds.height),
        viewportWidth = Number(snapshot.viewport?.width || window.innerWidth || 360);
      const shardCount = Math.max(12, Math.min(36, Math.round(12 + (Math.min(1280, viewportWidth) - 320) / 48 + targetIds.length * 2)));
      const layer = visualNode(overlay, "lunar-field-vfx", "", 1500);
      if (!layer) return false;
      layer.dataset.vfxSequenceId = event.vfxSequenceId || "";
      layer.dataset.targetTeam = targetTeam;
      layer.style.left = `${bounds.left}px`;
      layer.style.top = `${bounds.top}px`;
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
      const gradient = document.createElement("span");
      gradient.className = "lunar-field-gradient";
      layer.appendChild(gradient);
      let impactCount = 0;
      for (let i = 0; i < shardCount; i++) {
        const shard = document.createElement("i");
        shard.className = "lunar-rain-shard";
        const x = (i * 37 + i % 5 * 11) % 101 / 100 * width,
          startY = -18 - i % 4 * 11,
          fall = height + 45 + i % 5 * 18;
        shard.style.left = `${x}px`;
        shard.style.top = `${startY}px`;
        shard.style.setProperty("--fall-distance", `${fall}px`);
        shard.style.setProperty("--shard-delay", `${180 + i % 8 * 34}ms`);
        shard.style.setProperty("--shard-rotate", `${120 + i * 29}deg`);
        shard.style.setProperty("--shard-scale", `${.68 + i % 5 * .12}`);
        layer.appendChild(shard);
      }
      for (const uid of targetIds) {
        const target = snapshot.targets?.[uid];
        if (!target) continue;
        const localX = target.x - bounds.left,
          localY = target.y - bounds.top;
        const impact = document.createElement("span");
        impact.className = "lunar-target-impact";
        impact.dataset.targetInstanceId = uid;
        impact.style.left = `${localX}px`;
        impact.style.top = `${localY}px`;
        for (let k = 0; k < 3; k++) {
          const piece = document.createElement("i");
          piece.style.setProperty("--impact-angle", `${-28 + k * 28}deg`);
          impact.appendChild(piece);
        }
        layer.appendChild(impact);
        impactCount++;
      }
      remember({
        type: event.type,
        sequenceId: event.vfxSequenceId || null,
        sourceProjectileCount: 0,
        targetTeam,
        targetFieldElementId: field.elementId,
        fieldBounds: {
          left: bounds.left,
          top: bounds.top,
          width,
          height
        },
        gradientBounds: {
          left: bounds.left,
          top: bounds.top,
          width,
          height
        },
        targetCount: targetIds.length,
        impactCount,
        shardCount,
        layoutEpoch: field.layoutEpoch,
        canonicalRngDelta: 0,
        stages: ["target-field-resolve", "gradient-fade-in", "atmosphere-hold", "shard-materialize", "shard-fall", "target-impact", "damage-popup", "attack-reduction-presentation", "residual-sparkle", "gradient-fade-out", "cleanup"],
        at: performance.now(),
        failed: false
      });
      return impactCount === targetIds.length && shardCount > 0;
    };
    const playSugarSwamp = (event, overlay, snapshot) => {
      let nodeCount = 0;
      for (const uid of event.targetUids || []) {
        const target = snapshot.targets?.[String(uid)];
        if (!target) continue;
        const swirl = visualNode(overlay, "sugar-swamp-fx", "", 950);
        if (!swirl) continue;
        positionFx(swirl, target);
        swirl.dataset.vfxSequenceId = event.vfxSequenceId || "";
        swirl.dataset.targetInstanceId = String(uid);
        for (let k = 0; k < 8; k++) {
          const spark = document.createElement("span");
          spark.className = "sugar-swamp-spark";
          spark.style.setProperty("--spark-angle", `${k * 45}deg`);
          spark.style.setProperty("--spark-distance", `${38 + k % 3 * 9}px`);
          spark.style.setProperty("--spark-delay", `${k * 24}ms`);
          swirl.appendChild(spark);
        }
        nodeCount++;
      }
      remember({
        type: event.type,
        sequenceId: event.vfxSequenceId || null,
        targetCount: (event.targetUids || []).length,
        nodeCount,
        layoutEpoch: snapshot.layoutEpoch,
        source: snapshot.source,
        targets: snapshot.targets,
        scheduled: !!event.scheduled,
        stageIndex: Number(event.stageIndex || 0),
        at: performance.now(),
        failed: false
      });
      return nodeCount > 0;
    };
    const playLeafBlade = (event, overlay, snapshot) => {
      const targetUid = String(event.targetInstanceId || event.targetUid || ""),
        target = snapshot.targets?.[targetUid],
        hitCount = Math.max(0, Math.trunc(Number(event.hitCount || 0)));
      if (!target || !hitCount) return false;
      const dx = target.x - snapshot.source.x,
        dy = target.y - snapshot.source.y,
        cardScale = Math.max(20, Math.min(38, Math.min(snapshot.source.width, snapshot.source.height) * .22));
      for (let k = 0; k < hitCount; k++) {
        const blade = visualNode(overlay, "leaf-blade-projectile", "", 920 + k * 90);
        if (!blade) continue;
        positionFx(blade, snapshot.source);
        const curve = (k % 2 ? 1 : -1) * (32 + k % 3 * 12);
        blade.style.setProperty("--leaf-size", `${cardScale}px`);
        blade.style.setProperty("--leaf-dx", `${dx}px`);
        blade.style.setProperty("--leaf-dy", `${dy}px`);
        blade.style.setProperty("--leaf-mid-x", `${dx * .5 - (dy === 0 ? 0 : Math.sign(dy)) * curve}px`);
        blade.style.setProperty("--leaf-mid-y", `${dy * .5 + (dx === 0 ? 0 : Math.sign(dx)) * curve}px`);
        blade.style.setProperty("--leaf-delay", `${k * 86}ms`);
        blade.style.setProperty("--leaf-rotation", `${420 + (k % 2 ? 1 : -1) * 70 + k * 24}deg`);
        blade.dataset.vfxSequenceId = event.vfxSequenceId || "";
        blade.dataset.hitIndex = String(k + 1);
        blade.dataset.targetInstanceId = targetUid;
        const impact = visualNode(overlay, "leaf-blade-impact", "", 980 + k * 90);
        if (impact) {
          positionFx(impact, target);
          impact.style.setProperty("--leaf-delay", `${430 + k * 86}ms`);
          impact.dataset.vfxSequenceId = event.vfxSequenceId || "";
          impact.dataset.hitIndex = String(k + 1);
        }
      }
      remember({
        type: event.type,
        sequenceId: event.vfxSequenceId || null,
        targetCount: 1,
        projectileCount: hitCount,
        canonicalHitCount: hitCount,
        projectileSize: cardScale,
        layoutEpoch: snapshot.layoutEpoch,
        source: snapshot.source,
        targets: snapshot.targets,
        canonicalRngDelta: 0,
        at: performance.now(),
        failed: false
      });
      return true;
    };
    const play = event => {
      if (!event || !["lunaShard", "sugarSwamp", "leafBlade"].includes(event.type)) return false;
      const sourceIndependent = event.type === "lunaShard",
        resolved = resolve(event, {
          requireSource: !sourceIndependent
        });
      if (!resolved) return fail(event, sourceIndependent ? "target field or target rendered anchor unavailable" : "source or target rendered anchor unavailable");
      const {
          overlay,
          snapshot
        } = resolved,
        expectedTargets = (event.targetUids || [event.targetInstanceId || event.targetUid]).filter(Boolean).map(String);
      if (!expectedTargets.length || expectedTargets.some(uid => !snapshot.targets?.[uid])) return fail(event, "one or more target anchors unavailable");
      if (event.type === "lunaShard") return playLunaShard(event, overlay, snapshot);
      if (event.type === "sugarSwamp") return playSugarSwamp(event, overlay, snapshot);
      return playLeafBlade(event, overlay, snapshot);
    };
    return Object.freeze({
      play
    });
  })();
}
export function playVisualsCoreBase() {
  if (typeof systems.ActionFaultInjector === "object") {
    try {
      systems.ActionFaultInjector.hit("vfx-before");
    } catch (error) {
      systems.PresentationFailureChannel?.emit?.({
        surface: "vfx",
        phase: "vfx-before",
        error: String(error),
        battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
        revision: Number(state_ui_battle_state.game?.networkRevision || 0)
      });
      queueMicrotask(() => systems.LifecycleManager?.continuity?.authoritativeSettled?.({
        reason: "presentation-failure",
        surface: "vfx"
      }));
      throw error;
    }
  }
  let events = state_ui_battle_state.visualEvents.splice(0),
    notices = events.filter(v => v.type === "combatNotice");
  if (false) {
    notices.forEach((v, i) => systems.TimerManager.setTimeout(() => showCombatNotice(v), i * 90));
    events.forEach((v, i) => playInstantUnitPopup(v, i * 90));
    state_ui_battle_state.visualHoldMs = 0;
    return;
  }
  state_ui_battle_state.visualHoldMs = events.some(v => v.type === "mutualEnergyTrade") ? 2300 : events.some(v => v.type === "eruptionFx") ? 2200 : events.some(v => v.type === "huveEarthquake") ? 2100 : events.some(v => v.type === "mysticBurst") ? 1900 : 0;
  events.forEach((v, i) => systems.TimerManager.setTimeout(() => {
    let arena = document.querySelector(".arena");
    if (v.type === "combatNotice") {
      showCombatNotice(v);
      return;
    }
    if (v.type === "horizonStrike") {
      const associated = events.filter(item => item !== v && item?.vfxSequenceId && item.vfxSequenceId === v.vfxSequenceId);
      state_presentation_animations.HorizonStrikeSequenceOwner.play(v, associated);
      return;
    }
    if (v.vfxSequenceId && events.some(item => item?.type === "horizonStrike" && item.vfxSequenceId === v.vfxSequenceId)) return;
    if (["lunaShard", "sugarSwamp", "leafBlade"].includes(v.type)) {
      state_presentation_animations.DynamicSkillVfxPresentationOwner.play(v);
      return;
    }
    if (v.type === "eruptionFx") {
      const actorEl = state_presentation_coordinates.battleEntityElement(v.uid),
        targetEl = v.targetUid ? state_presentation_coordinates.battleEntityElement(v.targetUid) : actorEl;
      if (!arena || !actorEl || !targetEl) return;
      const from = state_presentation_coordinates.VfxCoordinateOwner.point(arena, actorEl),
        to = state_presentation_coordinates.VfxCoordinateOwner.point(arena, targetEl);
      arena.classList.remove("eruption-shake");
      void arena.offsetWidth;
      arena.classList.add("eruption-shake");
      systems.TimerManager.setTimeout(() => arena.classList.remove("eruption-shake"), 1250);
      let label = visualNode(arena, "skill-fx-label eruption-label", v.skillName, 1250);
      positionFx(label, from);
      label?.style.setProperty("--fx-color", v.boosted ? "#fff06a" : "#ff6a24");
      let cast = visualNode(arena, "eruption-cast", "", 1150);
      positionFx(cast, from);
      let flash = visualNode(arena, `eruption-screen-flash${v.boosted ? " boosted" : ""}`, "", 1250);
      let fissure = visualNode(arena, `eruption-fissure${v.boosted ? " boosted" : ""}`, "", 1850);
      positionFx(fissure, to);
      let shock = visualNode(arena, "eruption-shockwave", "", 1200);
      positionFx(shock, to);
      const columns = v.boosted ? [-78, -50, -23, 0, 24, 51, 78] : [-62, -31, 0, 32, 63];
      columns.forEach((offset, k) => {
        let col = visualNode(arena, `eruption-column${k === Math.floor(columns.length / 2) ? " main" : ""}`, "", 2050);
        positionFx(col, to);
        col?.style.setProperty("--column-x", `${offset}px`);
        col?.style.setProperty("--column-h", `${150 + k % 3 * 42 + (v.boosted ? 35 : 0)}px`);
        col?.style.setProperty("--column-w", `${42 + k % 2 * 18}px`);
        col?.style.setProperty("--column-lean", `${(k - columns.length / 2) * 4}deg`);
        if (col) col.style.animationDelay = `${170 + k * 55}ms`;
      });
      const rockCount = v.boosted ? 20 : 14;
      for (let k = 0; k < rockCount; k++) {
        let rock = visualNode(arena, "eruption-rock", "", 1900);
        positionFx(rock, to);
        const side = k % 2 ? 1 : -1;
        rock?.style.setProperty("--rock-size", `${8 + k % 4 * 4}px`);
        rock?.style.setProperty("--rock-dx", `${side * (48 + k * 19 % 105)}px`);
        rock?.style.setProperty("--rock-dy", `${-95 - k * 23 % 125}px`);
        rock?.style.setProperty("--rock-spin", `${side * (180 + k * 41)}deg`);
        if (rock) rock.style.animationDelay = `${230 + k * 34}ms`;
      }
      const ashCount = v.boosted ? 11 : 8;
      for (let k = 0; k < ashCount; k++) {
        let ash = visualNode(arena, "eruption-ash", "", 2250);
        positionFx(ash, to);
        ash?.style.setProperty("--ash-x", `${(k % 2 ? 1 : -1) * (18 + k * 27 % 82)}px`);
        ash?.style.setProperty("--ash-y", `${-55 - k * 31 % 95}px`);
        ash?.style.setProperty("--ash-size", `${38 + k % 4 * 15}px`);
        if (ash) ash.style.animationDelay = `${420 + k * 75}ms`;
      }
      if (v.boosted) {
        systems.TimerManager.setTimeout(() => {
          let surge = visualNode(arena, "eruption-surge", "", 1050);
          positionFx(surge, to);
          visualNode(targetEl, "float-num eruption-boost-text", "강화 분화!", 1050);
        }, 500);
      }
      return;
    }
    if (v.type === "marineSkillFx") {
      const actorEl = state_presentation_coordinates.battleEntityElement(v.uid),
        targetEl = v.targetUid ? state_presentation_coordinates.battleEntityElement(v.targetUid) : actorEl;
      if (!arena || !actorEl) return;
      const from = state_presentation_coordinates.VfxCoordinateOwner.point(arena, actorEl),
        to = state_presentation_coordinates.VfxCoordinateOwner.point(arena, targetEl || actorEl);
      if (!from || !to) return;
      const theme = String(v.theme || "waterSplash"),
        water = /jetski|water|whirlpool|wave|aqua|towering|captain/i.test(theme),
        ice = /ice|freeze/i.test(theme),
        poison = /poison|blood|shuvi/i.test(theme),
        wind = /gale|glide|dodge/i.test(theme),
        axe = /axe/i.test(theme),
        critical = /critical/i.test(theme);
      const color = critical ? "#ffe56f" : ice ? "#9ff6ff" : poison ? theme === "bloodSuck" ? "#ff4b77" : "#9dff69" : wind ? "#d9fff2" : axe ? "#ffb85f" : "#5fdcff";
      const point = v.phase === "impact" ? to : from;
      const label = visualNode(arena, "marine-fx-label", v.skillName || "", 980);
      positionFx(label, point);
      label?.style.setProperty("--marine-color", color);
      const core = visualNode(arena, "marine-fx-core", "", 880);
      positionFx(core, point);
      core?.style.setProperty("--marine-color", color);
      const ringCount = /whirlpool|aquaTornado|jetskiDive|glide|dodge|irumaHealingSplash|critical/i.test(theme) ? 3 : 1;
      for (let r = 0; r < ringCount; r++) {
        const ring = visualNode(arena, "marine-fx-ring", "", 1050);
        positionFx(ring, point);
        ring?.style.setProperty("--marine-color", color);
        if (ring) ring.style.animationDelay = `${r * 95}ms`;
      }
      const shouldBeam = /jetskiBoost|waterBite|waterSplash|waveRide|captainSurf|freezeBeam|bloodSuck/i.test(theme) && v.phase !== "impact";
      if (shouldBeam) {
        const dx = to.x - from.x,
          dy = to.y - from.y,
          beam = visualNode(arena, "marine-fx-beam", "", 850);
        beam?.style.setProperty("--from-x", `${from.x}px`);
        beam?.style.setProperty("--from-y", `${from.y}px`);
        beam?.style.setProperty("--beam-length", `${Math.max(28, Math.hypot(dx, dy))}px`);
        beam?.style.setProperty("--beam-angle", `${Math.atan2(dy, dx)}rad`);
        beam?.style.setProperty("--marine-color", color);
      }
      if (/galeSlash|poisonTail|axeChop|galeGlide|shuviGlide|critical/i.test(theme)) {
        for (const angle of axe ? [-58, 58] : [-28, 24]) {
          const cut = visualNode(arena, "marine-fx-slice", "", 760);
          positionFx(cut, to);
          cut?.style.setProperty("--slice-angle", `${angle}deg`);
          cut?.style.setProperty("--marine-color", color);
        }
      }
      if (/toweringSplash|aquaTornado/i.test(theme) || v.phase === "impact" && /jetskiDive/i.test(theme)) {
        const column = visualNode(arena, "marine-fx-column", "", 1050);
        positionFx(column, to);
        column?.style.setProperty("--marine-color", color);
      }
      const particles = /towering|aquaTornado|whirlpool/.test(theme) ? 18 : /freeze|ice/.test(theme) ? 14 : 10;
      for (let k = 0; k < particles; k++) {
        const p = visualNode(arena, "marine-fx-particle", "", 1150);
        positionFx(p, point);
        p?.style.setProperty("--marine-color", color);
        p?.style.setProperty("--particle-size", `${5 + k % 4 * 3}px`);
        const ang = Math.PI * 2 * k / particles + k % 3 * .17,
          rad = 38 + k % 5 * 14;
        p?.style.setProperty("--particle-x", `${Math.cos(ang) * rad}px`);
        p?.style.setProperty("--particle-y", `${Math.sin(ang) * rad - 28}px`);
        p?.style.setProperty("--particle-delay", `${k * 28}ms`);
      }
      return;
    }
    if (v.type === "skillFx") {
      const snapshot = state_presentation_coordinates.VfxCoordinateOwner.resolveEvent(v);
      if (!arena || !snapshot) return;
      const from = snapshot.source,
        to = snapshot.targets?.[v.targetUid] || from;
      if (!from || !to) return;
      const palettes = {
        heal: "#55f0a6",
        shield: "#6fd6ff",
        status: "#b56cff",
        energy: "#ffe16a",
        slash: "#ff6688",
        projectile: "#62cfff",
        impact: "#ff9b55",
        magic: "#d88cff"
      };
      const color = palettes[v.kind] || palettes.magic;
      let cast = visualNode(arena, "skill-fx-cast", "", 620);
      positionFx(cast, from);
      cast?.style.setProperty("--fx-color", color);
      let label = visualNode(arena, "skill-fx-label", v.skillName, 820);
      positionFx(label, from);
      label?.style.setProperty("--fx-color", color);
      systems.TimerManager.setTimeout(() => {
        if (v.kind === "projectile" || v.targetUid && v.kind === "magic") {
          let p = visualNode(arena, "skill-fx-projectile", "", 500);
          if (p) {
            p.style.setProperty("--from-x", `${from.x}px`);
            p.style.setProperty("--from-y", `${from.y}px`);
            p.style.setProperty("--to-x", `${to.x}px`);
            p.style.setProperty("--to-y", `${to.y}px`);
            p.style.setProperty("--angle", `${Math.atan2(to.y - from.y, to.x - from.x)}rad`);
            p.style.setProperty("--fx-color", color);
          }
        }
        if (v.kind === "slash") {
          for (const a of [-24, 20]) {
            let n = visualNode(arena, "skill-fx-slash", "", 520);
            positionFx(n, to);
            n?.style.setProperty("--slash-angle", `${a}deg`);
            n?.style.setProperty("--fx-color", color);
          }
        } else if (["heal", "shield", "status", "energy"].includes(v.kind)) {
          let r = visualNode(arena, "skill-fx-ring", "", 760);
          positionFx(r, to);
          r?.style.setProperty("--fx-color", color);
          let icon = visualNode(arena, "skill-fx-status", v.kind === "heal" ? "✚" : v.kind === "shield" ? "⬡" : v.kind === "energy" ? "⚡" : "✦", 900);
          positionFx(icon, to);
          icon?.style.setProperty("--fx-color", color);
        } else {
          let hit = visualNode(arena, "skill-fx-impact", "", 650);
          positionFx(hit, to);
          hit?.style.setProperty("--fx-color", color);
        }
      }, 180);
      return;
    }
    if (v.type === "lifeRainFx") {
      if (!arena) return;
      const curtain = visualNode(arena, "liferain-curtain", "", 1700);
      visualNode(curtain, "liferain-mist", "", 1650);
      for (let k = 0; k < 28; k++) {
        const drop = visualNode(curtain, "liferain-drop", "", 1750);
        drop?.style.setProperty("--drop-x", `${3 + k * 37 % 94}%`);
        drop?.style.setProperty("--drop-len", `${34 + k % 5 * 13}px`);
        drop?.style.setProperty("--drop-time", `${620 + k % 6 * 85}ms`);
        drop?.style.setProperty("--drop-lean", `${-14 + k % 4 * 4}deg`);
        drop?.style.setProperty("--delay", `${k % 9 * 55}ms`);
      }
      for (const uid of v.allyUids || []) {
        const el = state_presentation_coordinates.battleEntityElement(uid);
        if (!el) continue;
        const pt = state_presentation_coordinates.VfxCoordinateOwner.point(arena, el),
          pulse = visualNode(arena, "liferain-pulse", "", 1250);
        positionFx(pulse, pt);
        pulse?.style.setProperty("--rain-color", "#65efbd");
        visualNode(el, "float-num heal", "생명비", 950);
      }
      for (const uid of v.enemyUids || []) {
        const el = state_presentation_coordinates.battleEntityElement(uid);
        if (!el) continue;
        const pt = state_presentation_coordinates.VfxCoordinateOwner.point(arena, el),
          pulse = visualNode(arena, "liferain-pulse", "", 1250);
        positionFx(pulse, pt);
        pulse?.style.setProperty("--rain-color", "#527eae");
        pulse?.style.setProperty("--delay", "120ms");
      }
      return;
    }
    if (["deepTrioFx", "deepMindHeal", "deepMindChip", "vortexSwapFx"].includes(v.type)) {
      const actorEl = state_presentation_coordinates.battleEntityElement(v.uid),
        targetEl = v.targetUid ? state_presentation_coordinates.battleEntityElement(v.targetUid) : actorEl;
      if (!arena || !actorEl) return;
      const from = state_presentation_coordinates.VfxCoordinateOwner.point(arena, actorEl),
        to = state_presentation_coordinates.VfxCoordinateOwner.point(arena, targetEl || actorEl);
      if (v.type === "deepMindHeal") {
        visualNode(targetEl, "float-num deepmind-heal", `+${v.amount || 10}`, 900);
        return;
      }
      if (v.type === "deepMindChip") {
        let chip = visualNode(arena, "abigate-energy-chip", `${v.color || ""}½`, 900);
        positionFx(chip, to);
        return;
      }
      if (v.type === "vortexSwapFx") {
        let sw = visualNode(arena, "abigate-vortex-fx", `색 교환 ${v.swaps || 0}`, 1200);
        positionFx(sw, from);
        return;
      }
      if (actionSkillHasEffect(v, "groundZero")) {
        arena.classList.remove("groundzero-shake");
        void arena.offsetWidth;
        arena.classList.add("groundzero-shake");
        systems.TimerManager.setTimeout(() => arena.classList.remove("groundzero-shake"), 760);
        const core = visualNode(arena, "tox-gz-core", "", 1200);
        positionFx(core, to);
        for (let r = 0; r < 3; r++) {
          const ring = visualNode(arena, "tox-gz-ring", "", 1400);
          positionFx(ring, to);
          ring?.style.setProperty("--delay", `${r * 105}ms`);
        }
        for (let k = 0; k < 12; k++) {
          const d = visualNode(arena, "tox-gz-dust", "", 1450);
          positionFx(d, to);
          d?.style.setProperty("--dust-size", `${7 + k % 4 * 3}px`);
          d?.style.setProperty("--dust-x", `${Math.cos(k * Math.PI / 6) * (55 + k % 3 * 17)}px`);
          d?.style.setProperty("--dust-y", `${Math.sin(k * Math.PI / 6) * (42 + k % 4 * 12)}px`);
          d?.style.setProperty("--delay", `${80 + k * 24}ms`);
        }
        visualNode(targetEl, "float-num status-pop", "폭심", 900);
        if (v.secondaryUid) {
          const secondEl = state_presentation_coordinates.battleEntityElement(v.secondaryUid);
          if (secondEl) {
            const second = state_presentation_coordinates.VfxCoordinateOwner.point(arena, secondEl),
              dx = second.x - to.x,
              dy = second.y - to.y;
            const link = visualNode(arena, "tox-gz-link", "", 900);
            link?.style.setProperty("--from-x", `${to.x}px`);
            link?.style.setProperty("--from-y", `${to.y}px`);
            link?.style.setProperty("--beam-length", `${Math.hypot(dx, dy)}px`);
            link?.style.setProperty("--beam-angle", `${Math.atan2(dy, dx)}rad`);
            const burn = visualNode(arena, "tox-gz-burn", "", 1750);
            positionFx(burn, second);
            systems.TimerManager.setTimeout(() => visualNode(secondEl, "float-num status-pop", "화상 4", 1000), 320);
          }
        }
        return;
      }
      if (actionSkillHasEffect(v, "eternaHeal")) {
        for (let k = 0; k < 10; k++) {
          const mote = visualNode(arena, "eterna-gather-mote", "", 1100);
          positionFx(mote, to);
          const ang = Math.PI * 2 * k / 10 + k % 2 * .18,
            rad = 48 + k % 4 * 16;
          mote?.style.setProperty("--mote-x", `${Math.cos(ang) * rad}px`);
          mote?.style.setProperty("--mote-y", `${Math.sin(ang) * rad}px`);
          mote?.style.setProperty("--mote-size", `${7 + k % 3 * 3}px`);
          mote?.style.setProperty("--delay", `${k * 32}ms`);
        }
        systems.TimerManager.setTimeout(() => {
          const core = visualNode(arena, "eterna-burst-core", "", 1050);
          positionFx(core, to);
          const ring = visualNode(arena, "eterna-burst-ring", "", 1050);
          positionFx(ring, to);
        }, 420);
        systems.TimerManager.setTimeout(() => {
          for (const result of v.healResults || []) {
            const allyEl = state_presentation_coordinates.battleEntityElement(result.uid);
            if (!allyEl) continue;
            const dest = state_presentation_coordinates.VfxCoordinateOwner.point(arena, allyEl),
              count = Math.max(2, Math.min(6, Math.ceil((result.amount || 1) / 18)));
            for (let q = 0; q < count; q++) {
              const stream = visualNode(arena, "eterna-heal-stream", "", 1450);
              stream?.style.setProperty("--from-x", `${to.x}px`);
              stream?.style.setProperty("--from-y", `${to.y}px`);
              stream?.style.setProperty("--to-x", `${dest.x + (q - (count - 1) / 2) * 8}px`);
              stream?.style.setProperty("--to-y", `${dest.y + (q % 2 ? 7 : -7)}px`);
              stream?.style.setProperty("--delay", `${q * 65}ms`);
              stream?.style.setProperty("--travel-time", `${650 + q * 40}ms`);
            }
            systems.TimerManager.setTimeout(() => {
              const arr = visualNode(arena, "eterna-heal-arrival", "", 900);
              positionFx(arr, dest);
              visualNode(allyEl, "float-num heal", `+${Math.round(result.amount || 0)}`, 900);
            }, 620);
          }
          if (v.rTargetUid) {
            const rEl = state_presentation_coordinates.battleEntityElement(v.rTargetUid);
            if (rEl) systems.TimerManager.setTimeout(() => visualNode(rEl, "float-num status-pop", "R +1", 900), 780);
          }
        }, 520);
        return;
      }
      if (actionSkillHasEffect(v, "abyssCannon")) {
        arena.classList.remove("abigate-infrasound-shake");
        void arena.offsetWidth;
        arena.classList.add("abigate-infrasound-shake");
        targetEl?.classList.remove("abigate-target-vibrate");
        void targetEl?.offsetWidth;
        targetEl?.classList.add("abigate-target-vibrate");
        systems.TimerManager.setTimeout(() => {
          arena.classList.remove("abigate-infrasound-shake");
          targetEl?.classList.remove("abigate-target-vibrate");
        }, 900);
        const core = visualNode(arena, "abigate-low-core", "", 1200);
        positionFx(core, to);
        const dx = to.x - from.x,
          dy = to.y - from.y,
          len = Math.max(1, Math.hypot(dx, dy)),
          ang = Math.atan2(dy, dx),
          waves = 5 + Math.max(0, Number(v.n) || 0);
        for (let w = 0; w < waves; w++) {
          const wave = visualNode(arena, "abigate-wave-path", "", 1450);
          wave?.style.setProperty("--from-x", `${from.x}px`);
          wave?.style.setProperty("--from-y", `${from.y - 12 + w * 3}px`);
          wave?.style.setProperty("--beam-length", `${len}px`);
          wave?.style.setProperty("--beam-angle", `${ang}rad`);
          wave?.style.setProperty("--wave-height", `${15 + w * 4}px`);
          wave?.style.setProperty("--wave-width", `${1 + w % 3}px`);
          wave?.style.setProperty("--wave-blur", `${w % 2}px`);
          wave?.style.setProperty("--wave-time", `${560 + w * 42}ms`);
          wave?.style.setProperty("--delay", `${w * 42}ms`);
        }
        if (v.poison) {
          const colors = ["#ff405c", "#ecf4ff", "#151515"];
          colors.forEach((c, k) => {
            const m = visualNode(arena, "abigate-rwb-mote", "", 900);
            positionFx(m, to);
            m?.style.setProperty("--mote-color", c);
            m?.style.setProperty("--mote-x", `${(k - 1) * 48}px`);
            m?.style.setProperty("--mote-y", `${k === 1 ? -42 : 26}px`);
            m?.style.setProperty("--delay", `${240 + k * 50}ms`);
          });
          systems.TimerManager.setTimeout(() => {
            const ring = visualNode(arena, "abigate-poison-ring", "", 1250);
            positionFx(ring, to);
            visualNode(targetEl, "float-num status-pop", "독", 900);
          }, 520);
        }
        return;
      }
      const cls = `deeptrio-fx ${v.skill || ""}`;
      let node = visualNode(arena, cls, "", 1400);
      positionFx(node, to);
      if (actionSkillHasEffect(v, "suctionPad")) {
        let r = visualNode(arena, "eterna-r-rise", "R", 1000);
        positionFx(r, to);
        if (v.allied) visualNode(targetEl, "float-num direct-hp", "-20", 900);
      } else if (actionSkillHasEffect(v, "toxiousUnseal")) visualNode(actorEl, "float-num direct-hp", "-20", 900);
      return;
    }
    if (v.type === "grandWave") {
      visualNode(arena, "grand-wave", "", 950);
      return;
    }
    if (v.type === "bloomField") {
      let fx = document.createElement("div");
      fx.className = "bloom-field-fx";
      arena?.appendChild(fx);
      systems.TimerManager.setTimeout(() => fx.remove(), 1100);
      return;
    }
    if (v.type === "huveEarthquake") {
      arena?.classList.remove("hube-quake-shake");
      void arena?.offsetWidth;
      arena?.classList.add("hube-quake-shake");
      for (let k = 0; k < 22; k++) {
        let dust = visualNode(arena, "hube-quake-dust", "", 2200);
        dust?.style.setProperty("--dust-x", `${k * 31 % 94}%`);
        dust?.style.setProperty("--dust-size", `${85 + k % 4 * 28}px`);
        dust?.style.setProperty("--dust-drift", `${(k % 2 ? -1 : 1) * (18 + k)}px`);
        if (dust) dust.style.animationDelay = `${k * 45}ms`;
      }
      for (const x of v.removed || []) {
        let el = document.querySelector(`.card[data-uid="${x.uid}"]`);
        let collapse = visualNode(arena, "hube-energy-collapse", "", 1600);
        positionFx(collapse, state_presentation_coordinates.VfxCoordinateOwner.point(arena, el));
        visualNode(el, "float-num energy-break", `E -${x.amount}`, 900);
      }
      return;
    }
    if (["damage", "directHp"].includes(v.type)) {
      playInstantUnitPopup(v);
      return;
    }
    let el = battlefieldCardForUid(state_ui_battle_state.game, v.recipientEntityId || v.uid),
      target = v.targetUid && battlefieldCardForUid(state_ui_battle_state.game, v.targetUid),
      actorPoint = state_presentation_coordinates.VfxCoordinateOwner.point(arena, el),
      targetPoint = target ? state_presentation_coordinates.VfxCoordinateOwner.point(arena, target) : actorPoint;
    if (!actorPoint || !targetPoint) return;
    if (v.type === "mysticBurst") {
      let core = visualNode(arena, "hube-mystic-core", "", 1500);
      positionFx(core, actorPoint);
      let colors = ["R", "W", "B"];
      for (let n = 0; n < (v.extraR || 0); n++) colors.push("R");
      for (let n = 0; n < (v.extraW || 0); n++) colors.push("W");
      for (let n = 0; n < (v.extraB || 0); n++) colors.push("B");
      colors.forEach((color, k) => {
        let cloud = visualNode(arena, `hube-mystic-cloud ${color}`, "", 2100);
        positionFx(cloud, targetPoint);
        cloud?.style.setProperty("--cloud-x", `${(k % 3 - 1) * 34}px`);
        cloud?.style.setProperty("--cloud-y", `${(k % 2 ? 1 : -1) * 18}px`);
        cloud?.style.setProperty("--cloud-rot", `${k * 29 - 40}deg`);
        if (cloud) cloud.style.animationDelay = `${k * 95}ms`;
      });
      if (v.extraR) visualNode(target, "float-num damage", `+${30 * v.extraR}D`, 900);
      if (v.extraW) visualNode(el, `float-num ${v.healBlocked ? "direct-hp" : "heal"}`, v.healBlocked ? "회복 봉인" : `HP +${v.healed}`, 900);
      (v.rolls || []).forEach((r, j) => systems.TimerManager.setTimeout(() => visualNode(target, "float-num status-pop", r.ok ? `${state_engine_entities.STATUS[r.status]} 2` : "무효", 900), j * 110));
      return;
    }
    if (v.type === "mutualEnergyTrade") {
      let targetRocks = Math.max(3, 3 + Math.ceil(v.amount * 2)),
        selfRocks = Math.ceil(v.amount * 1.5),
        dropRocks = (point, count, offset = 0) => {
          for (let k = 0; k < count; k++) {
            let rock = visualNode(arena, "hube-smack-rock", "", 2400);
            rock?.style.setProperty("--rock-x", `${point.left + 10 + (k * 37 + offset) % Math.max(30, point.width - 36)}px`);
            rock?.style.setProperty("--rock-y", `${point.y}px`);
            rock?.style.setProperty("--rock-size", `${64 + k % 3 * 20}px`);
            rock?.style.setProperty("--rock-rot", `${k * 31 - 25}deg`);
            if (rock) rock.style.animationDelay = `${k * 145}ms`;
          }
        };
      dropRocks(targetPoint, targetRocks);
      dropRocks(actorPoint, selfRocks, 17);
      visualNode(target, "float-num energy-break", `에너지 ${v.amount} 제거`, 1000);
      systems.TimerManager.setTimeout(() => {
        let crackAt = point => {
          let crack = visualNode(arena, "hube-smack-hp-crack", "", 900);
          crack?.style.setProperty("--fx-left", `${point.left}px`);
          crack?.style.setProperty("--fx-width", `${point.width}px`);
          crack?.style.setProperty("--fx-y", `${point.y - 45}px`);
        };
        if (v.selfLoss) crackAt(actorPoint);
        if (v.enemyLoss) crackAt(targetPoint);
        if (Number(v.selfTotal || 0) > 0) visualNode(el, "float-num damage", `-${combatInt(v.selfTotal)}`, 900);
        if (Number(v.enemyTotal || 0) > 0) visualNode(target, "float-num damage", `-${combatInt(v.enemyTotal)}`, 900);
      }, 180);
      return;
    }
    if (!el) return;
    if (v.type === "bloomHalf" || v.type === "bloomBurst") {
      let f = document.createElement("span");
      f.className = `flower-hit ${v.type === "bloomBurst" ? "burst" : ""}`;
      f.textContent = "✿";
      el.appendChild(f);
      if (v.type === "bloomBurst") {
        el.classList.remove("hit-flash");
        void el.offsetWidth;
        el.classList.add("hit-flash");
      }
      systems.TimerManager.setTimeout(() => f.remove(), 1000);
      return;
    }
    playInstantUnitPopup(v);
  }, i * 130));
}
export function playVisualsCanonical() {
  const visualGame = state_ui_battle_state.game;
  // Canonical visual dispatcher: custom event families are peeled once, then the base renderer runs once.
  const clocks = [],
    hypers = [],
    recalls = [],
    timeRest = [];
  for (const v of state_ui_battle_state.visualEvents) {
    if (v?.type === "timeClockRotationFx") clocks.push(v);else if (v?.type === "hyperClockFx") hypers.push(v);else if (v?.type === "timeRecallFx") recalls.push(v);else if (!(v?.type === "skillFx" && ["하이퍼클락", "타임리콜"].includes(v.skillName))) timeRest.push(v);
  }
  state_ui_battle_state.visualEvents = timeRest;
  if (clocks.length) timeSetInputLock(true, true);
  const tracked = timeTrackVisualTimers(() => {
    const geno = [],
      elixian = [],
      fox = [],
      jc = [],
      rest = [];
    const jcTypes = new Set(["jcVineFx", "jcSummonFx", "jcSummonAction", "circuitRoundFx", "circuitArmsFx", "voltagePrepareFx", "voltageFailFx", "voltageBurstFx"]);
    for (const v of state_ui_battle_state.visualEvents) {
      if (["genociderAbsorbFx", "genociderClawFx", "genociderExplosionFx"].includes(v?.type)) geno.push(v);else if (v?.type === "elixianPulseFx") elixian.push(v);else if (v?.type === "foxStrikeFx") fox.push(v);else if (v?.type === "deepTrioFx" && actionSkillHasEffect(v, "groundZero")) jc.push({
        ...v,
        type: "groundZeroDelayed"
      });else if (jcTypes.has(v?.type)) jc.push(v);else rest.push(v);
    }
    state_ui_battle_state.visualEvents = rest;
    geno.forEach((v, i) => systems.TimerManager.setTimeout(() => playGenociderVisual(v), i * 90));
    for (const e of elixian) {
      const fx = document.createElement("div");
      fx.className = "elixian-pulse-fx";
      document.body.appendChild(fx);
      systems.TimerManager.setTimeout(() => fx.remove(), 760);
    }
    fox.forEach((v, i) => systems.TimerManager.setTimeout(() => playFoxStrikeVisual(v), i * 70));
    jc.forEach((v, i) => systems.TimerManager.setTimeout(() => playJcVisual(v), i * 70));
    const r = playVisualsCoreBase();
    if (geno.length) state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 1050);
    if (fox.length) state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 1100);
    if (jc.some(v => v.type === "groundZeroDelayed")) state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 2100);else if (jc.length) state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 1250);
    const extras = [...hypers.map(timePlayHyperVisual), ...recalls.map(timePlayRecallVisual)];
    return {
      r,
      extras
    };
  });
  const extras = tracked.result?.extras || [];
  if (clocks.length) {
    state_ui_battle_state.visualHoldMs = Math.max(state_ui_battle_state.visualHoldMs, 4200);
    state_features_timeora.timeVisualChain = state_features_timeora.timeVisualChain.then(() => Promise.allSettled([tracked.done, ...extras])).then(() => {
      if (state_ui_battle_state.game?.battleId !== visualGame?.battleId) return;
      timeSetInputLock(true, true);
      return timePlayClockRotationOverlay(clocks);
    }).finally(() => {
      if (state_ui_battle_state.game?.battleId !== visualGame?.battleId) return;
      timeSetInputLock(false);
      timeMarkTimeline(state_ui_battle_state.game, "clockLockReleased");
      const advanced = state_ui_battle_state.game === visualGame && timeCommitPendingTurnAdvance(visualGame);
      try {
        if (advanced && typeof afterAction === "function") afterAction();else render();
      } catch (error) {
        systems.__megaRecordRecoveredError(error, "playVisuals.clock-finalize");
      }
      if (!advanced) {
        try {
          scheduleAI();
        } catch (error) {
          systems.__megaRecordRecoveredError(error, "playVisuals.scheduleAI");
        }
      }
    });
  }
  return tracked.result?.r;
}
export function playVisuals(...args) {
  return bossPlayVisuals.apply(this, args);
}
