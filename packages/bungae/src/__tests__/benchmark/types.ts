/**
 * Benchmark types and interfaces
 */

export interface TimingResult {
  name: string;
  duration: number; // milliseconds
  startTime: number;
  endTime: number;
}

export interface BenchmarkResult {
  bundler: 'metro' | 'bungae';
  platform: 'ios' | 'android';
  mode: 'dev' | 'release';
  totalTime: number;
  phases: TimingResult[];
  bundleSize: number; // bytes
  moduleCount: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface ComparisonResult {
  metro: BenchmarkResult;
  bungae: BenchmarkResult;
  speedup: number; // bungae speedup ratio (metro time / bungae time)
  sizeDiff: number; // size difference in bytes (metro - bungae)
  sizeDiffPercent: number; // size difference percentage
}

export interface BenchmarkSummary {
  comparisons: ComparisonResult[];
  bungaePhases: {
    name: string;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  }[];
  timestamp: Date;
  gitCommit?: string;
  gitBranch?: string;
}

export interface PhaseTimer {
  start: (phaseName: string) => void;
  end: (phaseName: string) => void;
  getResults: () => TimingResult[];
  reset: () => void;
}

/**
 * Create a phase timer for measuring build phases
 */
export function createPhaseTimer(): PhaseTimer {
  const phases: Map<string, { startTime: number; endTime?: number }> = new Map();
  const results: TimingResult[] = [];

  return {
    start(phaseName: string) {
      const existing = phases.get(phaseName);
      if (existing && existing.endTime === undefined) {
        console.warn(
          `Phase "${phaseName}" has already been started and not ended; overwriting previous start.`,
        );
      }
      phases.set(phaseName, { startTime: performance.now() });
    },

    end(phaseName: string) {
      const phase = phases.get(phaseName);
      if (phase && !phase.endTime) {
        phase.endTime = performance.now();
        results.push({
          name: phaseName,
          duration: phase.endTime - phase.startTime,
          startTime: phase.startTime,
          endTime: phase.endTime,
        });
      }
    },

    getResults() {
      return [...results];
    },

    reset() {
      phases.clear();
      results.length = 0;
    },
  };
}
