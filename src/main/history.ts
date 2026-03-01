import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface HistoryEntry {
  method: string;
  urlOrPath: string;
  date: string;
}

const MAX_ENTRIES = 100;

function getHistoryPath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

export function loadHistory(): HistoryEntry[] {
  try {
    const p = getHistoryPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading history:', e);
  }
  return [];
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    fs.writeFileSync(getHistoryPath(), JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2));
  } catch (e) {
    console.error('Error saving history:', e);
  }
}

export function addToHistory(entry: Omit<HistoryEntry, 'date'>): void {
  const list = loadHistory();
  list.unshift({
    ...entry,
    date: new Date().toISOString()
  });
  saveHistory(list);
}

export function getHistory(): HistoryEntry[] {
  return loadHistory();
}
