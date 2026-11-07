/**
 * Performance measurement utility for Town & Canvas rendering.
 *
 * Enabled ONLY when window.__HG_PERF__ === true or localStorage.getItem('hg_perf') === '1'.
 * Zero runtime overhead when disabled (simple boolean guard).
 */

export type PerfSectionName =
  | 'renderOverlay_total'
  | 'background'
  | 'biome'
  | 'boundary'
  | 'rhumb'
  | 'water'
  | 'townObjects'
  | 'autoFillPreview'
  | 'templatePreview'
  | 'townOverlay'
  | 'symbols'
  | 'compassAndFrame'
  | 'previewOverlay';

interface SectionStats {
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
}

interface ConfirmationRecord {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  renderOverlayCalls: number;
}

class TownPerfCollector {
  private enabled: boolean = false;
  private sectionStats: Map<PerfSectionName, SectionStats> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private intervalId: any = null;

  // Rate tracking
  private renderOverlayCallTimestamps: number[] = [];
  private activeConfirmation: ConfirmationRecord | null = null;
  private lastConfirmationStats: { durationMs: number; calls: number } | null = null;

  constructor() {
    this.checkEnabled();
  }

  public checkEnabled(): boolean {
    if (typeof window === 'undefined') {
      this.enabled = false;
      return false;
    }
    const win = window as any;
    const isWinEnabled = win.__HG_PERF__ === true;
    let isStorageEnabled = false;
    try {
      if (typeof localStorage !== 'undefined') {
        isStorageEnabled = localStorage.getItem('hg_perf') === '1';
      }
    } catch {
      // ignore
    }
    const nextEnabled = isWinEnabled || isStorageEnabled;
    if (nextEnabled !== this.enabled) {
      this.enabled = nextEnabled;
      if (this.enabled) {
        this.startReporting();
      } else {
        this.stopReporting();
      }
    }
    return this.enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
    if (typeof window !== 'undefined') {
      (window as any).__HG_PERF__ = val;
    }
    if (val) {
      this.startReporting();
    } else {
      this.stopReporting();
    }
  }

  public start(section: PerfSectionName, keySuffix: string = ''): void {
    if (!this.enabled) return;
    const key = keySuffix ? `${section}_${keySuffix}` : section;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.activeTimers.set(key, now);

    if (section === 'renderOverlay_total') {
      this.renderOverlayCallTimestamps.push(now);
      if (this.activeConfirmation) {
        this.activeConfirmation.renderOverlayCalls++;
      }
    }
  }

  public end(section: PerfSectionName, keySuffix: string = ''): number {
    if (!this.enabled) return 0;
    const key = keySuffix ? `${section}_${keySuffix}` : section;
    const startTime = this.activeTimers.get(key);
    if (startTime === undefined) return 0;
    this.activeTimers.delete(key);

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const duration = Math.max(0, now - startTime);

    let stat = this.sectionStats.get(section);
    if (!stat) {
      stat = { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity };
      this.sectionStats.set(section, stat);
    }
    stat.count++;
    stat.totalMs += duration;
    if (duration > stat.maxMs) stat.maxMs = duration;
    if (duration < stat.minMs) stat.minMs = duration;

    if (section === 'renderOverlay_total' && this.activeConfirmation && !this.activeConfirmation.endTime) {
      this.activeConfirmation.endTime = now;
      this.activeConfirmation.durationMs = now - this.activeConfirmation.startTime;
      this.lastConfirmationStats = {
        durationMs: this.activeConfirmation.durationMs,
        calls: this.activeConfirmation.renderOverlayCalls,
      };
      this.activeConfirmation = null;
    }

    return duration;
  }

  public startConfirmation(label?: string): void {
    if (!this.enabled) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.activeConfirmation = {
      startTime: now,
      renderOverlayCalls: 0,
    };
  }

  public getCallsPerSec(): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const oneSecAgo = now - 1000;
    this.renderOverlayCallTimestamps = this.renderOverlayCallTimestamps.filter((t) => t >= oneSecAgo);
    return this.renderOverlayCallTimestamps.length;
  }

  public getSnapshot(): {
    sections: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }>;
    callsPerSec: number;
    lastConfirmation?: { durationMs: number; calls: number };
  } {
    const sections: Record<string, { count: number; totalMs: number; avgMs: number; maxMs: number }> = {};
    for (const [sec, s] of this.sectionStats.entries()) {
      sections[sec] = {
        count: s.count,
        totalMs: Number(s.totalMs.toFixed(2)),
        avgMs: s.count > 0 ? Number((s.totalMs / s.count).toFixed(2)) : 0,
        maxMs: Number(s.maxMs.toFixed(2)),
      };
    }
    return {
      sections,
      callsPerSec: this.getCallsPerSec(),
      lastConfirmation: this.lastConfirmationStats || undefined,
    };
  }

  public reset(): void {
    this.sectionStats.clear();
    this.activeTimers.clear();
    this.renderOverlayCallTimestamps = [];
    this.activeConfirmation = null;
    this.lastConfirmationStats = null;
  }

  private startReporting(): void {
    if (this.intervalId || typeof window === 'undefined') return;
    this.intervalId = setInterval(() => {
      this.report();
    }, 2000);
  }

  private stopReporting(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public report(): void {
    if (!this.enabled || this.sectionStats.size === 0) return;
    const snap = this.getSnapshot();
    const callsPerSec = snap.callsPerSec;
    const confirmInfo = snap.lastConfirmation
      ? ` | 確定→反映: ${snap.lastConfirmation.durationMs.toFixed(1)}ms (${snap.lastConfirmation.calls} calls)`
      : '';

    // Format console output
    console.group(`[HG_PERF 2s 集計] renderOverlay: ${callsPerSec} calls/sec${confirmInfo}`);
    if (typeof console.table === 'function') {
      console.table(snap.sections);
    } else {
      console.log(snap.sections);
    }
    console.groupEnd();
  }
}

export const townPerf = new TownPerfCollector();
