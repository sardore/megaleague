// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_presentation_audio = {
  gameSfx: undefined,
  PresentationAudioOwner: undefined
};
import { dmBattleInstanceId, dmCleanDisplayText, dmDebug, state_features_dragon_memory } from "../features/dragon-memory.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
export function queueCombatNotice(g, recipient, text, kind = "effect", meta = {}) {
  if (!g || typeof state_ui_battle_state.game === "undefined" || g !== state_ui_battle_state.game || !recipient?.uid || !Array.isArray(state_ui_battle_state.visualEvents)) return;
  meta = meta && typeof meta === "object" ? meta : {};
  const clean = dmCleanDisplayText(text);
  if (!clean) return;
  const actionId = String(meta.actionId || state_features_dragon_memory.dmCurrentActionContext?.actionId || `${dmBattleInstanceId(g)}:passive:${g.turnSerial || 0}`);
  const sourceEntityId = meta.sourceEntityId || state_features_dragon_memory.dmCurrentActionContext?.sourceEntityId || null;
  const recipientEntityId = String(recipient.uid);
  const effectEventId = String(meta.effectEventId || `${dmBattleInstanceId(g)}:${actionId}:${recipientEntityId}:${kind}:${++state_features_dragon_memory.dmEffectSerial}`);
  const event = {
    type: "combatNotice",
    effectEventId,
    battleInstanceId: dmBattleInstanceId(g),
    actionId,
    sourceEntityId,
    recipientEntityId,
    uid: recipientEntityId,
    effectType: kind,
    displayText: clean,
    text: clean,
    stackAmount: Number(meta.stackAmount || 0),
    duration: Number(meta.duration || 0),
    createdAt: Date.now(),
    kind
  };
  state_ui_battle_state.visualEvents.push(event);
  dmDebug("effect-queued", event);
}
export function queueNoticeFromLog() {}
export function initializePresentationAudio() {
  state_presentation_audio.gameSfx = {
    ctx: null,
    master: null,
    enabled: true,
    unlocked: false,
    last: Object.create(null)
  };
  state_presentation_audio.PresentationAudioOwner = Object.freeze({
    play(kind) {
      if (typeof systems.ActionFaultInjector === "object") {
        try {
          systems.ActionFaultInjector.hit("audio-before");
        } catch (error) {
          systems.PresentationFailureChannel?.emit?.({
            surface: "audio",
            phase: "audio-before",
            error: String(error),
            battleId: state_ui_battle_state.game?.battleId || state_ui_battle_state.game?.matchId || null,
            revision: Number(state_ui_battle_state.game?.networkRevision || 0)
          });
          queueMicrotask(() => systems.LifecycleManager?.continuity?.authoritativeSettled?.({
            reason: "presentation-failure",
            surface: "audio"
          }));
          throw error;
        }
      }
      return playGameSfx(kind);
    }
  });
}
export function ensureGameSfx() {
  if (!state_presentation_audio.gameSfx.enabled) return false;
  try {
    if (!state_presentation_audio.gameSfx.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      state_presentation_audio.gameSfx.ctx = new AC();
      state_presentation_audio.gameSfx.master = state_presentation_audio.gameSfx.ctx.createGain();
      state_presentation_audio.gameSfx.master.gain.value = 0.24;
      state_presentation_audio.gameSfx.master.connect(state_presentation_audio.gameSfx.ctx.destination);
    }
    if (state_presentation_audio.gameSfx.ctx.state === "suspended") state_presentation_audio.gameSfx.ctx.resume().catch(() => {});
    state_presentation_audio.gameSfx.unlocked = true;
    return true;
  } catch (_) {
    return false;
  }
}
export function sfxTone(freq, duration = 0.12, opt = {}) {
  if (!ensureGameSfx()) return;
  const ctx = state_presentation_audio.gameSfx.ctx,
    now = ctx.currentTime + (opt.delay || 0),
    osc = ctx.createOscillator(),
    gain = ctx.createGain();
  osc.type = opt.type || "sine";
  osc.frequency.setValueAtTime(Math.max(30, freq), now);
  if (opt.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opt.endFreq), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opt.volume || 0.12), now + Math.min(0.018, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(state_presentation_audio.gameSfx.master);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}
export function sfxNoise(duration = 0.12, opt = {}) {
  if (!ensureGameSfx()) return;
  const ctx = state_presentation_audio.gameSfx.ctx,
    now = ctx.currentTime + (opt.delay || 0),
    length = Math.max(1, Math.floor(ctx.sampleRate * duration)),
    buffer = ctx.createBuffer(1, length, ctx.sampleRate),
    data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = ctx.createBufferSource(),
    filter = ctx.createBiquadFilter(),
    gain = ctx.createGain();
  src.buffer = buffer;
  filter.type = opt.filterType || "lowpass";
  filter.frequency.value = opt.frequency || 900;
  filter.Q.value = opt.q || 0.7;
  gain.gain.setValueAtTime(Math.max(0.0002, opt.volume || 0.1), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(filter).connect(gain).connect(state_presentation_audio.gameSfx.master);
  src.start(now);
}
export function canPlaySfxKey(key, gap = 65) {
  const now = performance.now(),
    last = state_presentation_audio.gameSfx.last[key] || 0;
  if (now - last < gap) return false;
  state_presentation_audio.gameSfx.last[key] = now;
  return true;
}
export function playGameSfx(kind) {
  if (!state_presentation_audio.gameSfx.enabled || !canPlaySfxKey(kind, kind === "ui" ? 35 : 70)) return;
  switch (kind) {
    case "ui":
      sfxTone(560, 0.045, {
        type: "triangle",
        volume: 0.035,
        endFreq: 690
      });
      break;
    case "energy":
      sfxTone(620, 0.08, {
        type: "sine",
        volume: 0.08,
        endFreq: 900
      });
      sfxTone(930, 0.06, {
        type: "triangle",
        volume: 0.045,
        delay: 0.04
      });
      break;
    case "cast":
      sfxTone(220, 0.16, {
        type: "sawtooth",
        volume: 0.065,
        endFreq: 520
      });
      sfxTone(660, 0.12, {
        type: "triangle",
        volume: 0.055,
        delay: 0.05,
        endFreq: 940
      });
      break;
    case "hit":
      sfxNoise(0.105, {
        volume: 0.11,
        frequency: 720
      });
      sfxTone(105, 0.1, {
        type: "sine",
        volume: 0.115,
        endFreq: 62
      });
      break;
    case "crit":
      sfxNoise(0.17, {
        volume: 0.16,
        frequency: 1200
      });
      sfxTone(155, 0.18, {
        type: "square",
        volume: 0.105,
        endFreq: 58
      });
      sfxTone(920, 0.12, {
        type: "triangle",
        volume: 0.075,
        delay: 0.015,
        endFreq: 1350
      });
      break;
    case "heal":
      [523, 659, 784].forEach((f, i) => sfxTone(f, 0.14, {
        type: "sine",
        volume: 0.06,
        delay: i * 0.055,
        endFreq: f * 1.08
      }));
      break;
    case "shield":
      sfxTone(280, 0.2, {
        type: "triangle",
        volume: 0.075,
        endFreq: 430
      });
      sfxTone(840, 0.18, {
        type: "sine",
        volume: 0.055,
        delay: 0.025,
        endFreq: 610
      });
      break;
    case "status":
      sfxTone(390, 0.17, {
        type: "square",
        volume: 0.05,
        endFreq: 170
      });
      sfxNoise(0.12, {
        volume: 0.045,
        frequency: 1600,
        filterType: "bandpass",
        delay: 0.025
      });
      break;
    case "cure":
      [440, 660, 990].forEach((f, i) => sfxTone(f, 0.11, {
        type: "sine",
        volume: 0.05,
        delay: i * 0.045
      }));
      break;
    case "block":
      sfxTone(175, 0.12, {
        type: "square",
        volume: 0.075,
        endFreq: 150
      });
      sfxTone(1180, 0.07, {
        type: "triangle",
        volume: 0.045,
        delay: 0.015,
        endFreq: 760
      });
      break;
    case "switch":
      sfxNoise(0.18, {
        volume: 0.07,
        frequency: 1800,
        filterType: "bandpass"
      });
      sfxTone(310, 0.15, {
        type: "sine",
        volume: 0.05,
        endFreq: 680
      });
      break;
    case "fire":
      sfxNoise(0.22, {
        volume: 0.09,
        frequency: 1100
      });
      sfxTone(135, 0.2, {
        type: "sawtooth",
        volume: 0.06,
        endFreq: 92
      });
      break;
    case "water":
      sfxNoise(0.18, {
        volume: 0.06,
        frequency: 2300,
        filterType: "bandpass",
        q: 1.4
      });
      sfxTone(470, 0.18, {
        type: "sine",
        volume: 0.055,
        endFreq: 240
      });
      break;
    case "electric":
      [980, 1410, 740].forEach((f, i) => sfxTone(f, 0.055, {
        type: "square",
        volume: 0.045,
        delay: i * 0.035,
        endFreq: f * 0.76
      }));
      sfxNoise(0.12, {
        volume: 0.055,
        frequency: 3100,
        filterType: "highpass"
      });
      break;
    case "impact":
      sfxNoise(0.24, {
        volume: 0.14,
        frequency: 520
      });
      sfxTone(92, 0.25, {
        type: "sine",
        volume: 0.14,
        endFreq: 38
      });
      break;
    case "death":
      sfxTone(260, 0.32, {
        type: "sawtooth",
        volume: 0.075,
        endFreq: 64
      });
      sfxNoise(0.22, {
        volume: 0.06,
        frequency: 480,
        delay: 0.06
      });
      break;
    case "victory":
      [523, 659, 784, 1047].forEach((f, i) => sfxTone(f, 0.28, {
        type: "triangle",
        volume: 0.075,
        delay: i * 0.11
      }));
      break;
  }
}
export function skillSoundKind(msg) {
  if (/지진|분화|스맥다운|돌진|강타|굴착|폭발|버스트/.test(msg)) return "impact";
  if (/화염|불꽃|파이어|브레스|화상/.test(msg)) return "fire";
  if (/물총|수류|파도|폭풍|허리케인|빙결|냉동/.test(msg)) return "water";
  if (/전기|번개|전류|볼티지|마그네틱|마비/.test(msg)) return "electric";
  if (/회복|생명|라이프|치유|재생/.test(msg)) return "heal";
  if (/실드|가드|보호막|방어/.test(msg)) return "shield";
  return "cast";
}
export function playGameSfxFromLog(g, msg, cls = "") {
  if (typeof state_ui_battle_state.game === "undefined" || g !== state_ui_battle_state.game || !msg) return;
  const s = String(msg);
  if (/플레이어 승리|AI 승리/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("victory");
  if (/ 사망\.?$/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("death");
  if (/크리티컬|치명타/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("crit");
  if (cls === "damage" || /최종 피해 \d+D/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("hit");
  if (cls === "heal" || /HP \d+ 회복/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("heal");
  if (/사용 \(실제 코스트/.test(s)) return state_presentation_audio.PresentationAudioOwner.play(skillSoundKind(s));
  if (/실드 \+|HP 보호막|가드/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("shield");
  if (/무효|면역/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("block");
  if (/치료|해제| 제거/.test(s) && /상태|독|감속|마비|화상|냉동|봉인/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("cure");
  if (/독|감속|마비|화상|냉동|특성봉인|기술봉인|회복봉인/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("status");
  if (/에너지 .*획득|에너지 \d+ 획득|에너지 직조/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("energy");
  if (/교체|출전/.test(s)) return state_presentation_audio.PresentationAudioOwner.play("switch");
}
export function normalizeGameNumberText(value) {
  return String(value ?? "").replace(/(?:undefined|null|NaN)/gi, "").replace(/(-?\d+)\.5(?=(?:개 분량|개|E|에너지|\s*(?:제거|획득|지불|버림)))/g, (_, whole) => `${whole}½`).replace(/\s{2,}/g, " ").replace(/\s*·\s*/g, "·").replace(/\s+([.,:])/g, "$1").trim();
}
export function log(g, msg, cls = "") {
  msg = dmCleanDisplayText(normalizeGameNumberText(msg));
  if (!msg) {
    dmDebug("hidden-invalid-log", {
      message: msg,
      cls
    });
    return;
  }
  g.logs.push({
    msg,
    cls
  });
  if (g.logs.length > 500) g.logs.shift();
  queueNoticeFromLog(g, msg, cls);
  playGameSfxFromLog(g, msg, cls);
}
