import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On Vercel the project directory is read-only — /tmp is the only writable path,
// but it's ephemeral (wiped between cold starts) and not shared across instances.
// This keeps writes from crashing there; it is NOT persistent storage. See README.
const DATA_DIR = process.env.VERCEL ? "/tmp/data" : path.join(__dirname, "..", "..", "data");

// Serializes writes per-file so concurrent submissions can't interleave and corrupt the JSON array.
const writeQueues = new Map();

function queueWrite(filePath, task) {
  const prev = writeQueues.get(filePath) ?? Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(filePath, next.catch(() => {}));
  return next;
}

async function readAll(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export function createStore(name) {
  const filePath = path.join(DATA_DIR, `${name}.json`);

  return {
    async append(entry) {
      return queueWrite(filePath, async () => {
        await fs.mkdir(DATA_DIR, { recursive: true });
        const entries = await readAll(filePath);
        const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, receivedAt: new Date().toISOString(), ...entry };
        entries.push(record);
        await fs.writeFile(filePath, JSON.stringify(entries, null, 2));
        return record;
      });
    },
    async all() {
      return readAll(filePath);
    },
    async update(id, patch) {
      return queueWrite(filePath, async () => {
        const entries = await readAll(filePath);
        const idx = entries.findIndex((e) => e.id === id);
        if (idx === -1) return null;
        entries[idx] = { ...entries[idx], ...patch };
        await fs.writeFile(filePath, JSON.stringify(entries, null, 2));
        return entries[idx];
      });
    },
    async remove(id) {
      return queueWrite(filePath, async () => {
        const entries = await readAll(filePath);
        const next = entries.filter((e) => e.id !== id);
        const removed = next.length !== entries.length;
        if (removed) await fs.writeFile(filePath, JSON.stringify(next, null, 2));
        return removed;
      });
    },
  };
}
