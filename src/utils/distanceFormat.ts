/**
 * Utility functions for formatting real-world distances across
 * planetary world maps, regional maps, and sub-kilometer town maps.
 */

export function formatDistance(km: number): string {
  if (km < 1) {
    const meters = Math.max(1, Math.round(km * 1000));
    return `${meters} m`;
  }
  if (km < 10) {
    const rounded = Number(km.toFixed(1));
    return `${rounded} km`;
  }
  return `${Math.round(km).toLocaleString()} km`;
}
