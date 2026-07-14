import { MESSAGE_TYPES } from "../constants/messages";

export async function getTelemetry(tabId) {
  // 1. Fetch live storage/permissions from Content Script
  const contentData = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.SCAN_STORAGE }, (response) => {
      if (chrome.runtime.lastError) { /* ignore to prevent unchecked error */ }
      resolve(response || { storage: {}, permissions: {} });
    });
  });

  // 2. Fetch raw network/cookie/page telemetry from Background Script
  const backgroundData = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_TELEMETRY_DATA" }, (response) => {
      resolve(response || null);
    });
  });

  // 3. Merge and Normalize
  if (!backgroundData) return null;

  backgroundData.storage = contentData.storage;
  backgroundData.permissions = contentData.permissions;

  return backgroundData;
}