import './weller-probe.js';
import { freshSession } from '../../src/online/commit.js';
import { sessionRuntime } from '../../src/online/session-model.js';
import { state_ui_results, showPvpResult, showVictoryResult } from '../../src/ui/results.js';
import { lockOnlineSettings } from '../../src/online/connection.js';
import { timeCurrentSuppressionDomain, timeClockFaceNode, timeClockMiniHTML, timeSyncSuppressionVisuals } from '../../src/features/timeora.js';
import { timeClockVisualSaturation } from '../../src/presentation/clock-saturation.js';
Object.assign(window, {
  regressionProbe: {
    ready: true, freshSession, sessionRuntime, state_ui_results,
    showPvpResult, showVictoryResult, lockOnlineSettings,
    timeCurrentSuppressionDomain, timeClockFaceNode, timeClockMiniHTML,
    timeSyncSuppressionVisuals, timeClockVisualSaturation
  }
});
