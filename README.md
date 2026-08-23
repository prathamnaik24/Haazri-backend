# Haazri Backend

Event-driven, multi-tenant REST API backend for the **Haazri Attendance Management System**.

## 🚀 Tech Stack
- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js 4
- **Database:** PostgreSQL 16 (with `ltree` extension for organizational hierarchy)
- **Migrations:** `node-pg-migrate`
- **Testing:** Vitest + Supertest

---

## 📋 Prerequisites
- **Node.js:** v18+ or v20+
- **PostgreSQL:** v16+ (or running via Docker)
- **npm** or **pnpm**

---

## 🛠️ Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/prathamnaik24/Haazri-backend.git
   cd Haazri-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env` and fill in your database credentials:
   ```bash
   cp .env.example .env
   ```

   | Variable | Default / Example | Description |
   | :--- | :--- | :--- |
   | `PORT` | `5002` | Server port |
   | `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/haazri` | PostgreSQL connection string |
   | `JWT_ACCESS_SECRET` | `your_secret` | JWT access token secret |
   | `JWT_REFRESH_SECRET` | `your_secret` | JWT refresh token secret |
   | `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins |
   | `FRONTEND_URL` | `http://localhost:5173` | Frontend application URL |

---

## 🗄️ Database Migrations & Seeding

1. **Run all pending migrations:**
   ```bash
   npm run db:migrate
   ```

2. **Seed development database:**
   ```bash
   npm run db:seed
   ```

3. **Create a new migration (when schema changes):**
   ```bash
   npm run db:create-migration <migration-name>
   ```

---

## 🏃 Running the Server

- **Development Mode (with auto-reload):**
  ```bash
  npm run dev
  ```

- **Production Mode:**
  ```bash
  npm start
  ```

- **API Base URL:** `http://localhost:5002/api`
- **Health Check Endpoint:** `http://localhost:5002/api/health`

---

## 🧪 Running Tests

```bash
npm test
```

---

## 🔒 Security Rules
- **Never commit `.env` or any production secrets** to source control.
- Keep `.env.example` updated whenever new environment variables are added.
