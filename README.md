# Avighna Foods — Initial Stage

B2B distribution ERP: Lead → Customer → Quotation → Sales Order → Invoice → Payment.

## Stack

- **Frontend:** Lovable UI ([ingredient-flow-suite](https://github.com/TejasviJois/ingredient-flow-suite)) — Vite + TanStack Start (`frontend/`)
- **Backend:** FastAPI + SQLAlchemy (`backend/`)
- **Database:** PostgreSQL via Docker Compose

WhatsApp and AI are deferred (last phase).

## Quick start

```bash
# 1. Start Postgres + API
docker compose up -d --build

# 2. Frontend (Lovable UI wired to API)
cd frontend
npm install
npm run dev
```

- App: http://localhost:3000  
- API docs: http://localhost:8000/docs  

### Seed logins

| Role | Email | Password |
|------|-------|----------|
| Sales | sales@avighnya.local | sales123 |
| Accounts | accounts@avighnya.local | accounts123 |
| Logistics | logistics@avighnya.local | logistics123 |
| Supervisor | supervisor@avighnya.local | super123 |
| Owner | owner@avighnya.local | owner123 |
| Super Admin | admin@avighnya.local | admin123 |

### Companies

1. Asian Apex & Co.  
2. Avighna Speciality Ingredients Pvt Ltd  
3. Ganesh Inc.  
4. Atharva Associates

## Smoke test

```bash
docker compose exec api python -m scripts.smoke
```
