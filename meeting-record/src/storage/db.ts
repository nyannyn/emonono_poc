// SQLite schema + CRUD for meetings

import * as SQLite from 'expo-sqlite';

export interface Meeting {
  id: number;
  title: string;
  started_at: number;       // unix ms
  duration_sec: number | null;
  audio_path: string | null;
  transcript: string | null;
  notes: string | null;
  mode: string | null;      // 'openai' | 'local'
}

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('meetings.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      duration_sec INTEGER,
      audio_path TEXT,
      transcript TEXT,
      notes TEXT,
      mode TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at DESC);
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      voiceprint_paths TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return _db;
}

// ─── Members ────────────────────────────────────────────────

export interface Member {
  id: number;
  name: string;
  voiceprint_paths: string | null;  // JSON array of file URIs
  created_at: number;
}

export async function createMember(name: string, paths: string[]): Promise<number> {
  const d = await db();
  const r = await d.runAsync(
    `INSERT INTO members (name, voiceprint_paths, created_at) VALUES (?, ?, ?)`,
    [name, JSON.stringify(paths), Date.now()],
  );
  return r.lastInsertRowId;
}

export async function listMembers(): Promise<Member[]> {
  const d = await db();
  return d.getAllAsync<Member>(`SELECT * FROM members ORDER BY created_at DESC`);
}

export async function deleteMember(id: number): Promise<void> {
  const d = await db();
  await d.runAsync(`DELETE FROM members WHERE id = ?`, [id]);
}

export async function countMembers(): Promise<number> {
  const d = await db();
  const r = await d.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM members`);
  return r?.n ?? 0;
}

export async function createMeeting(input: Omit<Meeting, 'id'>): Promise<number> {
  const d = await db();
  const r = await d.runAsync(
    `INSERT INTO meetings (title, started_at, duration_sec, audio_path, transcript, notes, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title,
      input.started_at,
      input.duration_sec,
      input.audio_path,
      input.transcript,
      input.notes,
      input.mode,
    ],
  );
  return r.lastInsertRowId;
}

export async function updateMeeting(id: number, patch: Partial<Omit<Meeting, 'id'>>): Promise<void> {
  const fields = Object.keys(patch);
  if (!fields.length) return;
  const d = await db();
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (patch as any)[f]);
  await d.runAsync(`UPDATE meetings SET ${sets} WHERE id = ?`, [...values, id]);
}

export async function listMeetings(): Promise<Meeting[]> {
  const d = await db();
  return d.getAllAsync<Meeting>(`SELECT * FROM meetings ORDER BY started_at DESC`);
}

export async function getMeeting(id: number): Promise<Meeting | null> {
  const d = await db();
  return (await d.getFirstAsync<Meeting>(`SELECT * FROM meetings WHERE id = ?`, [id])) ?? null;
}

export async function deleteMeeting(id: number): Promise<void> {
  const d = await db();
  await d.runAsync(`DELETE FROM meetings WHERE id = ?`, [id]);
}

export async function countMeetings(): Promise<number> {
  const d = await db();
  const r = await d.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM meetings`);
  return r?.n ?? 0;
}

export async function deleteAllMeetings(): Promise<void> {
  const d = await db();
  await d.runAsync(`DELETE FROM meetings`);
}
