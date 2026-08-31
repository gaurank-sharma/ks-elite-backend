# K.S. Elite Attorneys — Backend

Express API for the K.S. Elite Attorneys website: contact/internship lead capture, the
public chatbot, the admin-only blog CMS (with AI drafting and DOCX/PPTX/PDF import), and
admin authentication.

## Local development

```
npm install
cp .env.example .env   # fill in ADMIN_*, LLM_API_KEY, etc.
npm run dev             # http://localhost:4000
```

`server/scripts/set-admin-password.js <password>` prints a bcrypt hash to paste into
`ADMIN_PASSWORD_HASH`.

## Deploying to Vercel

`vercel.json` builds `src/index.js` with `@vercel/node`, which wraps the exported Express
app as a serverless function. Set the same variables from `.env.example` in the Vercel
project's Environment Variables, plus `CORS_ORIGIN` pointed at the deployed frontend.

### ⚠️ Storage is not persistent on Vercel

Leads, blog posts, and uploaded images are currently stored as JSON files / images on
local disk (`server/data/`). That works for local dev and any traditional always-on host,
but **Vercel's serverless filesystem is read-only and ephemeral** — writes are redirected
to `/tmp` so requests don't crash, but `/tmp` is wiped between cold starts and isn't shared
across concurrent instances. In practice: consultation leads, internship applications, and
blog posts submitted on the live Vercel deployment **can silently disappear**.

Before relying on this in production, swap `src/lib/store.js` for a real database (Vercel
Postgres, MongoDB Atlas, Supabase — all have free tiers) and `src/lib/uploads.js` for
object storage (Vercel Blob, Cloudinary, S3). Everything else (routes, auth, the LLM
integration) is unaffected by that swap.
