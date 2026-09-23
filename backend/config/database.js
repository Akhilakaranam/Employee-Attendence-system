require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "employee_attendance",
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 40),
    queueLimit: Number(process.env.DB_QUEUE_LIMIT || 1000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    dateStrings: true
});

module.exports = db;