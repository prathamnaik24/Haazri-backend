# Database

This directory contains all database-related files for the Attendance Management System.

## Structure

```
database/
├── migrations/          # Versioned schema migration files (currently empty)
├── seeds/               # Reference and lookup data seeds (currently empty)
├── migration-config/
│   └── config.js        # node-pg-migrate configuration
└── README.md            # This file
```

---

## Migration Tool

We use **[`node-pg-migrate`](https://github.com/salsita/node-pg-migrate)** as our versioned migration runner.

It automatically tracks which migration files have been run by storing a record in a `pgmigrations` table inside your database. This means:
- Your team's databases always stay in sync.
- Running `npm run db:migrate` is safe to run multiple times — it only runs files that haven't been applied yet.

---

## Commands

Run from the **project root**:

```bash
# Apply all pending migrations
npm run db:migrate

# Roll back the last migration (development only — never use in production)
npm run db:migrate:down

# Check which migrations have been run and which are pending
npm run db:migrate:status

# Create a new blank migration file
npm run db:create-migration -- 002_create_roles
```

---

## Migration Rules (Non-Negotiable)

1. **All schema changes go through a migration file** — no pgAdmin clicks, no direct SQL on the database, ever.
2. **Never edit a migration that has already been committed and run** — once a migration is in Git history, treat it as immutable.
3. **No destructive queries** — `DROP TABLE`, `DROP COLUMN`, and `TRUNCATE` are forbidden in all migration files.
4. **Every migration must have both `up` and `down` functions** — so local rollbacks are possible during development.
5. **Soft deletes only** — use `is_active = false` or `deleted_at` timestamp instead of deleting rows or columns.

---

## Staging-First Policy (Product Rule)

Since this system will be deployed to paying companies:

> **Every migration MUST be tested on a local or staging environment before it is applied to production.**

Steps for every new migration:
1. Write the migration file locally.
2. Run `npm run db:migrate` locally and verify it works.
3. Run `npm run db:migrate:down` to verify the rollback works.
4. Open a Pull Request — at least one other team member must review and approve it.
5. Only after approval and staging verification, apply it to production.

---

## Migration File Naming

```
NNN_verb_subject.js
```

Examples:
```
001_create_companies.js
002_create_roles_and_departments.js
003_add_is_active_to_offices.js
004_create_attendance_events.js
```

---

## Current Status

- ✅ Migration tool installed and configured
- ✅ Migration rules documented
- ⏳ Migrations folder is **empty** — schema will be written after DB structure is finalized and approved by the team lead
- ⏳ Seeds folder is **empty** — lookup data will be seeded after schema is confirmed
