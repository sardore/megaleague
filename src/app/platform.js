import { systems } from "../runtime/systems.js";
export function initializeAppPlatform() {
  (() => {
    "use strict";

    const records = [];
    const record = (error, site = "legacy") => {
      const entry = {
        site: String(site || "legacy"),
        name: String(error?.name || "Error"),
        message: String(error?.message || error || "unknown error"),
        stack: String(error?.stack || ""),
        createdAt: Date.now()
      };
      records.push(entry);
      if (records.length > 500) records.splice(0, records.length - 500);
      if (systems.DEBUG_RECOVERED_ERRORS) console.warn("[RecoveredError]", entry);
      return entry;
    };
    Object.defineProperty(systems, "__megaRecoveredErrors", {
      value: records,
      configurable: false,
      writable: false
    });
    Object.defineProperty(systems, "__megaRecordRecoveredError", {
      value: record,
      configurable: false,
      writable: false
    });
  })();
}
