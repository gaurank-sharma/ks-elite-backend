import { getDb } from "./db.js";

// Same shape as the old fs-backed store (append/all/update/remove) so route
// files needed zero changes when this swapped from local JSON files to Mongo.
export function createStore(name) {
  async function collection() {
    const db = await getDb();
    return db.collection(name);
  }

  return {
    async append(entry) {
      const col = await collection();
      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        receivedAt: new Date().toISOString(),
        ...entry,
      };
      await col.insertOne({ ...record });
      return record;
    },
    async all() {
      const col = await collection();
      const docs = await col.find({}, { projection: { _id: 0 } }).sort({ receivedAt: 1 }).toArray();
      return docs;
    },
    async update(id, patch) {
      const col = await collection();
      const result = await col.findOneAndUpdate(
        { id },
        { $set: patch },
        { returnDocument: "after", projection: { _id: 0 } }
      );
      return result ?? null;
    },
    async remove(id) {
      const col = await collection();
      const result = await col.deleteOne({ id });
      return result.deletedCount > 0;
    },
  };
}
