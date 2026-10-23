// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_lobby = {
  shownOnlineCoinIds: undefined,
  onlineInvaderPortalIndex: undefined,
  LobbyEngine: undefined
};
import { state_catalog_cards } from "../catalog/cards.js";
import { resolvePlusStarChoice, state_engine_entities } from "../engine/entities.js";
import { applySharedOnlineRules, p2pSend } from "./connection.js";
import { sendOnlineEmote } from "./emotes.js";
import { cloneAndSanitizeOnlineDeck, resetOnlineStartTransactionState, rootOnlineRoomSelectCard, scheduleOnlineStartReplayRequest, startOnlineRoomBattleOnce, state_online_start } from "./start.js";
import { stableOnlinePlayerId } from "./transport.js";
import { systems } from "../runtime/systems.js";
import { state_ui_battle_state } from "../ui/battle-state.js";
import { pictogramHTML } from "../ui/cards.js";
import { nextLeagueFormId, setupFormState, state_ui_deck } from "../ui/deck.js";
import { currentSelectedInvader, invaderCards, isInvaderCardId } from "../ui/invaders.js";
import { state_ui_setup } from "../ui/setup.js";
export function initializeOnlineLobby() {
  state_online_lobby.shownOnlineCoinIds = new Set();
  state_online_lobby.onlineInvaderPortalIndex = 0;
  state_online_lobby.LobbyEngine = (() => {
    const VERSION = "mega-lobby-engine-authority-r2";
    const PROTOCOL = "mega-online-lobby-authority-r2";
    const bytes = new Uint32Array(3);
    crypto.getRandomValues(bytes);
    const instanceId = `lobby-${[...bytes].map(value => value.toString(36)).join("-")}`;
    let sequence = 0;
    let renderCount = 0;
    let draftIdentity = null;
    let setupSnapshot = null;
    let stateRequestSerial = 0;
    let pendingLocalSequence = 0;
    const trace = [];
    const canonical = {
      revision: 0,
      authorityPlayerId: null,
      participants: new Map(),
      startTransaction: null,
      appliedEnvelopeId: null
    };
    const scope = () => String(state_ui_deck.p2p?.matchId || state_ui_deck.p2p?.roomCode || "online");
    const runtimeIdentity = () => systems.OnlineRuntime?.identity?.() || {};
    const fallbackLocalPlayerId = String(stableOnlinePlayerId());
    const localPlayerId = () => String(state_ui_deck.p2p?.playerId || fallbackLocalPlayerId);
    const remotePlayerId = () => String(state_ui_deck.p2p?.remotePlayerId || state_ui_deck.p2p?.remotePeerId || "remote");
    const authorityPlayerId = () => String(state_ui_deck.p2p?.role === "host" ? localPlayerId() : remotePlayerId());
    const sendPacket = packet => {
      try {
        const sent = systems.OnlineRuntime?.sendControl?.(packet);
        if (sent) return true;
        if (state_ui_deck.p2p?.conn?.open) return p2pSend(packet) !== false;
      } catch (error) {
        systems.__megaRecordRecoveredError?.(error, "lobby-engine-control-send");
      }
      return false;
    };
    const participant = id => canonical.participants.get(String(id || "")) || null;
    const cloneParticipant = row => row ? Object.freeze({
      playerId: String(row.playerId || ""),
      deck: Object.freeze([...(row.deck || [])]),
      plusStar: row.plusStar || null,
      composition: row.composition || null,
      ready: !!row.ready,
      digest: String(row.digest || ""),
      sequence: Number(row.sequence || 0)
    }) : null;
    const digest = (deck, plusStar, league, composition = onlineCompositionNow()) => `${league}:${league === "comprehensive" ? composition : "-"}:${(deck || []).join("|")}:${plusStar || ""}`;
    const record = (stage, detail = {}) => {
      const state = readyState();
      const identity = runtimeIdentity();
      const entry = {
        at: Date.now(),
        stage: String(stage || "unknown"),
        scope: scope(),
        runtimeGeneration: Number(identity.generation || 0),
        bindingGeneration: Number(identity.bindingGeneration || 0),
        sessionToken: String(identity.sessionToken || ""),
        projectionEpoch: Number(identity.projectionEpoch || 0),
        canonicalRevision: Number(canonical.revision || 0),
        role: state_ui_deck.p2p?.role || null,
        localSlots: [...state.localDeck],
        remoteSlots: [...state.remoteDeck],
        remoteSelectedCount: state.remoteDeck.length,
        remoteReady: state.remote,
        ...detail
      };
      trace.push(entry);
      if (trace.length > 480) trace.splice(0, trace.length - 320);
      return entry;
    };
    const sanitizeParticipant = (row, league = onlineLeagueNow(), fallbackComposition = null) => {
      const playerId = String(row?.playerId || ""),
        team = playerId === localPlayerId() ? onlineLocalTeam() : onlineRemoteTeam(),
        requestedComposition = String(row?.composition || "").trim(),
        invalidComposition = league === "comprehensive" && !!requestedComposition && !state_ui_deck.LeagueFormatOwner.comprehensivePatterns[requestedComposition],
        composition = league === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(requestedComposition || fallbackComposition || (team === "P" ? onlineCompositionNow() : onlineRemoteCompositionNow())) : null,
        deck = cloneAndSanitizeOnlineDeck(row?.deck || [], league, composition),
        requestedPlus = row?.plusStar ?? null,
        plusStar = resolvePlusStarChoice(requestedPlus, deck, team),
        plusValid = !plusStar || state_ui_deck.LeagueFormatOwner.partialValid(deck, league, composition, plusStar, team),
        admittedPlus = plusValid ? plusStar : null,
        invalidRequestedPlus = !!requestedPlus && !plusValid;
      return {
        playerId,
        deck,
        plusStar: admittedPlus,
        composition,
        ready: !!row?.ready && !invalidComposition && !invalidRequestedPlus && onlineDeckIsReady(deck, league, composition, admittedPlus, team),
        digest: digest(deck, admittedPlus, league, composition),
        sequence: Number(row?.sequence || 0)
      };
    };
    const ensureParticipant = (id, seed = {}) => {
      id = String(id || "");
      if (!id) return null;
      if (!canonical.participants.has(id)) canonical.participants.set(id, sanitizeParticipant({
        playerId: id,
        ...seed
      }));
      return canonical.participants.get(id);
    };
    const importLocalDraft = (reason = "local-draft") => {
      const league = onlineLeagueNow(),
        composition = onlineCompositionNow();
      sanitizeOnlineRoomSelection(league, composition);
      const id = localPlayerId();
      const prior = ensureParticipant(id);
      const next = sanitizeParticipant({
        playerId: id,
        deck: [...state_ui_battle_state.selected],
        plusStar: state_ui_deck.plusStarSelection,
        composition,
        ready: onlineDeckIsReady(state_ui_battle_state.selected, league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam()),
        sequence: Number(prior?.sequence || 0) + 1
      }, league, composition);
      canonical.participants.set(id, next);
      pendingLocalSequence = Math.max(pendingLocalSequence, next.sequence);
      canonical.authorityPlayerId = authorityPlayerId();
      if (state_ui_deck.p2p?.role === "host") canonical.revision++;
      record("canonical-local-mutation", {
        reason,
        participantId: id,
        participantSequence: next.sequence,
        digest: next.digest,
        authorityRevisionAdvanced: state_ui_deck.p2p?.role === "host"
      });
      return next;
    };
    const readyState = () => {
      const league = onlineLeagueNow(),
        composition = onlineCompositionNow(),
        remoteComposition = onlineRemoteCompositionNow(),
        local = participant(localPlayerId()) || sanitizeParticipant({
          playerId: localPlayerId(),
          composition
        }, league, composition),
        remote = participant(remotePlayerId()) || sanitizeParticipant({
          playerId: remotePlayerId(),
          composition: remoteComposition
        }, league, remoteComposition);
      return Object.freeze({
        league,
        composition: league === "comprehensive" ? composition : null,
        localComposition: league === "comprehensive" ? local.composition : null,
        remoteComposition: league === "comprehensive" ? remote.composition : null,
        revision: Number(canonical.revision || 0),
        authorityPlayerId: canonical.authorityPlayerId || authorityPlayerId(),
        local: !!local.ready,
        remote: !!remote.ready,
        localDeck: Object.freeze([...(local.deck || [])]),
        remoteDeck: Object.freeze([...(remote.deck || [])]),
        localPlusStar: local.plusStar || null,
        remotePlusStar: remote.plusStar || null,
        localDigest: local.digest || digest(local.deck, local.plusStar, league, local.composition),
        remoteDigest: remote.digest || digest(remote.deck, remote.plusStar, league, remote.composition),
        startTransaction: canonical.startTransaction ? Object.freeze({
          ...canonical.startTransaction
        }) : null
      });
    };
    const immutableEnvelope = (reason = "authority-envelope") => {
      const identity = runtimeIdentity();
      canonical.authorityPlayerId = authorityPlayerId();
      const state = readyState(),
        remote = participant(remotePlayerId()),
        remoteKnown = !!remote && Number(remote.sequence || 0) > 0;
      const participants = [...canonical.participants.values()].filter(row => String(row.playerId || "") === localPlayerId() || Number(row.sequence || 0) > 0);
      return Object.freeze({
        type: "lobbyEnvelopeR2",
        protocol: PROTOCOL,
        scope: scope(),
        envelopeId: `${scope()}:${canonical.revision}:${++sequence}`,
        authorityPlayerId: canonical.authorityPlayerId,
        revision: Number(canonical.revision || 0),
        league: onlineLeagueNow(),
        composition: onlineLeagueNow() === "comprehensive" ? state.localComposition : null,
        compositions: onlineLeagueNow() === "comprehensive" ? Object.freeze({
          P: state.localComposition,
          A: remoteKnown ? remote.composition : null
        }) : null,
        participants: Object.freeze(participants.map(row => cloneParticipant(row))),
        startTransaction: canonical.startTransaction ? Object.freeze({
          ...canonical.startTransaction
        }) : null,
        sessionGeneration: Number(identity.generation || 0),
        sessionToken: String(identity.sessionToken || ""),
        reason: String(reason),
        at: Date.now()
      });
    };
    const projectControls = () => refreshOnlineRoomControls();
    const inspectSurface = () => {
      const modal = roomModal(),
        root = roomRoot(),
        deck = document.getElementById("onlineRoomDeck"),
        label = document.getElementById("roomReadyState");
      const portalButton = root?.querySelector("#onlineInvaderReplaceCancel,#invaderPortalOnlineCancel,#invaderPortalOnlineEmptyBack");
      const surfaceKind = deck && label ? "DECK" : portalButton ? "PORTAL" : "NONE";
      const connected = !!(modal?.isConnected && root?.isConnected && (deck?.isConnected && label?.isConnected || portalButton?.isConnected));
      const visible = !!(connected && modal.classList.contains("open") && modal.classList.contains("online-room-r22"));
      const cards = deck ? [...deck.querySelectorAll("[role=button],.online-room-card")] : [];
      const enabledCards = cards.filter(node => !node.disabled && node.getAttribute("aria-disabled") !== "true" && getComputedStyle(node).pointerEvents !== "none");
      const portalEnabled = !!(portalButton && !portalButton.disabled && portalButton.getAttribute("aria-disabled") !== "true" && getComputedStyle(portalButton).pointerEvents !== "none");
      const interactionReady = visible && (surfaceKind === "PORTAL" ? portalEnabled : enabledCards.length > 0);
      return Object.freeze({
        surfaceKind,
        targetId: surfaceKind === "DECK" ? deck?.id || null : portalButton?.id || null,
        connected,
        visible,
        modalOpen: !!modal?.classList.contains("open"),
        onlineRoomClass: !!modal?.classList.contains("online-room-r22"),
        blockingSyncModal: !!(modal?.classList.contains("open") && !modal?.classList.contains("online-room-r22")),
        cardCount: cards.length,
        enabledCardCount: enabledCards.length,
        portalEnabled,
        interactionReady,
        activeNavigationSurface: document.documentElement.dataset.onlineActiveSurface || null
      });
    };
    const project = (reason = "projection") => {
      const state = readyState(),
        before = inspectSurface();
      if (!before.connected || !before.visible) {
        record("projection-skipped-no-current-surface", {
          reason,
          surface: before
        });
        return Object.freeze({
          ok: false,
          state,
          surface: before,
          reason: "CURRENT_LOBBY_SURFACE_UNAVAILABLE"
        });
      }
      if (state_ui_deck.p2p) {
        state_ui_deck.p2p.localDeck = [...state.localDeck];
        state_ui_deck.p2p.remoteDeck = [...state.remoteDeck];
        state_ui_deck.p2p.localReady = state.local;
        state_ui_deck.p2p.remoteReady = state.remote;
        state_ui_deck.p2p.remotePlusStar = state.remotePlusStar;
        state_ui_deck.p2p.localComposition = state.localComposition;
        state_ui_deck.p2p.remoteComposition = state.remoteComposition;
      }
      projectControls();
      const label = document.getElementById("roomReadyState");
      if (label) {
        label.textContent = onlineRoomReadyText();
        label.dataset.remoteSelectedCount = String(state.remoteDeck.length);
        label.dataset.lobbyProjectionRevision = String(state.revision);
        label.dataset.lobbyProjectionEpoch = String(runtimeIdentity().projectionEpoch || 0);
      }
      const surface = inspectSurface();
      const ok = !!(surface.connected && surface.visible && surface.interactionReady && (surface.surfaceKind === "PORTAL" || label));
      record("projection-commit", {
        reason,
        committed: ok,
        surfaceKind: surface.surfaceKind,
        targetSurfaceId: surface.targetId,
        surfaceConnected: surface.connected,
        surfaceVisible: surface.visible,
        interactionReady: surface.interactionReady,
        visibleRemoteSelectedCount: label ? Number(label.dataset.remoteSelectedCount || 0) : null,
        viewModelSignature: `${state.revision}:${state.league}:${state.localDeck.join("|")}:${state.remoteDeck.join("|")}:${state.local ? 1 : 0}:${state.remote ? 1 : 0}`
      });
      return Object.freeze({
        ok,
        state,
        surface,
        reason: ok ? null : "LOBBY_SURFACE_NOT_PLAYABLE"
      });
    };
    const lobbyPhaseActive = () => {
      const phase = String(runtimeIdentity()?.phase || "");
      const activeGame = typeof state_ui_battle_state.game !== "undefined" ? state_ui_battle_state.game : null;
      return !["STARTING_BATTLE", "IN_BATTLE", "TERMINAL", "SETUP"].includes(phase) && !state_ui_deck.p2p?.battleStarted && activeGame?.mode !== "online" && !activeGame?.bossRaid?.online;
    };
    const requestProjection = reason => {
      if (!lobbyPhaseActive()) {
        record("lobby-projection-suppressed-after-phase-cutover", {
          reason: String(reason || "lobby"),
          phase: String(runtimeIdentity()?.phase || ""),
          battleStarted: !!state_ui_deck.p2p?.battleStarted
        });
        return Object.freeze({
          ok: true,
          suppressed: true,
          reason: "PHASE_ALREADY_CUT_OVER"
        });
      }
      return systems.OnlineRuntime?.projection?.request?.(String(reason || "lobby"), {
        phase: "LOBBY",
        canonicalRevision: Number(canonical.revision || 0)
      }) ?? project(reason);
    };
    const applyReadyState = (reason = "compat-projection") => requestProjection(reason);
    const publishEnvelope = (reason = "authority-publish") => {
      if (state_ui_deck.p2p?.role !== "host" || !state_ui_deck.p2p?.conn?.open) return false;
      const packet = immutableEnvelope(reason);
      const sent = sendPacket(packet);
      record("authority-envelope-published", {
        reason,
        envelopeId: packet.envelopeId,
        revision: packet.revision,
        sent
      });
      return sent;
    };
    const publishMutation = (reason = "participant-mutation") => {
      if (state_ui_deck.p2p?.role !== "guest" || !state_ui_deck.p2p?.conn?.open) return false;
      const local = participant(localPlayerId()) || importLocalDraft(reason);
      const identity = runtimeIdentity();
      const packet = {
        type: "lobbyMutationR2",
        protocol: PROTOCOL,
        scope: scope(),
        senderId: localPlayerId(),
        participant: cloneParticipant(local),
        knownRevision: Number(canonical.revision || 0),
        sessionGeneration: Number(identity.generation || 0),
        sessionToken: String(identity.sessionToken || ""),
        reason: String(reason),
        at: Date.now()
      };
      const sent = sendPacket(packet);
      record("participant-mutation-published", {
        reason,
        participantSequence: local.sequence,
        digest: local.digest,
        sent
      });
      return sent;
    };
    const sendState = (reason = "local-mutation") => {
      importLocalDraft(reason);
      requestProjection(`local:${reason}`);
      if (!state_ui_deck.p2p?.connected || !state_ui_deck.p2p?.conn?.open) {
        record("state-publication-deferred", {
          reason,
          dropReason: "TRANSPORT_NOT_READY"
        });
        return false;
      }
      return state_ui_deck.p2p.role === "host" ? publishEnvelope(reason) : publishMutation(reason);
    };
    const requestPeerState = (reason = "authoritative-resync") => {
      if (!state_ui_deck.p2p?.connected || !state_ui_deck.p2p?.conn?.open) return false;
      const identity = runtimeIdentity(),
        requestId = `${instanceId}:request:${++stateRequestSerial}`;
      const sent = sendPacket({
        type: "lobbyStateRequestR2",
        protocol: PROTOCOL,
        scope: scope(),
        requestId,
        senderId: localPlayerId(),
        knownRevision: Number(canonical.revision || 0),
        senderSessionGeneration: Number(identity.generation || 0),
        sessionToken: String(identity.sessionToken || ""),
        reason: String(reason),
        at: Date.now()
      });
      record("authority-state-requested", {
        requestId,
        reason,
        sent
      });
      return sent;
    };
    const submitDeck = (reason = "deck-submit") => sendState(reason);
    const admitIdentity = msg => {
      const identity = runtimeIdentity();
      if (msg?.protocol !== PROTOCOL || String(msg.scope || scope()) !== scope()) return {
        ok: false,
        reason: "PROTOCOL_OR_SCOPE"
      };
      if (msg.targetSessionGeneration != null && Number(msg.targetSessionGeneration) !== Number(identity.generation || 0)) return {
        ok: false,
        reason: "TARGET_GENERATION_MISMATCH"
      };
      if (msg.sessionToken && identity.sessionToken && String(msg.sessionToken) !== String(identity.sessionToken)) return {
        ok: false,
        reason: "SESSION_TOKEN_MISMATCH"
      };
      return {
        ok: true
      };
    };
    const receiveState = msg => {
      const admitted = admitIdentity(msg);
      if (!admitted.ok) {
        record("state-admission-dropped", {
          packetType: msg?.type || null,
          dropReason: admitted.reason
        });
        return false;
      }
      if (!lobbyPhaseActive()) {
        record("lobby-packet-dropped-after-phase-cutover", {
          packetType: msg?.type || null,
          phase: String(runtimeIdentity()?.phase || ""),
          revision: Number(msg?.revision || 0),
          battleStarted: !!state_ui_deck.p2p?.battleStarted
        });
        return true;
      }
      if (msg.type === "lobbyMutationR2") {
        if (state_ui_deck.p2p?.role !== "host" || String(msg.senderId || "") !== remotePlayerId()) return false;
        const incoming = sanitizeParticipant(msg.participant, onlineLeagueNow(), onlineRemoteCompositionNow()),
          prior = participant(incoming.playerId);
        if (prior && incoming.sequence <= prior.sequence) {
          record("participant-mutation-duplicate", {
            participantId: incoming.playerId,
            incomingSequence: incoming.sequence,
            appliedSequence: prior.sequence
          });
          return true;
        }
        canonical.participants.set(incoming.playerId, incoming);
        canonical.authorityPlayerId = localPlayerId();
        canonical.revision++;
        if (state_ui_deck.p2p) state_ui_deck.p2p.remoteComposition = incoming.composition;
        record("canonical-remote-mutation-applied", {
          participantId: incoming.playerId,
          participantSequence: incoming.sequence,
          digest: incoming.digest,
          composition: incoming.composition
        });
        requestProjection("authority-applied-remote-mutation");
        publishEnvelope("remote-mutation-commit");
        return true;
      }
      if (msg.type === "lobbyEnvelopeR2") {
        if (state_ui_deck.p2p?.role !== "guest" || String(msg.authorityPlayerId || "") !== remotePlayerId()) return false;
        if (Number(msg.revision || 0) < Number(canonical.revision || 0)) {
          record("authority-envelope-stale", {
            incomingRevision: Number(msg.revision || 0),
            appliedRevision: Number(canonical.revision || 0)
          });
          return true;
        }
        const incomingLeague = state_ui_deck.LeagueFormatOwner.normalizeLeague(msg.league || onlineLeagueNow());
        const completeCompositions = msg.compositions?.P && msg.compositions?.A;
        if (completeCompositions) applySharedOnlineRules({
          league: incomingLeague,
          composition: msg.composition,
          compositions: msg.compositions
        });else {
          state_ui_deck.p2p.rules = {
            ...(state_ui_deck.p2p.rules || {}),
            league: incomingLeague
          };
          const hostComposition = String(msg.composition || "").trim();
          if (incomingLeague === "comprehensive" && state_ui_deck.LeagueFormatOwner.comprehensivePatterns[hostComposition]) state_ui_deck.p2p.remoteComposition = hostComposition;
        }
        const priorLocal = participant(localPlayerId()),
          next = new Map();
        for (const row of msg.participants || []) {
          const rowId = String(row?.playerId || ""),
            fallback = rowId === localPlayerId() ? onlineCompositionNow() : onlineRemoteCompositionNow();
          const safe = sanitizeParticipant(row, incomingLeague, fallback);
          if (safe.playerId) next.set(safe.playerId, safe);
        }
        const authorityLocal = next.get(localPlayerId()),
          keepPending = !!priorLocal && (!authorityLocal || Number(priorLocal.sequence || 0) > Number(authorityLocal.sequence || 0));
        if (keepPending) next.set(localPlayerId(), priorLocal);
        canonical.participants = next;
        canonical.authorityPlayerId = String(msg.authorityPlayerId || "");
        canonical.revision = Number(msg.revision || 0);
        canonical.startTransaction = msg.startTransaction ? {
          ...msg.startTransaction
        } : null;
        canonical.appliedEnvelopeId = String(msg.envelopeId || "");
        const local = participant(localPlayerId()),
          remote = participant(remotePlayerId());
        if (local) {
          state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length, ...local.deck);
          state_ui_deck.plusStarSelection = local.plusStar;
          state_ui_deck.p2p.localComposition = local.composition;
        }
        if (remote) state_ui_deck.p2p.remoteComposition = remote.composition;
        record("authoritative-envelope-applied", {
          envelopeId: canonical.appliedEnvelopeId,
          revision: canonical.revision,
          keptPendingLocalProposal: keepPending,
          localComposition: local?.composition || null,
          remoteComposition: remote?.composition || null
        });
        requestProjection("authoritative-envelope");
        systems.OnlineRuntime?.restore?.authoritativeApplied?.({
          phase: "LOBBY",
          revision: canonical.revision,
          envelopeId: canonical.appliedEnvelopeId,
          kind: "host-lobby"
        });
        if (canonical.startTransaction && state_ui_deck.p2p?.role === "guest" && !state_ui_deck.p2p?.battleStarted) scheduleOnlineStartReplayRequest("authoritative-envelope-start-pending");
        if (keepPending) publishMutation("pending-local-after-authority-envelope");
        return true;
      }
      return false;
    };
    const receiveStateRequest = msg => {
      const admitted = admitIdentity(msg);
      if (!admitted.ok || msg?.type !== "lobbyStateRequestR2") return false;
      record("authority-state-request-received", {
        requestId: String(msg.requestId || ""),
        knownRevision: Number(msg.knownRevision || 0)
      });
      if (state_ui_deck.p2p?.role === "host") return publishEnvelope(`peer-request:${String(msg.requestId || "unknown")}`);
      return publishMutation(`authority-request-local-refresh:${String(msg.requestId || "unknown")}`);
    };
    const onTransportReady = (reason = "binding-ready") => {
      requestProjection(`transport-ready:${reason}`);
      const mutationPublished = state_ui_deck.p2p?.role === "guest" ? publishMutation(`transport-ready:${reason}`) : false;
      const published = state_ui_deck.p2p?.role === "host" ? publishEnvelope(`transport-ready:${reason}`) : false;
      const requested = state_ui_deck.p2p?.role === "guest" ? requestPeerState(`transport-ready:${reason}`) : false;
      record("transport-ready-authority-convergence", {
        reason,
        published,
        mutationPublished,
        requested
      });
      return {
        state: readyState(),
        published,
        mutationPublished,
        requested
      };
    };
    const beginFreshDraft = identity => {
      const nextIdentity = String(identity || "online-lobby");
      if (draftIdentity === nextIdentity) return debug();
      if (draftIdentity === null) setupSnapshot = Object.freeze({
        deck: [...state_ui_battle_state.selected],
        plusStar: state_ui_deck.plusStarSelection
      });
      state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length);
      state_ui_deck.plusStarSelection = null;
      draftIdentity = nextIdentity;
      canonical.revision = 0;
      pendingLocalSequence = 0;
      canonical.participants.clear();
      canonical.authorityPlayerId = authorityPlayerId();
      canonical.startTransaction = null;
      canonical.appliedEnvelopeId = null;
      ensureParticipant(localPlayerId(), {
        deck: [],
        plusStar: null,
        composition: onlineCompositionNow(),
        ready: false,
        sequence: 0
      });
      if (remotePlayerId() !== "remote") ensureParticipant(remotePlayerId(), {
        deck: [],
        plusStar: null,
        composition: onlineRemoteCompositionNow(),
        ready: false,
        sequence: 0
      });
      record("fresh-lobby-draft", {
        identity: nextIdentity
      });
      return debug();
    };
    const isRegularProjectionContext = () => !!(state_ui_deck.p2p && state_ui_deck.p2p.sessionMode !== "bossRaid" && !state_ui_deck.p2p.battleStarted && state_ui_battle_state.game?.mode !== "online" && (state_ui_deck.p2p.matchId || state_ui_deck.p2p.roomCode));
    const isRegularActive = () => !!(isRegularProjectionContext() && state_ui_deck.p2p?.connected && state_ui_deck.p2p?.conn?.open);
    const roomModal = () => document.getElementById("modal");
    const roomRoot = () => document.getElementById("modalContent");
    const roomPortalOpen = () => !!roomRoot()?.querySelector("#onlineInvaderReplaceCancel,#invaderPortalOnlineCancel,#invaderPortalOnlineEmptyBack");
    const roomVisible = () => !!(roomModal()?.classList.contains("open") && (document.getElementById("onlineRoomDeck") || roomPortalOpen()));
    const syncChat = () => systems.__megaOnlineBattleChat?.sync?.();
    const captureRoomScroll = () => {
      const grid = document.getElementById("onlineRoomDeck"),
        modalBox = document.querySelector("#modal .modalbox"),
        content = roomRoot();
      return {
        grid: Math.max(0, Number(grid?.scrollTop) || 0),
        modal: Math.max(0, Number(modalBox?.scrollTop) || 0),
        content: Math.max(0, Number(content?.scrollTop) || 0)
      };
    };
    const restoreRoomScroll = snapshot => {
      if (!snapshot) return false;
      const apply = () => {
        const grid = document.getElementById("onlineRoomDeck"),
          modalBox = document.querySelector("#modal .modalbox"),
          content = roomRoot();
        if (grid) grid.scrollTop = Math.min(snapshot.grid, Math.max(0, grid.scrollHeight - grid.clientHeight));
        if (modalBox) modalBox.scrollTop = Math.min(snapshot.modal, Math.max(0, modalBox.scrollHeight - modalBox.clientHeight));
        if (content) content.scrollTop = Math.min(snapshot.content, Math.max(0, content.scrollHeight - content.clientHeight));
      };
      apply();
      systems.OnlineRuntime?.sessionScope?.requestAnimationFrame?.(apply, "lobby-scroll-restore");
      return true;
    };
    const syncRoom = () => {
      project("sync-room");
      state_ui_battle_state.InvaderPortalView.sync("onlineInvaderPortalButton", currentSelectedInvader());
      syncChat();
      return debug();
    };
    const closeRoom = (options = {}) => {
      const modal = roomModal();
      if (!modal) return false;
      const root = roomRoot();
      const ownsVisibleRoom = !!(root?.querySelector("#onlineRoomDeck,#onlineInvaderReplaceCancel,#invaderPortalOnlineCancel,#invaderPortalOnlineEmptyBack") || modal.classList.contains("online-room-r22"));
      if (!ownsVisibleRoom) return false;
      modal.classList.remove("open", "online-room-r22", "online-room-closing");
      document.body.classList.remove("online-lobby-open");
      if (options.clearMarkup === true && root) root.replaceChildren();
      syncChat();
      return true;
    };
    const renderRoomSurface = (options = {}) => {
      if (!participant(localPlayerId())) importLocalDraft("room-initial-canonical-import");
      if (state_ui_deck.p2p?.battleStarted || state_ui_battle_state.game?.mode === "online") {
        closeRoom({
          reason: options.reason || "battle-start"
        });
        return false;
      }
      if (!state_ui_deck.p2p?.connected && !systems.OnlineRuntime?.debug?.().committed) return false;
      const modal = roomModal(),
        root = roomRoot();
      if (!modal || !root) return false;
      const existing = document.getElementById("onlineRoomDeck");
      const modalOpen = modal.classList.contains("open");
      const portalOpen = roomPortalOpen();
      const snapshot = captureRoomScroll();
      const forceFullRender = options.force === true || options.surfaceIntent === "DECK";

      // A remote state update must not close an already open portal selector.
      if (portalOpen && modalOpen && !forceFullRender) {
        project("portal-open-refresh");
        syncChat();
        renderCount++;
        return true;
      }
      // Repeated rendering of the same logical room updates controls only.
      if (existing && modalOpen && !forceFullRender) {
        project("existing-room-refresh");
        restoreRoomScroll(snapshot);
        renderCount++;
        return true;
      }
      const league = onlineLeagueNow(),
        composition = onlineCompositionNow();
      const changed = sanitizeOnlineRoomSelection(league, composition);
      const title = state_ui_deck.p2p.sessionMode === "matchmaking" ? "자동 매칭 대기실" : `온라인 대전 룸 · ${state_ui_deck.p2p.roomCode}`;
      const currentInvader = currentSelectedInvader(),
        portalAllowed = state_ui_deck.LeagueFormatOwner.invaderAllowed(league, composition);
      root.innerHTML = `<h2>${title}</h2><p class="tiny muted">${state_ui_deck.LeagueFormatOwner.definition(league).label} · ${state_ui_deck.LeagueFormatOwner.rulesText(league, composition)}</p><p id="roomReadyState">${onlineRoomReadyText()}</p><div id="onlineRoomDeck" class="online-room-grid"></div>${portalAllowed ? state_ui_battle_state.InvaderPortalView.buttonHTML({
        buttonId: "onlineInvaderPortalButton",
        selectedId: currentInvader,
        areaClass: "online-invader-portal-area"
      }) : ""}<div class="emote-bar"><b>감정 표현</b>${["👍", "🔥", "😮", "😂", "💢", "GG"].map(e => `<button data-emote="${e}">${e}</button>`).join("")}</div><div class="choice-list"><button id="onlineRoomStart" class="primary">${state_ui_deck.p2p.role === "host" ? "전투 시작" : "상대 준비 대기"}</button><button id="onlineRoomLeave">연결 끊기</button></div><p class="tiny muted">시작 화면과 동일한 리그 구성 규칙을 사용합니다. 폼 캐릭터는 이 리그에서 합법인 폼만 전환됩니다.${portalAllowed ? " 침략자는 초차원 포탈에서 최대 한 명 선택할 수 있습니다." : ""}</p>`;
      const box = document.getElementById("onlineRoomDeck");
      const draw = () => {
        box.replaceChildren();
        const normalPool = state_ui_deck.LeagueFormatOwner.setupPool(league, composition, state_ui_battle_state.selected, state_ui_deck.plusStarSelection, onlineLocalTeam());
        const seen = new Set();
        for (const rawId of normalPool) {
          const id = rawId;
          if (seen.has(id)) continue;
          seen.add(id);
          const c = state_catalog_cards.CARDS.find(card => card.id === id);
          if (!c || isInvaderCardId(id)) continue;
          const element = document.createElement("div");
          element.tabIndex = 0;
          element.setAttribute("role", "button");
          const slotBlocked = !state_ui_battle_state.selected.includes(id) && !state_ui_deck.LeagueFormatOwner.partialValid([...state_ui_battle_state.selected, id], league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam());
          element.className = `card compact-card selectable online-room-card ${state_ui_battle_state.selected.includes(id) ? "selected" : ""} ${slotBlocked ? "league-slot-blocked" : ""}`;
          element.setAttribute("aria-disabled", String(slotBlocked));
          element.dataset.infoCard = "setup";
          element.dataset.infoSurface = state_ui_deck.p2p.role === "host" ? "host-lobby" : "guest-lobby";
          element.dataset.infoTeam = "P";
          element.dataset.infoSlotIndex = String(state_ui_battle_state.selected.indexOf(id));
          element.dataset.cardId = id;
          element.dataset.id = rawId;
          const slotIndex = state_ui_battle_state.selected.indexOf(c.id);
          const effectiveCard = state_catalog_cards.EffectiveCardPresentationOwner.resolve(c, null, {
            deck: state_ui_battle_state.selected,
            plusStarChoice: state_ui_deck.plusStarSelection,
            team: onlineLocalTeam(),
            slotIndex,
            surface: state_ui_deck.p2p.role === "host" ? "host-lobby" : "guest-lobby",
            sourceRevision: state_ui_battle_state.game?.networkRevision || 0
          });
          const plusActive = effectiveCard.plusStar,
            legalForms = c.formGroup ? state_ui_deck.LeagueFormatOwner.eligibleForms(c.formGroup, state_ui_battle_state.selected, league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam()) : [],
            nextForm = c.formGroup ? nextLeagueFormId(c.formGroup, c.id, state_ui_battle_state.selected, league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam()) : null;
          const toggle = c.formGroup && legalForms.length > 1 && nextForm ? `<button type="button" class="form-toggle" data-online-form="${c.formGroup}">${c.name} → ${state_catalog_cards.CARDS.find(card => card.id === nextForm)?.name || c.name}</button>` : "";
          const formInfo = c.formGroup && legalForms.length ? `<div class="form-eligibility"><b>폼</b>${legalForms.map(fid => {
            const fc = state_catalog_cards.CARDS.find(x => x.id === fid);
            return `<span class="form-chip">${fc?.name || fid} ${fc?.grade || ""}</span>`;
          }).join("")}</div>` : "";
          const plusToggle = state_catalog_cards.PLUS_STAR_ELIGIBLE.has(c.id) ? `<button type="button" class="plusstar-toggle ${plusActive ? "active" : ""}" data-action="toggle-plusstar" data-plusstar-card="${c.id}" data-online-plus-star="${c.id}" aria-pressed="${plusActive}">🎆</button>` : "";
          element.innerHTML = `${pictogramHTML("small", effectiveCard.effectiveCharacterId)}<h3 class="card-title-line"><span>${effectiveCard.displayName}</span><span class="tiny">${effectiveCard.rarity}</span></h3><div class="stats"><span>HP ${c.maxHp}</span><span>실드 ${c.shield || 0}</span>${c.speed ? `<span>Speed +${c.speed}</span>` : ""}</div>${toggle}${formInfo}${plusToggle}`;
          state_catalog_cards.EffectiveCardPresentationOwner.syncElement(element, effectiveCard);
          element.onclick = event => {
            if (event.target.closest(".form-toggle,.plusstar-toggle") || slotBlocked) return;
            rootOnlineRoomSelectCard(id);
            draw();
          };
          element.onkeydown = event => {
            if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button") && !slotBlocked) {
              event.preventDefault();
              rootOnlineRoomSelectCard(id);
              draw();
            }
          };
          box.appendChild(element);
        }
        box.querySelectorAll("[data-online-form]").forEach(button => button.onclick = event => {
          event.stopPropagation();
          const group = button.dataset.onlineForm;
          const selectedForm = state_ui_battle_state.selected.find(value => state_catalog_cards.CARDS.find(card => card.id === value)?.formGroup === group) || null;
          const visibleCard = button.closest("[data-card-id]")?.dataset.cardId;
          const current = selectedForm || visibleCard || setupFormState(group);
          const next = nextLeagueFormId(group, current, state_ui_battle_state.selected, league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam());
          if (!next || next === current) return;
          const changed = state_ui_setup.DeckDraftApplication.changeForm(group, next, {
            mode: league,
            composition,
            plusStar: state_ui_deck.plusStarSelection,
            team: onlineLocalTeam()
          });
          if (!changed) return;
          submitDeck();
          draw();
          requestProjection("form-selection");
        });
        const onlinePlusContext = {
          surface: "online-lobby",
          scope: String(state_ui_deck.p2p.matchId || state_ui_deck.p2p.roomCode || "online"),
          team: onlineLocalTeam()
        };
        state_engine_entities.PlusStarBannerPresentationOwner.bind(box, button => {
          const result = state_engine_entities.PlusStarInteractionOwner.apply({
            ...onlinePlusContext,
            deck: state_ui_battle_state.selected,
            currentChoice: state_ui_deck.plusStarSelection,
            cardId: button.dataset.plusstarCard,
            capacity: state_ui_deck.LeagueFormatOwner.deckSize(onlineLeagueNow()),
            validate: (proposal, choice) => state_ui_deck.LeagueFormatOwner.partialValid(proposal, onlineLeagueNow(), onlineCompositionNow(), choice, onlineLocalTeam()),
            commit: (nextDeck, nextChoice) => state_ui_setup.DeckDraftApplication.commit(nextDeck, nextChoice),
            feedback: message => {
              const state = document.getElementById("roomReadyState");
              if (state) state.textContent = message;
            }
          });
          if (result.ok) {
            submitDeck();
            draw();
          }
        });
        state_engine_entities.PlusStarBannerPresentationOwner.sync(box, onlinePlusContext, state_ui_battle_state.selected, state_ui_deck.plusStarSelection);
        projectControls();
      };
      draw();
      root.querySelectorAll("[data-emote]").forEach(button => button.onclick = () => sendOnlineEmote(button.dataset.emote));
      const portal = document.getElementById("onlineInvaderPortalButton");
      if (portal) portal.onclick = openOnlineInvaderPortal;
      document.getElementById("onlineRoomLeave").onclick = () => {
        systems.NetworkEngine.closeOnline({
          reason: "online-room-leave",
          clearChat: true,
          returnToLobby: true
        });
        closeRoom({
          reason: "online-room-leave"
        });
      };
      document.getElementById("onlineRoomStart").onclick = startOnlineRoomBattleOnce;
      projectControls();
      modal.classList.add("open", "online-room-r22");
      if (changed) submitDeck("sanitize-after-room-render");
      restoreRoomScroll(snapshot);
      syncChat();
      renderCount++;
      return true;
    };
    const acquireSurface = (options = {}) => {
      const identity = runtimeIdentity();
      const rendered = renderRoomSurface(options),
        surface = inspectSurface();
      const ok = !!(rendered && surface.connected && surface.visible && surface.interactionReady && (surface.surfaceKind === "PORTAL" || surface.cardCount > 0 && surface.enabledCardCount > 0));
      const result = Object.freeze({
        ok,
        rendered,
        surface,
        reason: ok ? null : "LOBBY_SURFACE_ACQUISITION_FAILED"
      });
      record("surface-acquire-result", {
        reason: String(options.reason || "projection"),
        ok,
        targetSurfaceId: surface.targetId,
        surfaceConnected: surface.connected,
        surfaceVisible: surface.visible,
        cardCount: surface.cardCount,
        enabledCardCount: surface.enabledCardCount,
        blockingSyncModal: surface.blockingSyncModal
      });
      return result;
    };
    const showRoom = options => acquireSurface({
      ...options,
      compatibilityCaller: true
    });
    const onRoomShown = () => requestProjection("room-shown");
    const onConnectionOpen = () => onTransportReady("connection-open");
    const setStartTransaction = transaction => {
      canonical.startTransaction = transaction ? Object.freeze({
        ...transaction
      }) : null;
      canonical.revision++;
      if (state_ui_deck.p2p?.role === "host" && state_ui_deck.p2p?.conn?.open && lobbyPhaseActive()) publishEnvelope("start-transaction");
      return canonical.startTransaction;
    };
    const requestConsensus = (reason = "start-consensus") => state_ui_deck.p2p?.role === "host" ? publishEnvelope(reason) : requestPeerState(reason);
    const canStart = () => {
      const state = readyState();
      return !!(state.local && state.remote && hasAuthoritativeState());
    };
    const reset = () => {
      closeRoom({
        reason: "lobby-reset"
      });
      sequence = 0;
      stateRequestSerial = 0;
      trace.splice(0, trace.length);
      state_online_lobby.shownOnlineCoinIds.clear();
      if (typeof state_online_start.onlineCoinShownScopes !== "undefined") state_online_start.onlineCoinShownScopes.clear();
      if (setupSnapshot) {
        state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length, ...setupSnapshot.deck);
        state_ui_deck.plusStarSelection = setupSnapshot.plusStar;
      }
      setupSnapshot = null;
      draftIdentity = null;
      canonical.revision = 0;
      pendingLocalSequence = 0;
      canonical.participants.clear();
      canonical.startTransaction = null;
      canonical.appliedEnvelopeId = null;
      if (state_ui_deck.p2p) {
        state_ui_deck.p2p.localDeck = [];
        state_ui_deck.p2p.remoteDeck = [];
        state_ui_deck.p2p.localReady = false;
        state_ui_deck.p2p.remoteReady = false;
        state_ui_deck.p2p.lobbyConsensusReady = false;
        state_ui_deck.p2p.__startedOnlineScope = null;
        state_ui_deck.p2p.__coinScope = null;
        state_ui_deck.p2p.__coinShown = false;
        state_ui_deck.p2p.coinResult = null;
        state_ui_deck.p2p.onlineStartPending = false;
        state_ui_deck.p2p.autoStarting = false;
      }
      if (typeof resetOnlineStartTransactionState === "function") resetOnlineStartTransactionState("lobby-reset");
      document.getElementById("modal")?.classList.remove("online-room-r22", "online-room-closing");
      projectControls();
      return debug();
    };
    const hasAuthoritativeState = () => state_ui_deck.p2p?.role === "host" || !!canonical.appliedEnvelopeId && canonical.authorityPlayerId === remotePlayerId();
    const debug = () => {
      const state = readyState();
      return {
        version: VERSION,
        protocol: PROTOCOL,
        scope: scope(),
        revision: Number(canonical.revision || 0),
        authorityPlayerId: canonical.authorityPlayerId,
        participantCount: canonical.participants.size,
        stateRequestSerial,
        pendingLocalSequence,
        hasAuthoritativeState: hasAuthoritativeState(),
        active: isRegularActive(),
        roomVisible: roomVisible(),
        renderCount,
        selectedDeckIds: [...state_ui_battle_state.selected],
        readyState: state,
        draftIdentity,
        setupSnapshotDeck: setupSnapshot ? [...setupSnapshot.deck] : null,
        appliedEnvelopeId: canonical.appliedEnvelopeId,
        startTransaction: canonical.startTransaction ? {
          ...canonical.startTransaction
        } : null,
        trace: trace.map(entry => ({
          ...entry,
          localSlots: [...(entry.localSlots || [])],
          remoteSlots: [...(entry.remoteSlots || [])]
        }))
      };
    };
    return Object.freeze({
      VERSION,
      PROTOCOL,
      beginFreshDraft,
      ready: readyState,
      project,
      applyReadyState,
      submitDeck,
      sendState,
      requestPeerState,
      receiveState,
      receiveStateRequest,
      onTransportReady,
      acquireSurface,
      inspectSurface,
      showRoom,
      closeRoom,
      syncRoom,
      onRoomShown,
      onConnectionOpen,
      setStartTransaction,
      hasAuthoritativeState,
      canStart,
      requestConsensus,
      reset,
      debug
    });
  })();
}
export function onlineLeagueNow() {
  return state_ui_deck.LeagueFormatOwner.normalizeLeague(state_ui_deck.p2p.rules?.league || state_ui_deck.leagueSelection);
}
export function onlineCompositionNow() {
  return onlineLeagueNow() === "comprehensive" ? state_ui_deck.LeagueFormatOwner.normalizeComposition(state_ui_deck.p2p.localComposition || state_ui_deck.comprehensiveComposition) : state_ui_deck.comprehensiveComposition;
}
export function onlineLocalTeam() {
  return state_ui_deck.p2p?.role === "guest" ? "A" : "P";
}
export function onlineRemoteTeam() {
  return onlineLocalTeam() === "P" ? "A" : "P";
}
export function onlineRemoteCompositionNow() {
  if (onlineLeagueNow() !== "comprehensive") return state_ui_deck.comprehensiveComposition;
  const explicit = String(state_ui_deck.p2p?.remoteComposition || "").trim();
  if (state_ui_deck.LeagueFormatOwner.comprehensivePatterns[explicit]) return explicit;
  return state_ui_deck.LeagueFormatOwner.inferComposition(state_ui_deck.p2p?.remoteDeck || [], state_ui_deck.p2p?.remotePlusStar || null, onlineRemoteTeam());
}
export function sanitizeOnlineRoomSelection(league = onlineLeagueNow(), composition = onlineCompositionNow()) {
  const before = JSON.stringify(state_ui_battle_state.selected),
    clean = [];
  for (const raw of Array.isArray(state_ui_battle_state.selected) ? state_ui_battle_state.selected : []) {
    const id = String(raw || ""),
      c = state_catalog_cards.CARDS.find(x => x.id === id);
    if (!c || clean.includes(id) || !state_ui_deck.LeagueFormatOwner.cardAllowed(c, league, composition)) continue;
    if (!state_ui_deck.LeagueFormatOwner.partialValid([...clean, id], league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam())) continue;
    if (clean.length < state_ui_deck.LeagueFormatOwner.deckSize(league)) clean.push(id);
  }
  state_ui_battle_state.selected.splice(0, state_ui_battle_state.selected.length, ...clean);
  return before !== JSON.stringify(state_ui_battle_state.selected);
}
export function onlineDeckIsReady(deck, league = onlineLeagueNow(), composition = onlineCompositionNow(), plusStar = null, team = "P") {
  return state_ui_deck.LeagueFormatOwner.completeValid(deck, league, composition, plusStar, team);
}
export function onlineRoomReadyText() {
  const league = onlineLeagueNow(),
    composition = onlineCompositionNow(),
    remoteComposition = onlineRemoteCompositionNow();
  const mine = onlineDeckIsReady(state_ui_battle_state.selected, league, composition, state_ui_deck.plusStarSelection, onlineLocalTeam());
  const theirs = onlineDeckIsReady(state_ui_deck.p2p.remoteDeck, league, remoteComposition, state_ui_deck.p2p.remotePlusStar, onlineRemoteTeam());
  return `${state_ui_deck.LeagueFormatOwner.definition(league).label}${league === "comprehensive" ? ` · ${state_ui_deck.LeagueFormatOwner.pattern(league, composition).label}` : ""} · 내 덱 ${state_ui_battle_state.selected.length}/4${mine ? " · 준비 완료" : ""} · 상대 덱 ${state_ui_deck.p2p.remoteDeck?.length || 0}/4${theirs ? " · 준비 완료" : ""}`;
}
export function refreshOnlineRoomControls() {
  const state = document.getElementById("roomReadyState");
  if (state) state.textContent = onlineRoomReadyText();
  const start = document.getElementById("onlineRoomStart");
  if (start) {
    const lobbyState = typeof state_online_lobby.LobbyEngine !== "undefined" ? state_online_lobby.LobbyEngine.ready() : null;
    const canStart = state_ui_deck.p2p.role === "host" && !!lobbyState?.local && !!lobbyState?.remote && !!state_online_lobby.LobbyEngine?.hasAuthoritativeState?.() && !state_ui_deck.p2p.onlineStartPending && !state_ui_deck.p2p.battleStarted;
    start.disabled = !canStart;
    if (state_ui_deck.p2p.role !== "host") start.textContent = "상대 준비 대기";else if (state_ui_deck.p2p.onlineStartPending) start.textContent = "선후공 결정 중";else start.textContent = "전투 시작";
  }
}
export function finishOnlineInvaderEdit() {
  sanitizeOnlineRoomSelection(onlineLeagueNow(), onlineCompositionNow());
  state_online_lobby.LobbyEngine.submitDeck();
  systems.OnlineRuntime?.projection?.request?.("invader-edit-complete", {
    phase: "LOBBY"
  });
}
export function clearOnlineInvaderSelection() {
  state_ui_setup.DeckDraftApplication.clearInvaders();
  finishOnlineInvaderEdit();
}
export function applyOnlineInvader(id) {
  const league = onlineLeagueNow(),
    composition = onlineCompositionNow();
  if (!isInvaderCardId(id) || !state_ui_deck.LeagueFormatOwner.cardAllowed(id, league, composition)) return;
  sanitizeOnlineRoomSelection(league, composition);
  const context = {
    mode: league,
    composition,
    plusStar: state_ui_deck.plusStarSelection,
    team: onlineLocalTeam()
  };
  const application = state_ui_setup.DeckDraftApplication.applyInvader(id, 4, context);
  if (application.applied) {
    finishOnlineInvaderEdit();
    return;
  }
  if (!application.needsReplacement) return;
  const c = state_catalog_cards.CARDS.find(x => x.id === id);
  document.getElementById("modalContent").innerHTML = `<div class="invader-selector"><h2>${c?.name || "침략자"} 적용</h2><p>덱이 가득 찼습니다. 교체할 카드를 선택하세요.</p><div class="invader-replace-list">${state_ui_battle_state.selected.map((sid, i) => {
    const sc = state_catalog_cards.CARDS.find(x => x.id === sid);
    return `<button type="button" data-online-invader-replace="${i}">${sc?.name || sid} 교체</button>`;
  }).join("")}</div><div class="invader-selector-actions"><button id="onlineInvaderReplaceCancel" type="button">취소</button></div></div>`;
  document.querySelectorAll("[data-online-invader-replace]").forEach(button => button.onclick = () => {
    const i = Number(button.dataset.onlineInvaderReplace);
    if (!Number.isInteger(i) || i < 0 || i >= state_ui_battle_state.selected.length) return;
    if (!state_ui_setup.DeckDraftApplication.replaceAt(i, id, context)) return;
    finishOnlineInvaderEdit();
  });
  document.getElementById("onlineInvaderReplaceCancel").onclick = renderOnlineInvaderPortal;
}
export function renderOnlineInvaderPortal() {
  state_online_lobby.onlineInvaderPortalIndex = state_ui_battle_state.InvaderPortalView.renderSelector({
    prefix: "invaderPortalOnline",
    index: state_online_lobby.onlineInvaderPortalIndex,
    selectedId: currentSelectedInvader(),
    onIndex: next => {
      state_online_lobby.onlineInvaderPortalIndex = next;
      renderOnlineInvaderPortal();
    },
    onApply: id => applyOnlineInvader(id),
    onClear: clearOnlineInvaderSelection,
    onCancel: () => systems.OnlineRuntime?.projection?.request?.("invader-portal-cancel", {
      phase: "LOBBY",
      allowDuringRestore: true,
      surfaceIntent: "DECK"
    }),
    emptyButtonLabel: "대기실로 돌아가기"
  });
}
export function openOnlineInvaderPortal() {
  const list = invaderCards(),
    current = currentSelectedInvader();
  state_online_lobby.onlineInvaderPortalIndex = Math.max(0, list.findIndex(c => c.id === current));
  renderOnlineInvaderPortal();
  document.getElementById("modal").classList.add("open");
}
/* ================= 온라인 자동매칭 실행 경로 근본 정리 r6 ================= */
