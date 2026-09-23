require("dotenv").config();

const fs = require("fs");
const mysql = require("mysql2");

const connection = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true
});

const statements = fs.readFileSync("schema.sql", "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

let index = 0;
function runNext() {
    if (index >= statements.length) {
        console.log("Database schema initialized successfully.");
        connection.end();
        return;
    }
    connection.query(statements[index], (error) => {
        if (error && !["ER_DUP_KEYNAME", "ER_DUP_FIELDNAME"].includes(error.code)) {
            console.error(`Database initialization failed: ${error.code || error.message}`);
            process.exitCode = 1;
            connection.destroy();
            return;
        }
        index += 1;
        runNext();
    });
}

runNext();

connection.on("error", (error) => {
    console.error(`MySQL connection failed: ${error.code || error.message}`);
    process.exitCode = 1;
});
