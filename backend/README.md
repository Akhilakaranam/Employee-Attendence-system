# Employee Attendance API

## Setup

1. Create the database and tables by running `schema.sql` in MySQL.
2. Copy `.env.example` to `.env` and set the MySQL password and a long JWT secret.
3. Start the API:

```powershell
npm start
```

This workspace uses MySQL Server 8.4 with a local data directory at `backend/data/mysql`. Start MySQL before the API if it is not already running:

```powershell
$mysqlRoot = "C:\Program Files\MySQL\MySQL Server 8.4"
$dataDir = "$PWD\data\mysql"
& "$mysqlRoot\bin\mysqld.exe" --basedir="$mysqlRoot" --datadir="$dataDir" --port=3306 --console
```

In a second terminal, run `npm start` from `backend`.

The API uses a 40-connection MySQL pool, a bounded request queue, indexed attendance lookups, and paginated admin reports. This supports a 1,000-employee deployment when the database and Node host have sufficient CPU, memory, and network capacity. Tune `DB_POOL_SIZE` and `DB_QUEUE_LIMIT` in `.env` for a production server rather than opening one database connection per employee.

The API runs at `http://localhost:5000`.

## Deploy the full app on Render

The repository includes `render.yaml`. In Render, choose **New > Blueprint** and select this GitHub repository. Set the external MySQL values when prompted: `DB_HOST`, `DB_USER`, and `DB_PASSWORD`. Run `schema.sql` against that MySQL database before using the API. Render will provide the public URL and `/api/health` will be used as the health check.

Opening the Render service URL serves both the frontend and backend together, so relative API calls work without extra frontend configuration. GitHub Pages remains a static frontend preview only.

For an Android emulator, use `http://10.0.2.2:5000` instead of `localhost`. For a physical device, use the computer's local network IP.

## API outline

- `POST /api/auth/register` - create an employee account
- `POST /api/auth/login` - receive a JWT token
- `POST /api/auth/admin-login` - receive a JWT token only for active administrator accounts
- `GET /api/auth/me` - current user
- `POST /api/attendance/check-in` - record WFO/WFH attendance; late check-in requires `lateReason`
- `PATCH /api/attendance/check-out` - record exit time
- `GET /api/attendance/today` - current employee's present/absent status and times
- `GET /api/attendance/history?month=YYYY-MM` - employee history
- `GET /api/attendance/summary?month=YYYY-MM` - monthly totals and percentage
- `POST /api/leaves`, `GET /api/leaves` - leave requests
- `GET /api/holidays?month=YYYY-MM` - monthly holidays
- `GET /api/admin/employees` - admin employee list
- `POST /api/admin/employees` - admin creates an employee
- `PATCH /api/admin/employees/:id/status` - activate or deactivate an employee
- `GET /api/admin/leaves` - admin leave-request list
- `GET /api/admin/attendance?month=YYYY-MM` - admin attendance view
- `GET /api/reports/late?month=YYYY-MM` - admin late report
- `GET /api/admin/dashboard?month=YYYY-MM` - admin totals for employees, attendance, work modes, leaves, holidays, and late arrivals
- `PUT /api/admin/attendance/:userId/:date/absent` - mark an employee absent
- `PATCH /api/admin/leaves/:id` - approve or mark leave unapproved
- `POST /api/admin/holidays` - create a holiday
- `GET /api/admin/holidays?month=YYYY-MM` - admin holiday list
- `DELETE /api/admin/holidays/:id` - remove a holiday

Send the JWT on protected requests as `Authorization: Bearer <token>`.

## Important

Registration creates employee accounts only. Create the first administrator directly in MySQL by registering an employee, then running:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
```
