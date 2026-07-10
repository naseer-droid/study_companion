import { promises as fs } from "fs";
import path from "path";
import type { AppData } from "./types";

// StorageAdapter keeps persistence swappable (handoff §4): v1 is a JSON file,
// v2 can drop in Postgres + auth behind the same interface.
export interface StorageAdapter {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}

const EMPTY: AppData = { topics: [] };

class JsonFileStorage implements StorageAdapter {
  constructor(private filePath: string) {}

  async load(): Promise<AppData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.topics)) return parsed as AppData;
      return EMPTY;
    } catch {
      return EMPTY; // missing or corrupt file starts fresh
    }
  }

  async save(data: AppData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Write via a temp file so a crash mid-write can't corrupt the store.
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}

export const storage: StorageAdapter = new JsonFileStorage(
  path.join(process.cwd(), "data", "study-lamp.json")
);
