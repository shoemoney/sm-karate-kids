import { loadValue, saveValue } from './persist.js';

export interface Settings {
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly largeControls: boolean;
  /** Mirrors which screen side the stance and technique sticks render on. */
  readonly leftHanded: boolean;
  readonly muted: boolean;
  readonly showPerf: boolean;
}

const SETTINGS_KEY = 'settings';

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

function defaultSettings(): Settings {
  return {
    reducedMotion: prefersReducedMotion(),
    highContrast: false,
    largeControls: false,
    leftHanded: false,
    muted: false,
    showPerf: false,
  };
}

function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['reducedMotion'] === 'boolean' &&
    typeof record['highContrast'] === 'boolean' &&
    typeof record['largeControls'] === 'boolean' &&
    typeof record['leftHanded'] === 'boolean' &&
    typeof record['muted'] === 'boolean' &&
    typeof record['showPerf'] === 'boolean'
  );
}

export type SettingsListener = (settings: Readonly<Settings>) => void;

/**
 * Live settings, persisted to localStorage through persist.ts, with a small
 * pub/sub so UI controls (checkboxes, CSS classes, audio mute) stay in sync
 * with whatever last changed them.
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor() {
    this.current = loadValue(SETTINGS_KEY, isSettings, defaultSettings());
  }

  get(): Readonly<Settings> {
    return this.current;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.current[key] === value) return;
    this.current = { ...this.current, [key]: value };
    saveValue(SETTINGS_KEY, this.current);
    this.notify();
  }

  /** Calls `listener` immediately with the current value, then on every change. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}
