import { Router } from "express";
import { getDb } from "../lib/db.js";
import { requirePermission } from "../lib/adminAuth.js";

const router = Router();

// Groups by the given field, treating missing/blank values as "Unspecified".
// Uses aggregation so we never pull full collections to the app server just
// to count them — these collections can run into the thousands.
async function groupBy(collection, field) {
  const rows = await collection
    .aggregate([
      { $project: { value: { $ifNull: [{ $trim: { input: `$${field}` } }, ""] } } },
      { $project: { value: { $cond: [{ $eq: ["$value", ""] }, "Unspecified", "$value"] } } },
      { $group: { _id: "$value", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  return rows.map((r) => ({ label: r._id, count: r.count }));
}

// receivedAt is stored as an ISO string, so its first 7 characters are the
// YYYY-MM month key directly — no date parsing needed in the pipeline.
async function groupByReceivedMonth(collection, limit = 7) {
  const rows = await collection
    .aggregate([
      { $project: { month: { $substrCP: ["$receivedAt", 0, 7] } } },
      { $group: { _id: "$month", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows
    .map((r) => {
      const [y, m] = r._id.split("-").map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      return { key: r._id, label, count: r.count };
    })
    .reverse();
}

router.get("/", requirePermission("analytics"), async (_req, res) => {
  const db = await getDb();
  const contacts = db.collection("contacts");
  const internships = db.collection("internships");
  const cases = db.collection("cases");
  const subscribers = db.collection("subscribers");

  const today = new Date().toISOString().slice(0, 10);

  const [
    contactsTotal,
    internshipsTotal,
    casesTotal,
    subscribersTotal,
    upcomingCases,
    contactsByMonth,
    contactsByMatter,
    contactsByStatus,
    internshipsByMonth,
    internshipsByMode,
    internshipsByGender,
    internshipsByStatus,
  ] = await Promise.all([
    contacts.countDocuments(),
    internships.countDocuments(),
    cases.countDocuments(),
    subscribers.countDocuments(),
    cases.countDocuments({ nextDate: { $gte: today } }),
    groupByReceivedMonth(contacts),
    groupBy(contacts, "matter"),
    groupBy(contacts, "status"),
    groupBy(internships, "month"),
    groupBy(internships, "mode"),
    groupBy(internships, "gender"),
    groupBy(internships, "status"),
  ]);

  res.json({
    totals: { contacts: contactsTotal, internships: internshipsTotal, cases: casesTotal, subscribers: subscribersTotal, upcomingCases },
    contactsByMonth,
    contactsByMatter,
    contactsByStatus,
    internshipsByMonth: internshipsByMonth
      .sort((a, b) => {
        const da = Date.parse(a.label);
        const db_ = Date.parse(b.label);
        if (!Number.isNaN(da) && !Number.isNaN(db_)) return da - db_;
        return a.label.localeCompare(b.label);
      })
      .slice(-12),
    internshipsByMode,
    internshipsByGender,
    internshipsByStatus,
  });
});

export default router;
