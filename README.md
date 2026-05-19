# Rent Tracker — Backend API

Node.js + Express + PostgreSQL backend for the Rent Payment Tracker app.

---

## Tech stack

| Layer | Technology | Free tier |
|---|---|---|
| API server | Node.js + Express | Render (free) |
| Database | PostgreSQL | Neon (free, 0.5 GB) |
| Auth | JWT (bcryptjs) | Built-in |
| Email reminders | Resend | 3,000 emails/month free |
| SMS reminders | Termii (Nigeria) | Free trial credits |
| Frontend host | Vercel | Free forever |

---

## Project structure

```
src/
├── index.js              # Express app + startup
├── db/
│   ├── pool.js           # PostgreSQL connection pool
│   ├── migrate.js        # Creates all tables (run once)
│   └── seed.js           # Optional sample data
├── middleware/
│   └── auth.js           # JWT verification middleware
├── routes/
│   ├── auth.js           # Register, login, profile
│   ├── properties.js     # Properties CRUD
│   ├── payments.js       # Payment records + receipts
│   └── leases.js         # Lease renewal + termination
├── jobs/
│   └── reminderJob.js    # Daily cron — email + SMS alerts
└── utils/
    └── notifications.js  # Resend email + Termii SMS helpers
```

---

## Local setup

### 1. Clone and install
```bash
git clone https://github.com/yourname/rent-tracker-backend.git
cd rent-tracker-backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in all values
```

### 3. Create your free Neon database
1. Go to https://neon.tech and sign up (free)
2. Create a new project → name it `renttracker`
3. Copy the connection string and paste into `DATABASE_URL` in `.env`

### 4. Run migrations (creates all tables)
```bash
npm run db:migrate
```

### 5. Start the dev server
```bash
npm run dev
# API runs at http://localhost:5000
# Health check: http://localhost:5000/health
```

---

## API reference

### Auth

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, get JWT |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/me` | Update profile |

**Register body:**
```json
{ "name": "Ajibola Sodiq", "email": "you@email.com", "password": "secret123", "phone": "+2348012345678" }
```

**Login response:**
```json
{ "token": "eyJ...", "user": { "id": 1, "name": "Ajibola Sodiq", "email": "you@email.com" } }
```

All protected routes require header:
```
Authorization: Bearer <token>
```

---

### Properties

| Method | Route | Description |
|---|---|---|
| GET | `/api/properties` | List all (with tenant + lease) |
| POST | `/api/properties` | Add property + tenant + lease |
| GET | `/api/properties/:id` | Single property detail |
| PUT | `/api/properties/:id` | Update address / notes |
| DELETE | `/api/properties/:id` | Delete property |

**POST body:**
```json
{
  "address": "24 Kofo Abayomi St, VI",
  "city": "Lagos",
  "state": "Lagos State",
  "country": "Nigeria",
  "tenant_name": "Oluwaseun Adeyemi",
  "occupation": "Accountant",
  "phone": "+234 803 456 7890",
  "email": "seun@email.com",
  "notes": "Parking slot A1 allocated.",
  "move_in_date": "2024-01-15",
  "start_date": "2024-01-15",
  "yearly_rent": 900000,
  "duration_months": 12
}
```

---

### Payments

| Method | Route | Description |
|---|---|---|
| GET | `/api/payments?property_id=X` | List payments |
| POST | `/api/payments` | Record payment |
| GET | `/api/payments/:id/receipt` | Full receipt data |
| DELETE | `/api/payments/:id` | Delete record |

**POST body:**
```json
{ "lease_id": 1, "amount": 900000, "paid_date": "2025-01-15", "note": "Renewal 2025" }
```

---

### Leases

| Method | Route | Description |
|---|---|---|
| GET | `/api/leases?property_id=X` | Full lease history |
| POST | `/api/leases/:id/renew` | Renew (extend) lease |
| POST | `/api/leases/:id/terminate` | Terminate lease |

**Renew body (optional — override rent amount):**
```json
{ "yearly_rent": 1000000 }
```

---

## Deployment — 100% free

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/Musty2025x/rent-tracker-backend.git
git push -u origin main
```

### Step 2 — Deploy to Render
1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo
3. Render auto-detects `render.yaml`
4. Set environment variables manually in the Render dashboard:
   - `DATABASE_URL` → your Neon connection string
   - `RESEND_API_KEY` → from resend.com
   - `TERMII_API_KEY` → from termii.com
   - `REMINDER_TO_EMAIL` → your email
   - `REMINDER_PHONE` → your phone (+2348...)
   - `FRONTEND_URL` → your Vercel frontend URL
5. Click **Deploy**. Your API will be live at:
   `https://rent-tracker-api.onrender.com`

### Step 3 — Run migrations on Render
In the Render dashboard → Shell:
```bash
npm run db:migrate
```

---

## Reminders

The cron job runs **daily at 08:00 WAT** (Africa/Lagos timezone).

Reminders are sent when a lease is **60, 30, 14, 7 days** before expiry and on the **day of expiry**. The `reminder_logs` table prevents duplicate sends.

To test the job manually:
```bash
node -e "require('./src/jobs/reminderJob').runReminderJob()"
```

---

## Connecting the frontend

In your React/Vite frontend, set:
```
VITE_API_URL=https://rent-tracker-api.onrender.com
```

Then call the API:
```js
const res = await fetch(`${import.meta.env.VITE_API_URL}/api/properties`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await res.json();
```

---

## License
MIT — built for Musty's DevOps + personal project portfolio.
