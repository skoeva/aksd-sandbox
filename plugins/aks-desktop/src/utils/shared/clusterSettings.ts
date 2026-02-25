// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Reads and parses cluster settings from localStorage.
 * Returns a plain object (null-prototype) with the parsed settings,
 * or an empty object if the key is missing or unparseable.
 */
export function getClusterSettings(clusterName: string): Record<string, any> {
  try {
    const raw = localStorage.getItem(`cluster_settings.${clusterName}`);
    const settings: Record<string, any> = Object.create(null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(settings, parsed);
      }
    }
    return settings;
  } catch {
    return Object.create(null);
  }
}

/**
 * Writes cluster settings back to localStorage.
 */
export function setClusterSettings(clusterName: string, settings: Record<string, any>): void {
  localStorage.setItem(`cluster_settings.${clusterName}`, JSON.stringify(settings));
}
