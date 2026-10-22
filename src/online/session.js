// Owned mutable state. Imported by the subsystem and its explicit consumers.
export const state_online_session = {
  OnlineRuntime: undefined,
  onlineEntryButton: undefined
};
import { sessionRuntime } from "./session-model.js";
import { initializeOnlineSessionConfig, initializeOnlineSessionConfigStep36 } from "./session-config.js";
import { initializeOnlineProjection } from "./projection.js";
import { initializeOnlineRestore } from "./restore.js";
import { initializeOnlineIntents } from "./intents.js";
import { initializeOnlineRouter } from "./router.js";
import { initializeOnlineMatching } from "./matching.js";
import { initializeOnlineCleanup } from "./cleanup.js";
import { initializeOnlineLifecycle } from "./lifecycle.js";
import { initializeUiOnlineEntry } from "../ui/online-entry.js";
import { initializeOnlineSpectatorTransport } from "./spectator-transport.js";
import { initializeOnlineSessionDebug } from "./session-debug.js";
import { initializeOnlineSessionApi } from "./session-api.js";
export function initializeOnlineSession() {
  initializeOnlineSessionConfig();
  initializeOnlineProjection();
  initializeOnlineRestore();
  initializeOnlineSessionConfigStep36();
  initializeOnlineIntents();
  initializeOnlineRouter();
  initializeOnlineMatching();
  initializeOnlineCleanup();
  initializeOnlineLifecycle();
  initializeUiOnlineEntry();
  initializeOnlineSpectatorTransport();
  initializeOnlineSessionDebug();
  initializeOnlineSessionApi();
  state_online_session.OnlineRuntime = sessionRuntime.api;
  state_online_session.onlineEntryButton = document.getElementById("onlineBtn");
  if (state_online_session.onlineEntryButton) state_online_session.onlineEntryButton.onclick = state_online_session.OnlineRuntime.ui.handleMainOnlineEntry;
  state_online_session.OnlineRuntime.ui.consumeInitialIntent();
}
