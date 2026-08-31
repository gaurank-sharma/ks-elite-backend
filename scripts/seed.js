import "dotenv/config";
import { createStore } from "../src/lib/store.js";

const TEAM = [
  {
    name: "Chirag Mittal",
    title: "Experienced Advocate",
    exp: "6 years",
    education: "LL.M · All India Bar Examination",
    bio: "Excels at client conferences, contract drafting, and legal pleadings, with results delivered before the Delhi High Court and subordinate courts.",
    tags: ["Bail", "Cheque Bounce", "Civil", "Criminal", "Family", "Writ"],
    image: "/images/team/team_1.jpg",
    order: 0,
  },
  {
    name: "Abhay Kumar",
    title: "Senior Associate Partner",
    exp: "7 years",
    education: "COP, Bar Council of India",
    bio: "Handles cases across all courts and tribunals. Worked with a Senior Counsel of the Supreme Court (2017–2019). Member of the Supreme Court Bar Association and an active RTI transparency advocate.",
    tags: ["Supreme Court", "High Court", "Tribunals", "RTI"],
    image: "/images/team/team_3.jpg",
    order: 1,
  },
  {
    name: "Amrit Rai Gupta",
    title: "Former Ministry of Home Affairs Officer",
    exp: "30 years",
    education: "Prior government service",
    bio: "Represents clients before the Supreme Court, High Courts, and tribunals in civil, criminal, service, matrimonial, banking, and corporate matters.",
    tags: ["Civil", "Corporate", "Banking", "Service Matters"],
    image: "/images/team/team_2.jpg",
    order: 2,
  },
];

const TESTIMONIALS = [
  {
    name: "Jindal Fincap Limited",
    role: "Non-Banking Financial Institution",
    quote: "K.S. Elite Attorneys brought precision and clarity to complex financial disputes, protecting our interests at every stage.",
    order: 0,
  },
  {
    name: "ENAR Weld",
    role: "Welding & Brazing Consumables",
    quote: "Meticulous preparation and a results-driven approach — exactly what we needed for our commercial matters.",
    order: 1,
  },
];

async function seed() {
  const teamStore = createStore("team");
  const testimonialStore = createStore("testimonials");

  const existingTeam = await teamStore.all();
  if (existingTeam.length === 0) {
    for (const member of TEAM) await teamStore.append(member);
    console.log(`Seeded ${TEAM.length} team members.`);
  } else {
    console.log(`Skipped team seed — ${existingTeam.length} already in the database.`);
  }

  const existingTestimonials = await testimonialStore.all();
  if (existingTestimonials.length === 0) {
    for (const t of TESTIMONIALS) await testimonialStore.append(t);
    console.log(`Seeded ${TESTIMONIALS.length} testimonials.`);
  } else {
    console.log(`Skipped testimonials seed — ${existingTestimonials.length} already in the database.`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
