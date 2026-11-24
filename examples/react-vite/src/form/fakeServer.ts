import { defaultProfile, type ProfileInput } from './schema';

export type ServerProfile = { values: ProfileInput; revision: string };

// Bump the suffix when the shape of `ProfileInput` changes, so a profile stored in
// an older shape is ignored instead of breaking the form.
const STORAGE_KEY = 'rfh-demo-server-profile:v2';

let memory: ServerProfile | undefined;

const initial = (): ServerProfile => ({ values: structuredClone(defaultProfile), revision: 'r1' });

function readStored(): ServerProfile | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as ServerProfile;
  } catch {
    // Storage is blocked or the entry is corrupt: fall back to memory.
    return undefined;
  }
}

function write(profile: ServerProfile): void {
  memory = profile;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Memory copy above is enough for this session.
  }
}

/** The profile as the "server" currently holds it. Survives a reload within the tab. */
export function readServerProfile(): ServerProfile {
  return structuredClone(readStored() ?? memory ?? initial());
}

const nextRevision = (revision: string): string => `r${Number(revision.slice(1)) + 1}`;

/** Pretends another client saved a change: edits one field and bumps the revision. */
export function simulateRevision(): ServerProfile {
  const { values, revision } = readServerProfile();
  const next = nextRevision(revision);
  const updated = { values: { ...values, name: `Server edit ${next}` }, revision: next };
  write(updated);
  return structuredClone(updated);
}

/** Pretends the form was saved: stores the values and bumps the revision. */
export function saveServerProfile(values: ProfileInput): ServerProfile {
  const next = {
    values: structuredClone(values),
    revision: nextRevision(readServerProfile().revision),
  };
  write(next);
  return structuredClone(next);
}

/** Test helper: back to the initial profile. */
export function resetServerProfile(): void {
  memory = undefined;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
