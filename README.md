# K.S. Elite Attorneys — Backend

Express API for the K.S. Elite Attorneys website: contact/internship lead capture, the
public chatbot, the admin-only blog CMS (with AI drafting and DOCX/PPTX/PDF import), and
admin authentication.

## Local development

```
npm install
cp .env.example .env   # fill in MONGODB_URI, ADMIN_*, LLM_API_KEY, etc.
npm run dev             # http://localhost:4000
```

`server/scripts/set-admin-password.js <password>` prints a bcrypt hash to paste into
`ADMIN_PASSWORD_HASH`.

## Storage

Leads and blog posts live in MongoDB (`src/lib/store.js`, `src/lib/db.js`) — a free M0
Atlas cluster works fine. Uploaded images and files (resumes) use Cloudinary when
`CLOUDINARY_*` env vars are set, falling back to local disk (`server/data/uploads/`,
`server/data/files/`) for local dev (`src/lib/uploads.js`). Images upload as Cloudinary's
`image` resource type; resumes/other documents upload as `raw`.

**Cloudinary dashboard setting**: raw-file delivery (PDFs, ZIPs) is blocked by default on
newer accounts — enable Settings → Security → "Allow delivery of PDF and ZIP files", or
resume links will 401 in the admin leads view.

Storage was originally local JSON files / local disk, which broke in production: Vercel's
serverless filesystem is ephemeral and not shared across instances, so leads, images, and
resumes would inconsistently appear/disappear depending on which instance handled a given
request. Don't reintroduce local-file storage as "temporary" — it silently loses client data
on Vercel.

## Deploying to Vercel

`vercel.json` builds `src/index.js` with `@vercel/node`, which wraps the exported Express
app as a serverless function. Set the same variables from `.env.example` in the Vercel
project's Environment Variables (`MONGODB_URI`, `CLOUDINARY_*`, `ADMIN_*`, `LLM_API_KEY`,
etc.), plus `CORS_ORIGIN` pointed at the deployed frontend.
