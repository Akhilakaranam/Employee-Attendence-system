CREATE DATABASE IF NOT EXISTS employee_attendance;
USE employee_attendance;

CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    employee_code VARCHAR(50) UNIQUE,
    role ENUM('employee', 'admin') NOT NULL DEFAULT 'employee',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    attendance_date DATE NOT NULL,
    status ENUM('present', 'absent') NOT NULL DEFAULT 'present',
    day_type ENUM('full_day', 'half_day') NOT NULL DEFAULT 'full_day',
    login_time TIME NULL,
    logout_time TIME NULL,
    work_mode ENUM('WFO', 'WFH') NULL,
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    late_reason VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY one_attendance_per_day (user_id, attendance_date),
    CONSTRAINT attendance_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leaves (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(500) NOT NULL,
    status ENUM('pending', 'approved', 'unapproved') NOT NULL DEFAULT 'pending',
    reviewed_by INT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT leaves_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT leaves_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS holidays (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE attendance ADD COLUMN day_type ENUM('full_day', 'half_day') NOT NULL DEFAULT 'full_day' AFTER status;

CREATE INDEX attendance_date_index ON attendance (attendance_date);
CREATE INDEX attendance_user_date_index ON attendance (user_id, attendance_date);
CREATE INDEX leaves_date_index ON leaves (start_date, end_date);
CREATE INDEX leaves_user_created_index ON leaves (user_id, created_at);
