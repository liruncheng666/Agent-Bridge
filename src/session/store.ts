import { readFile } from 'node:fs/promises';
import type { AccessMode } from '../config/permissions';
import { paths } from '../config/paths';
import { log } from '../core/logger';
import { writeFileAtomic } from '../platform/atomic-write';

export interface SessionEntry {
  /** May be absent if the entry was created by /timeout before any run
   * recorded a session id. Treat absence as "no resumable session". */
  sessionId?: string;
  /** Pinned cwd for the resumable session. Absent for the same reason. */
  cwd?: string;
  updatedAt: number;
  /** Per-scope idle-timeout override (minutes). 0 = explicitly off for this
   * scope, undefined = follow global default. Session resets preserve this
   * scope preference while removing the resumable session id/cwd. */
  idleTimeoutMinutes?: number;
  /** Per-scope Claude model override (SR-4). undefined = follow the bridge
   * default model. Preserved across session resets like idleTimeoutMinutes. */
  model?: string;
  /** Per-scope access override (SR-5). undefined = follow profile permissions.
   * Still subject to the SR-1 scenario ceiling at policy evaluation time, so
   * this can never raise access above what the chat scenario allows. */
  accessOverride?: AccessMode;
}

type SessionMap = Record<string, SessionEntry>;

export class SessionStore {
  private data: SessionMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.sessionsFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const raw = JSON.parse(text) as Record<string, Partial<SessionEntry>>;
      this.data = {};
      for (const [chatId, entry] of Object.entries(raw)) {
        if (!entry || typeof entry.updatedAt !== 'number') continue;
        // Drop entries without a `cwd`/`sessionId` pair *unless* there's
        // some other persisted state worth keeping (e.g. an idle-timeout
        // override). Resuming a session whose cwd we don't know about
        // would hang claude on a missing jsonl, so resume keys still need
        // the full pair; but a bare timeout override is fine on its own.
        const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : undefined;
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
        const idleTimeoutMinutes =
          typeof entry.idleTimeoutMinutes === 'number' ? entry.idleTimeoutMinutes : undefined;
        const model = typeof entry.model === 'string' ? entry.model : undefined;
        const accessOverride = isAccessMode(entry.accessOverride) ? entry.accessOverride : undefined;
        const hasSession = sessionId !== undefined && cwd !== undefined;
        const hasPreference =
          idleTimeoutMinutes !== undefined || model !== undefined || accessOverride !== undefined;
        if (!hasSession && !hasPreference) continue;
        this.data[chatId] = {
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(cwd !== undefined ? { cwd } : {}),
          updatedAt: entry.updatedAt,
          ...(idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes } : {}),
          ...(model !== undefined ? { model } : {}),
          ...(accessOverride !== undefined ? { accessOverride } : {}),
        };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * Return the session id for this chat if it was created in the given cwd.
   * Sessions recorded in a different cwd are stale — claude can't resume
   * them from a different working directory.
   */
  resumeFor(chatId: string, cwd: string): string | undefined {
    const entry = this.data[chatId];
    if (!entry) return undefined;
    if (entry.cwd !== cwd) return undefined;
    return entry.sessionId;
  }

  getRaw(chatId: string): SessionEntry | undefined {
    return this.data[chatId];
  }

  set(chatId: string, sessionId: string, cwd: string): void {
    // Preserve per-scope preferences (idle-timeout, model, access override)
    // across run starts — they're scope preferences, not per-run-instance
    // state. /new (clear) wipes the resume pair but keeps these.
    const prev = this.data[chatId];
    this.data[chatId] = {
      sessionId,
      cwd,
      updatedAt: Date.now(),
      ...preferenceFields(prev),
    };
    this.schedulePersist();
  }

  clear(chatId: string): void {
    const prev = this.data[chatId];
    if (!prev) return;
    const prefs = preferenceFields(prev);
    if (Object.keys(prefs).length > 0) {
      this.data[chatId] = {
        ...prefs,
        updatedAt: Date.now(),
      };
    } else {
      delete this.data[chatId];
    }
    this.schedulePersist();
  }

  /** Per-scope idle-timeout override. `undefined` means no override set. */
  getIdleTimeoutMinutes(chatId: string): number | undefined {
    return this.data[chatId]?.idleTimeoutMinutes;
  }

  setIdleTimeoutMinutes(chatId: string, minutes: number): void {
    const clamped = Math.min(Math.max(Math.floor(minutes), 0), 120);
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      idleTimeoutMinutes: clamped,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  /** Remove the override so this scope falls back to the global default.
   * Returns true if something was actually removed. */
  clearIdleTimeoutOverride(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.idleTimeoutMinutes === undefined) return false;
    const { idleTimeoutMinutes: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  /** Per-scope Claude model override (SR-4). undefined = bridge default. */
  getModel(chatId: string): string | undefined {
    return this.data[chatId]?.model;
  }

  setModel(chatId: string, model: string): void {
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      model,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  /** Remove the model override. Returns true if something was removed. */
  clearModel(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.model === undefined) return false;
    const { model: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  /** Per-scope access override (SR-5). undefined = follow profile permissions.
   * Still clamped by the SR-1 scenario ceiling at policy time. */
  getAccessOverride(chatId: string): AccessMode | undefined {
    return this.data[chatId]?.accessOverride;
  }

  setAccessOverride(chatId: string, access: AccessMode): void {
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      accessOverride: access,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  /** Remove the access override. Returns true if something was removed. */
  clearAccessOverride(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.accessOverride === undefined) return false;
    const { accessOverride: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.data, null, 2)}\n`, {
          mode: 0o600,
        });
      })
      .catch((err: unknown) => {
        log.fail('session', err, { step: 'persist' });
      });
  }
}

/** Per-scope preferences preserved across session set/clear (not per-run state). */
function preferenceFields(
  entry: SessionEntry | undefined,
): Partial<Pick<SessionEntry, 'idleTimeoutMinutes' | 'model' | 'accessOverride'>> {
  if (!entry) return {};
  return {
    ...(entry.idleTimeoutMinutes !== undefined
      ? { idleTimeoutMinutes: entry.idleTimeoutMinutes }
      : {}),
    ...(entry.model !== undefined ? { model: entry.model } : {}),
    ...(entry.accessOverride !== undefined ? { accessOverride: entry.accessOverride } : {}),
  };
}

function isAccessMode(value: unknown): value is AccessMode {
  return value === 'read-only' || value === 'workspace' || value === 'full';
}
