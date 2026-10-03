# SkinShield backend

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string. Keep `.env` private and do not commit it.
3. Set `OPENAI_API_KEY` in `.env` to enable AI photo guidance. The app can run without this key; face guidance will report that it is not configured and analysis returns HTTP 503.
4. To manage doctor approvals, generate a random admin key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and set the output as `ADMIN_API_KEY` in `.env`. Never share or commit this key.
5. Start the app with `npm start`.
6. Open `http://localhost:5000` in a browser. Do not open HTML files as `file://` URLs.

The backend initializes the product and app-rating tables before listening. To run the database setup by itself, use `npm run db:init`.

If `.env` has ever been pushed to a shared Git repository, rotate its database password and OpenAI key. Adding `.env` to `.gitignore` prevents new untracked files from being added but does not remove a file that is already tracked or erase it from Git history.

## Doctor approval administration

Open `/admin.html` over HTTPS for deployed sites (or localhost during development), enter the server-configured admin key, and load an existing product by its exact barcode/serial number. Enter the details from a real doctor-issued approval record and confirm the attestation before saving. The key is held in page memory only. Approval management fails closed unless `ADMIN_API_KEY` is configured with at least 32 characters.

The admin API only updates products already in the catalog. It does not independently validate uploaded claims, doctor identity, license status, or certificate authenticity. Only authorized administrators should enter verified records.

## API health

Open `http://localhost:5000/api/health`. A healthy response reports `status: "ok"` and `database: "connected"`. The `skinGuideConfigured` field reports whether an OpenAI key is present; it does not test the key's validity or account quota.

## Main API routes

- `GET /api/verify/:code` — checks the local product database, then public product databases.
- `GET /api/products/search?q=moisturizer` — searches the SkinShield catalog, Open Beauty Facts, and Open Food Facts. These community catalogs are incomplete; a missing match does not mean a product does not exist.
- `GET /api/ratings` and `POST /api/ratings` — read and submit anonymous app ratings.
- `GET /api/skin-guide/status` — checks whether the server has an OpenAI key configured.
- `POST /api/skin-guide` — accepts `{ "image": "data:image/jpeg;base64,...", "consent": true }` and returns tentative visible observations, gentle general-care steps, a basic morning/evening routine, and signs that warrant clinician advice. It cannot diagnose a skin condition; a working OpenAI key and account quota are required. The Analyze button stays unavailable until the server reports that a key is configured.

Product records marked doctor-approved must be reviewed and entered by a trusted administrator. A barcode lookup cannot independently establish doctor approval.
