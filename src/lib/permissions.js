// Every section a scoped admin user can be granted access to. "*" (full access)
// is reserved for the root env-based admin and is never assignable to a
// created user — see requireSuperAdmin in adminAuth.js.
export const SECTIONS = [
  { key: "leads_contact", label: "Consultation Leads" },
  { key: "leads_internship", label: "Internship Applications" },
  { key: "cases", label: "Case Management" },
  { key: "posts", label: "Blog Posts" },
  { key: "team", label: "Team" },
  { key: "testimonials", label: "Testimonials" },
  { key: "subscribers", label: "Subscribers" },
  { key: "analytics", label: "Analytics" },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);

export function hasPermission(permissions, section) {
  if (!Array.isArray(permissions)) return false;
  return permissions.includes("*") || permissions.includes(section);
}
