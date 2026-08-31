import { MongoClient } from "mongodb";

// Cached across warm serverless invocations so we don't open a new connection
// on every request — MongoDB's recommended pattern for Vercel/Lambda.
let clientPromise;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured on the server.");

  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

export async function getDb() {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || "ks_elite");
}
