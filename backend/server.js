require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./config/database");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "change-this-development-secret";
const WORK_START = process.env.WORK_START || "09:00:00";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

const requestCounts = new Map();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 240;
app.use((req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const current = requestCounts.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
        requestCounts.set(key, { startedAt: now, count: 1 });
        return next();
    }
    current.count += 1;
    if (current.count > RATE_LIMIT) return res.status(429).json({ message: "Too many requests. Please try again shortly." });
    next();
});

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const query = (sql, values = []) => db.promise().query(sql, values);

function signToken(user) {
    return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: "12h" });
}

function auth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Authentication token is required" });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid or expired authentication token" });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Administrator access is required" });
    next();
}

function required(value, field) {
    if (value === undefined || value === null || value === "") {
        const error = new Error(`${field} is required`);
        error.status = 400;
        throw error;
    }
}

function monthRange(month) {
    const value = month || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        const error = new Error("month must use YYYY-MM format");
        error.status = 400;
        throw error;
    }
    const year = Number(value.slice(0, 4));
    const monthNumber = Number(value.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { month: value, start: `${value}-01`, end: `${value}-${String(lastDay).padStart(2, "0")}` };
}

function businessDates(month) {
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7)) - 1;
    const dates = [];
    for (let day = 1; day <= new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); day += 1) {
        const date = new Date(Date.UTC(year, monthIndex, day));
        if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}

function pagination(queryParams) {
    const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(queryParams.limit, 10) || 50));
    return { page, limit, offset: (page - 1) * limit };
}

app.get("/api/health", (req, res) => res.json({ name: "Employee Attendance Management System API", status: "running" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));
app.get("/test-db", asyncRoute(async (req, res) => {
    await query("SELECT 1");
    res.json({ message: "Database connection successful" });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const { name, email, password, employeeCode } = req.body;
    required(name, "name");
    required(email, "email");
    required(password, "password");
    if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters" });
    const normalizedEmail = email.toLowerCase();
    const [existing] = await query("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing.length) return res.status(409).json({ message: "An account with this email already exists" });
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await query("INSERT INTO users (name, email, password_hash, employee_code, role) VALUES (?, ?, ?, ?, 'employee')", [name, normalizedEmail, passwordHash, employeeCode || null]);
    const user = { id: result.insertId, name, email: normalizedEmail, role: "employee" };
    res.status(201).json({ user, token: signToken(user) });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    required(email, "email");
    required(password, "password");
    const [rows] = await query("SELECT id, name, email, password_hash, role, employee_code FROM users WHERE email = ? AND is_active = 1", [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: "Invalid email or password" });
    delete user.password_hash;
    res.json({ user, token: signToken(user) });
}));

app.post("/api/auth/admin-login", asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    required(email, "email");
    required(password, "password");
    const [rows] = await query("SELECT id, name, email, password_hash, role, employee_code FROM users WHERE email = ? AND role = 'admin' AND is_active = 1", [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ message: "Invalid administrator credentials" });
    delete user.password_hash;
    res.json({ user, token: signToken(user) });
}));

app.get("/api/auth/me", auth, asyncRoute(async (req, res) => {
    const [rows] = await query("SELECT id, name, email, employee_code, role, is_active FROM users WHERE id = ?", [req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: "User not found" });
    res.json(rows[0]);
}));

app.post("/api/attendance/check-in", auth, asyncRoute(async (req, res) => {
    const { workMode, lateReason, dayType = "full_day" } = req.body;
    required(workMode, "workMode");
    if (!["WFO", "WFH"].includes(workMode)) return res.status(400).json({ message: "workMode must be WFO or WFH" });
    if (!["full_day", "half_day"].includes(dayType)) return res.status(400).json({ message: "dayType must be full_day or half_day" });
    const [clock] = await query("SELECT CURRENT_DATE AS today, CURRENT_TIME AS now");
    const today = clock[0].today;
    const currentTime = String(clock[0].now).slice(0, 8);
    const [existing] = await query("SELECT * FROM attendance WHERE user_id = ? AND attendance_date = ?", [req.user.id, today]);
    if (existing.length) return res.status(409).json({ message: "Attendance is already recorded for today", attendance: existing[0] });
    const isLate = currentTime > WORK_START;
    if (isLate && (!lateReason || !lateReason.trim())) return res.status(400).json({ message: "A reason is required for late login", lateLogin: true });
    const [result] = await query("INSERT INTO attendance (user_id, attendance_date, status, day_type, login_time, work_mode, is_late, late_reason) VALUES (?, ?, 'present', ?, ?, ?, ?, ?)", [req.user.id, today, dayType, currentTime, workMode, isLate, isLate ? lateReason.trim() : null]);
    const [rows] = await query("SELECT * FROM attendance WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
}));

app.patch("/api/attendance/check-out", auth, asyncRoute(async (req, res) => {
    const [result] = await query("UPDATE attendance SET logout_time = CURRENT_TIME WHERE user_id = ? AND attendance_date = CURRENT_DATE AND logout_time IS NULL", [req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "No open attendance record found for today" });
    const [rows] = await query("SELECT * FROM attendance WHERE user_id = ? AND attendance_date = CURRENT_DATE", [req.user.id]);
    res.json(rows[0]);
}));

app.get("/api/attendance/today", auth, asyncRoute(async (req, res) => {
    const [rows] = await query("SELECT * FROM attendance WHERE user_id = ? AND attendance_date = CURRENT_DATE", [req.user.id]);
    const [clock] = await query("SELECT CURRENT_DATE AS today");
    res.json(rows[0] || { attendance_date: clock[0].today, status: "absent", checkedIn: false, checkedOut: false });
}));

app.get("/api/attendance/history", auth, asyncRoute(async (req, res) => {
    const { start, end } = monthRange(req.query.month);
    const [rows] = await query("SELECT * FROM attendance WHERE user_id = ? AND attendance_date BETWEEN ? AND ? ORDER BY attendance_date DESC", [req.user.id, start, end]);
    res.json(rows);
}));

app.get("/api/attendance/summary", auth, asyncRoute(async (req, res) => {
    const { month, start, end } = monthRange(req.query.month);
    const [attendance] = await query("SELECT status, COUNT(*) AS count FROM attendance WHERE user_id = ? AND attendance_date BETWEEN ? AND ? GROUP BY status", [req.user.id, start, end]);
    const [leaves] = await query("SELECT start_date, end_date, status FROM leaves WHERE user_id = ? AND start_date <= ? AND end_date >= ?", [req.user.id, end, start]);
    const [holidays] = await query("SELECT holiday_date FROM holidays WHERE holiday_date BETWEEN ? AND ?", [start, end]);
    const counts = Object.fromEntries(attendance.map((row) => [row.status, Number(row.count)]));
    const holidayDates = new Set(holidays.map((row) => String(row.holiday_date).slice(0, 10)));
    const workingDates = businessDates(month).filter((date) => !holidayDates.has(date));
    const approvedLeaveDates = new Set();
    const unapprovedLeaveDates = new Set();
    leaves.forEach((leave) => {
        const dates = businessDates(month).filter((date) => date >= String(leave.start_date).slice(0, 10) && date <= String(leave.end_date).slice(0, 10));
        dates.forEach((date) => (leave.status === "approved" ? approvedLeaveDates : unapprovedLeaveDates).add(date));
    });
    const workingDays = workingDates.length;
    const presentDays = counts.present || 0;
    const availableDays = Math.max(0, workingDays - approvedLeaveDates.size);
    res.json({ month, workingDays, presentDays, absentDays: Math.max(counts.absent || 0, availableDays - presentDays), approvedLeaves: approvedLeaveDates.size, unapprovedLeaves: unapprovedLeaveDates.size, holidays: holidayDates.size, attendancePercentage: availableDays ? Number(((presentDays / availableDays) * 100).toFixed(2)) : 0 });
}));

app.post("/api/leaves", auth, asyncRoute(async (req, res) => {
    const { startDate, endDate, reason } = req.body;
    required(startDate, "startDate");
    required(endDate, "endDate");
    required(reason, "reason");
    const [result] = await query("INSERT INTO leaves (user_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)", [req.user.id, startDate, endDate, reason]);
    const [rows] = await query("SELECT * FROM leaves WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
}));

app.get("/api/leaves", auth, asyncRoute(async (req, res) => {
    const [rows] = await query("SELECT * FROM leaves WHERE user_id = ? ORDER BY start_date DESC", [req.user.id]);
    res.json(rows);
}));

app.get("/api/holidays", auth, asyncRoute(async (req, res) => {
    const { start, end } = monthRange(req.query.month);
    const [rows] = await query("SELECT * FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date", [start, end]);
    res.json(rows);
}));

app.get("/api/reports/late", auth, adminOnly, asyncRoute(async (req, res) => {
    const { start, end } = monthRange(req.query.month);
    const { page, limit, offset } = pagination(req.query);
    const [rows] = await query("SELECT a.*, u.name, u.email, u.employee_code FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.is_late = 1 AND a.attendance_date BETWEEN ? AND ? ORDER BY a.attendance_date DESC LIMIT ? OFFSET ?", [start, end, limit, offset]);
    res.json({ page, limit, records: rows });
}));

app.get("/api/admin/employees", auth, adminOnly, asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const [rows] = await query("SELECT id, name, email, employee_code, role, is_active, created_at FROM users ORDER BY name LIMIT ? OFFSET ?", [limit, offset]);
    res.json({ page, limit, records: rows });
}));

app.post("/api/admin/employees", auth, adminOnly, asyncRoute(async (req, res) => {
    const { name, email, password, employeeCode } = req.body;
    required(name, "name");
    required(email, "email");
    required(password, "password");
    if (password.length < 6) return res.status(400).json({ message: "Password must contain at least 6 characters" });
    const normalizedEmail = email.toLowerCase();
    const [existing] = await query("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing.length) return res.status(409).json({ message: "An account with this email already exists" });
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await query("INSERT INTO users (name, email, password_hash, employee_code, role) VALUES (?, ?, ?, ?, 'employee')", [name, normalizedEmail, passwordHash, employeeCode || null]);
    res.status(201).json({ id: result.insertId, name, email: normalizedEmail, employeeCode: employeeCode || null, role: "employee" });
}));

app.patch("/api/admin/employees/:id/status", auth, adminOnly, asyncRoute(async (req, res) => {
    if (typeof req.body.isActive !== "boolean") return res.status(400).json({ message: "isActive must be true or false" });
    const [result] = await query("UPDATE users SET is_active = ? WHERE id = ? AND role = 'employee'", [Boolean(req.body.isActive), req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Employee not found" });
    res.json({ message: "Employee status updated" });
}));

app.get("/api/admin/leaves", auth, adminOnly, asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const [rows] = await query("SELECT l.*, u.name, u.email, u.employee_code FROM leaves l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT ? OFFSET ?", [limit, offset]);
    res.json({ page, limit, records: rows });
}));

app.get("/api/admin/attendance", auth, adminOnly, asyncRoute(async (req, res) => {
    const { start, end } = monthRange(req.query.month);
    const { page, limit, offset } = pagination(req.query);
    const [rows] = await query("SELECT a.*, u.name, u.email, u.employee_code FROM attendance a JOIN users u ON u.id = a.user_id WHERE a.attendance_date BETWEEN ? AND ? ORDER BY a.attendance_date DESC, u.name LIMIT ? OFFSET ?", [start, end, limit, offset]);
    res.json({ page, limit, records: rows });
}));

app.put("/api/admin/attendance/:userId/:date/absent", auth, adminOnly, asyncRoute(async (req, res) => {
    required(req.params.userId, "userId");
    required(req.params.date, "date");
    const [result] = await query(
        "INSERT INTO attendance (user_id, attendance_date, status) VALUES (?, ?, 'absent') ON DUPLICATE KEY UPDATE status = 'absent', login_time = NULL, logout_time = NULL, work_mode = NULL, is_late = FALSE, late_reason = NULL",
        [req.params.userId, req.params.date]
    );
    const [rows] = await query("SELECT * FROM attendance WHERE user_id = ? AND attendance_date = ?", [req.params.userId, req.params.date]);
    res.status(result.affectedRows === 1 ? 201 : 200).json(rows[0]);
}));

app.get("/api/admin/dashboard", auth, adminOnly, asyncRoute(async (req, res) => {
    const { start, end, month } = monthRange(req.query.month);
    const [employeeTotals] = await query("SELECT COUNT(*) AS total, SUM(is_active = 1) AS active FROM users WHERE role = 'employee'");
    const [attendanceTotals] = await query("SELECT status, COUNT(*) AS count FROM attendance WHERE attendance_date BETWEEN ? AND ? GROUP BY status", [start, end]);
    const [todayEmployees] = await query("SELECT u.id, u.name, u.email, u.employee_code, a.status, a.login_time, a.logout_time, a.work_mode, a.is_late, a.late_reason FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.attendance_date = CURRENT_DATE WHERE u.role = 'employee' ORDER BY u.name");
    const [modeTotals] = await query("SELECT work_mode, COUNT(*) AS count FROM attendance WHERE attendance_date BETWEEN ? AND ? GROUP BY work_mode", [start, end]);
    const [leaveTotals] = await query("SELECT status, COUNT(*) AS count FROM leaves WHERE start_date <= ? AND end_date >= ? GROUP BY status", [end, start]);
    const [holidayTotals] = await query("SELECT COUNT(*) AS count FROM holidays WHERE holiday_date BETWEEN ? AND ?", [start, end]);
    const [lateTotals] = await query("SELECT COUNT(*) AS count FROM attendance WHERE is_late = 1 AND attendance_date BETWEEN ? AND ?", [start, end]);
    const presentToday = todayEmployees.filter((employee) => employee.status === "present").length;
    res.json({ month, employees: { total: Number(employeeTotals[0].total), active: Number(employeeTotals[0].active || 0), presentToday, absentToday: todayEmployees.length - presentToday }, todayEmployees: todayEmployees.map((employee) => ({ ...employee, status: employee.status || "absent" })), attendance: Object.fromEntries(attendanceTotals.map((row) => [row.status, Number(row.count)])), workModes: Object.fromEntries(modeTotals.map((row) => [row.work_mode || "unknown", Number(row.count)])), leaves: Object.fromEntries(leaveTotals.map((row) => [row.status, Number(row.count)])), holidays: Number(holidayTotals[0].count), lateArrivals: Number(lateTotals[0].count) });
}));

app.patch("/api/admin/leaves/:id", auth, adminOnly, asyncRoute(async (req, res) => {
    const { status } = req.body;
    if (!["approved", "unapproved"].includes(status)) return res.status(400).json({ message: "status must be approved or unapproved" });
    const [result] = await query("UPDATE leaves SET status = ?, reviewed_by = ? WHERE id = ?", [status, req.user.id, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Leave request not found" });
    res.json({ message: "Leave request updated" });
}));

app.post("/api/admin/holidays", auth, adminOnly, asyncRoute(async (req, res) => {
    const { date, name } = req.body;
    required(date, "date");
    required(name, "name");
    const [result] = await query("INSERT INTO holidays (holiday_date, name) VALUES (?, ?)", [date, name]);
    res.status(201).json({ id: result.insertId, holidayDate: date, name });
}));

app.get("/api/admin/holidays", auth, adminOnly, asyncRoute(async (req, res) => {
    const { start, end } = monthRange(req.query.month);
    const [rows] = await query("SELECT * FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date", [start, end]);
    res.json(rows);
}));

app.delete("/api/admin/holidays/:id", auth, adminOnly, asyncRoute(async (req, res) => {
    const [result] = await query("DELETE FROM holidays WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Holiday not found" });
    res.json({ message: "Holiday deleted" });
}));

app.use((error, req, res, next) => {
    console.error(error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Internal server error" });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
module.exports = app;
