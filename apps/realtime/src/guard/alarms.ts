/**
 * Evaluasi alarm dari snapshot metrik (13 §12, P09). Fungsi murni: dipanggil berkala dari index.ts, hasilnya
 * ditulis sebagai log `alarm.*` level error (ditangkap sistem log produksi → pager; wiring pager = P10).
 */
export interface Alarm {
  name: string;
  detail: Record<string, number>;
}

/** Counter yang kenaikannya selama satu interval dianggap alarm. */
const COUNTER_ALARMS: Record<string, string> = {
  cleanup_failures_total: "alarm.cleanup_failed",
  orphan_sweep_failures_total: "alarm.orphan_sweep_failed",
  editor_snapshot_failures_total: "alarm.editor_snapshot_failed",
  store_unavailable_total: "alarm.store_unavailable",
};

export function evaluateAlarms(prev: Record<string, number>, cur: Record<string, number>): Alarm[] {
  const out: Alarm[] = [];
  for (const [counter, name] of Object.entries(COUNTER_ALARMS)) {
    const delta = (cur[counter] ?? 0) - (prev[counter] ?? 0);
    if (delta > 0) out.push({ name, detail: { delta } });
  }
  const skew = cur["capture_skew_ms_p95"];
  if (skew !== undefined && skew > 300) out.push({ name: "alarm.capture_skew", detail: { p95: skew } });
  const orphans = cur["storage_orphan_objects"];
  if (orphans !== undefined && orphans > 0) out.push({ name: "alarm.storage_orphans", detail: { objects: orphans } });
  const unresolved = cur["cleanup_unresolved"];
  if (unresolved !== undefined && unresolved > 0) out.push({ name: "alarm.cleanup_unresolved", detail: { rooms: unresolved } });
  return out;
}
