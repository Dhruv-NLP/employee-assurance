
require("dotenv").config();

const express = require("express");
const session = require("express-session");// this is used to manage user sessions in the application, allowing for persistent login states across requests.
const SQLiteStore = require("connect-sqlite3")(session); // this is a session store that uses SQLite as the backend for storing session data, providing a lightweight and efficient way to manage sessions in the application.
const Database = require("better-sqlite3");// this is a library for interacting with SQLite databases in a synchronous manner, providing a simple and efficient way to perform database operations in the application.
const bcrypt = require("bcryptjs");// this is a library for hashing and comparing passwords securely, ensuring that user passwords are stored in a hashed format to enhance security in the application.
const helmet = require("helmet");// this is a middleware that helps secure the application by setting various HTTP headers, protecting against common web vulnerabilities and attacks.
const rateLimit = require("express-rate-limit");// this is a middleware that limits the number of requests a client can make to the server within a specified time window, helping to prevent abuse and denial-of-service attacks in the application.
const path = require("path");// this is a built-in Node.js module that provides utilities for working with file and directory paths, allowing for easy manipulation and resolution of file paths in the application.
const fs = require("fs");// this is a built-in Node.js module that provides an API for interacting with the file system, allowing for reading, writing, and managing files and directories in the application.
const multer = require("multer");
const crypto = require("crypto");


if (!process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32) {
  throw new Error("Set a strong SESSION_SECRET in .env");
}

const app = express();// this creates an instance of the Express application, which serves as the main entry point for handling HTTP requests and defining routes in the application.
const PORT = Number(process.env.PORT) || 3000;

const dataDir = path.join(__dirname, "data");// this defines the path to the "data" directory, which will be used to store application data such as the SQLite database and session files.
fs.mkdirSync(dataDir, { recursive: true });// this creates the "data" directory if it doesn't already exist, ensuring that the necessary directory structure is in place for storing application data.

const assuranceDir = path.join(dataDir, "assurance-files");
fs.mkdirSync(assuranceDir, { recursive: true });

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed."));
    }
    cb(null, true);
  }
});

const db = new Database(path.join(dataDir, "app.db"));// this initializes a new SQLite database connection using the "better-sqlite3" library, pointing to the "app.db" file within the "data" directory. This database will be used to store application data such as user accounts and assurance records.
db.pragma("journal_mode = WAL");// this sets the SQLite database's journal mode to "WAL" (Write-Ahead Logging), which improves performance and allows for concurrent reads and writes to the database, enhancing the overall efficiency of database operations in the application.
db.pragma("foreign_keys = ON");// this enables foreign key constraints in the SQLite database, ensuring that relationships between tables are enforced and maintaining data integrity within the application.
db.pragma("busy_timeout = 5000");// this sets a busy timeout of 5000 milliseconds (5 seconds) for the SQLite database, allowing the application to wait for a specified period before throwing an error when the database is locked due to concurrent access, improving the robustness of database operations in the application.



// Create tables if they don't exist yet. The users table stores user accounts, and the assurance_records table stores employee assurance records. The assurance_records table includes fields for employee information, assurance type, status, remarks, and references to the user who created and last updated the record. Indexes are created on employee_id and status for efficient querying.
db.exec(`            
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
      CHECK (role IN ('admin', 'user')),
    active INTEGER NOT NULL DEFAULT 1
      CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS assurance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    designation TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    department TEXT NOT NULL,
    assurance_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending', 'Verified', 'Follow-up')),
    remarks TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived INTEGER NOT NULL DEFAULT 0
      CHECK (archived IN (0, 1))
  );

  CREATE INDEX IF NOT EXISTS idx_records_employee              
    ON assurance_records(employee_id);

  CREATE INDEX IF NOT EXISTS idx_records_status
    ON assurance_records(status);
`);


// Add employee profile fields to existing users.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(col => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("users", "employee_id", "TEXT");
ensureColumn("users", "employee_name", "TEXT");
ensureColumn("users", "station", "TEXT");
ensureColumn("users", "line", "TEXT");
ensureColumn("users", "posting", "TEXT");
ensureColumn("users", "designation", "TEXT");

// Published assurance documents.
db.exec(`
  CREATE TABLE IF NOT EXISTS assurance_publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    due_date TEXT,
    file_key TEXT NOT NULL UNIQUE,
    published_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS assurance_exclusions (
    assurance_id INTEGER NOT NULL
      REFERENCES assurance_publications(id),
    employee_id TEXT NOT NULL,
    PRIMARY KEY (assurance_id, employee_id)
  );

  CREATE TABLE IF NOT EXISTS assurance_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assurance_id INTEGER NOT NULL
      REFERENCES assurance_publications(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending', 'Confirmed')),
    confirmation_text TEXT,
    confirmed_at TEXT,
    UNIQUE (assurance_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_assignments_user
    ON assurance_assignments(user_id, status);

  CREATE INDEX IF NOT EXISTS idx_assignments_assurance
    ON assurance_assignments(assurance_id, status);
`);

ensureColumn(
  "assurance_publications",
  "include_future_employees",
  "INTEGER NOT NULL DEFAULT 0 CHECK (include_future_employees IN (0, 1))"
);

db.transaction(() => {
  db.prepare(`
    UPDATE assurance_publications
    SET include_future_employees = 1
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO assurance_assignments (assurance_id, user_id)
    SELECT p.id, u.id
    FROM assurance_publications p
    JOIN users u
      ON u.role = 'user'
     AND u.active = 1
    WHERE p.include_future_employees = 1
      AND NOT EXISTS (
        SELECT 1
        FROM assurance_exclusions e
        WHERE e.assurance_id = p.id
          AND e.employee_id = u.employee_id
      )
  `).run();
})();


app.disable("x-powered-by");// this disables the "X-Powered-By" HTTP header in the Express application, which helps to reduce information disclosure about the underlying technology stack and enhances security by making it less obvious that the application is built with Express.
app.use(helmet());// this applies the "helmet" middleware to the Express application, which sets various HTTP headers to enhance security and protect against common web vulnerabilities, such as cross-site scripting (XSS) and clickjacking attacks.
app.use(express.json({ limit: "20kb" }));// this applies the built-in "express.json" middleware to the Express application, which parses incoming JSON request bodies and makes them available in the "req.body" property. The "limit" option restricts the maximum size of the JSON payload to 20 kilobytes, preventing excessively large requests that could potentially lead to denial-of-service attacks or resource exhaustion.

// All clients use the same server. Do not enable trust proxy
// unless a trusted reverse proxy is actually configured.
app.use(session({// 
  name: "employee.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    dir: dataDir,
    db: "sessions.sqlite"
  }),
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: false, // LAN HTTP only; use true with HTTPS
    maxAge: 30 * 60 * 1000
  }
}));


app.use("/api", (req, res, next) => {
  const changesData = ["POST", "PUT", "PATCH", "DELETE"]
    .includes(req.method);

  if (changesData) {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (!origin || origin !== expectedOrigin) {
      return res.status(403).json({
        error: "Request origin not allowed."
      });
    }
  }

  next();
});

app.use("/api/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
}));

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please log in." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

function clean(value, max = 150) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > max) return null;
  return result;
}

function validateRecord(body) {
  const employee_id = clean(body.employee_id, 40);
  const employee_name = clean(body.employee_name, 120);
  const department = clean(body.department, 100);
  const assurance_type = clean(body.assurance_type, 100);
  const status = clean(body.status, 20);
  const remarks = body.remarks === undefined ? "" :
    typeof body.remarks === "string" ? body.remarks.trim() : null;

  if (!employee_id || !employee_name || !department ||
      !assurance_type || remarks === null ||
      remarks.length > 2000 ||
      !["Pending", "Verified", "Follow-up"].includes(status)) {
    return null;
  }

  return {
    employee_id,
    employee_name,
    department,
    assurance_type,
    status,
    remarks
  };
}

// Login
app.post("/api/login", async (req, res, next) => {
  try {
    const username = clean(req.body.username, 50);
    const password = typeof req.body.password === "string"
      ? req.body.password : "";

    if (!username || password.length > 200) {
      return res.status(400).json({ error: "Invalid credentials." });
    }

    const user = db.prepare(`
      SELECT id, username, password_hash, role
      FROM users WHERE username = ? AND active = 1
    `).get(username);

    const valid = user &&
      await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // Prevent session fixation after authentication.
    req.session.regenerate(err => {
      if (err) return next(err);

      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role
      };

      req.session.save(err => {
        if (err) return next(err);
        res.json({ username: user.username, role: user.role });
      });
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("employee.sid", {
      httpOnly: true,
      sameSite: "strict",
      secure: false
    });
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// Every record API requires login.
app.get("/api/records", requireLogin,requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, employee_id, employee_name, department,
      assurance_type, status, remarks, created_at, updated_at
    FROM assurance_records
    WHERE archived = 0
    ORDER BY id DESC
  `).all();

  res.json(rows);
});

app.post("/api/records", requireLogin,requireAdmin, (req, res) => {
  const record = validateRecord(req.body);
  if (!record) {
    return res.status(400).json({ error: "Check all record fields." });
  }

  const result = db.prepare(`
    INSERT INTO assurance_records
      (employee_id, employee_name, department, assurance_type,
       status, remarks, created_by, updated_by)
    VALUES
      (@employee_id, @employee_name, @department, @assurance_type,
       @status, @remarks, @user_id, @user_id)
  `).run({ ...record, user_id: req.session.user.id });

  res.status(201).json({ id: result.lastInsertRowid });
});

app.put("/api/records/:id", requireLogin, requireAdmin,(req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid record ID." });
  }

  const record = validateRecord(req.body);
  if (!record) {
    return res.status(400).json({ error: "Check all record fields." });
  }

  const result = db.prepare(`
    UPDATE assurance_records SET
      employee_id = @employee_id,
      employee_name = @employee_name,
      department = @department,
      assurance_type = @assurance_type,
      status = @status,
      remarks = @remarks,
      updated_by = @user_id,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND archived = 0
  `).run({
    ...record,
    user_id: req.session.user.id,
    id
  });

  if (!result.changes) {
    return res.status(404).json({ error: "Record not found." });
  }

  res.json({ ok: true });
});

app.delete("/api/records/:id", requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid record ID." });
  }

  const result = db.prepare(`
    UPDATE assurance_records SET
      archived = 1,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND archived = 0
  `).run(req.session.user.id, id);

  if (!result.changes) {
    return res.status(404).json({ error: "Record not found." });
  }

  res.json({ ok: true });
});

// User administration: administrators can create and deactivate accounts.
app.post("/api/users", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const username = clean(req.body.username, 50);
    const password = typeof req.body.password === "string"
      ? req.body.password : "";
    const employee_id = clean(req.body.employee_id, 40);
    const employee_name = clean(req.body.employee_name, 120);
    const station = clean(req.body.station, 100);
    const line = clean(req.body.line, 100);
    const posting = clean(req.body.posting, 100);
    const designation = clean(req.body.designation, 100);

    if (!username || !/^[a-zA-Z0-9._-]+$/.test(username) ||
        password.length < 12 || password.length > 200) {
      return res.status(400).json({
        error: "Use a valid username and password of at least 12 characters."
      });
    }

    if (
      !employee_id || !employee_name ||
      !station || !line || !posting || !designation
    ) {
      return res.status(400).json({
        error: "Complete all employee profile fields."
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const createEmployee = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (
          username, password_hash, role, employee_id, employee_name,
          station, line, posting, designation
        )
        VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)
      `).run(
        username, hash, employee_id, employee_name,
        station, line, posting, designation
      );

      const futureAssurances = db.prepare(`
        SELECT p.id
        FROM assurance_publications p
        WHERE p.include_future_employees = 1
          AND NOT EXISTS (
            SELECT 1
            FROM assurance_exclusions e
            WHERE e.assurance_id = p.id
              AND e.employee_id = ?
          )
      `).all(employee_id);
      const assign = db.prepare(`
        INSERT INTO assurance_assignments (assurance_id, user_id)
        VALUES (?, ?)
      `);

      for (const assurance of futureAssurances) {
        assign.run(assurance.id, result.lastInsertRowid);
      }

      return result;
    });

    const result = createEmployee();

    res.status(201).json({
      id: result.lastInsertRowid,
      username,
      employee_id,
      employee_name,
      station,
      line,
      posting,
      designation,
      active: true
    });
  } catch (err) {
    if (String(err.code).startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "Username already exists." });
    }
    next(err);
  }
});

// Admin: list employee accounts and their profiles.
app.get("/api/admin/users", requireLogin, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, active,
           employee_id, employee_name,
           station, line, posting, designation
    FROM users
    ORDER BY employee_name, username
  `).all();

  res.json(users);
});

// Admin: create or update an employee profile.
app.put(
  "/api/admin/users/:id/profile",
  requireLogin,
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    const employee_id = clean(req.body.employee_id, 40);
    const employee_name = clean(req.body.employee_name, 120);
    const station = clean(req.body.station, 100);
    const line = clean(req.body.line, 100);
    const posting = clean(req.body.posting, 100);
    const designation = clean(req.body.designation, 100);

    if (
      !employee_id || !employee_name ||
      !station || !line || !posting || !designation
    ) {
      return res.status(400).json({
        error: "Complete all employee profile fields."
      });
    }

    const result = db.prepare(`
      UPDATE users SET
        employee_id = ?,
        employee_name = ?,
        station = ?,
        line = ?,
        posting = ?,
        designation = ?
      WHERE id = ? AND role = 'user'
    `).run(
      employee_id, employee_name,
      station, line, posting, designation, id
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Employee account not found."
      });
    }

    res.json({ ok: true });
  }
);




app.patch("/api/users/:id/deactivate", requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1 ||
      id === req.session.user.id) {
    return res.status(400).json({ error: "Invalid account." });
  }

  const result = db.prepare(`
    UPDATE users SET active = 0 WHERE id = ?
  `).run(id);

  res.json({ ok: result.changes > 0 });
});



function parseExcludedEmployeeIds(value) {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 100) return null;

    const cleaned = parsed.map(v => clean(v, 40));
    if (cleaned.some(v => !v)) return null;

    return [...new Set(cleaned)];
  } catch {
    return null;
  }
}

function validDate(value) {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value;
}

app.post(
  "/api/admin/assurances",
  requireLogin,
  requireAdmin,
  pdfUpload.single("pdf"),
  (req, res, next) => {
    let savedPath;

    try {
      const title = clean(req.body.title, 150);
      const issueDate = req.body.issue_date;
      const dueDate = req.body.due_date || null;
      const excludedEmployeeIds =
        parseExcludedEmployeeIds(req.body.excluded_employee_ids || "[]");

      if (
        !title ||
        !validDate(issueDate) ||
        (dueDate && (
          !validDate(dueDate) || dueDate < issueDate
        )) ||
        !req.file ||
        req.file.buffer.subarray(0, 5).toString() !== "%PDF-"
      ) {
        return res.status(400).json({
          error: "Provide a valid title, PDF, issue date and deadline."
        });
      }

      if (!excludedEmployeeIds) {
        return res.status(400).json({
          error: "Excluded employee IDs must be a valid list of up to 100 IDs."
        });
      }

      if (excludedEmployeeIds.length) {
        const matchedIds = db.prepare(`
          SELECT DISTINCT employee_id FROM users
          WHERE role = 'user'
            AND employee_id IN (${excludedEmployeeIds.map(() => "?").join(",")})
        `).all(...excludedEmployeeIds).map(row => row.employee_id);

        if (matchedIds.length !== excludedEmployeeIds.length) {
          return res.status(400).json({
            error: "One or more excluded employee IDs were not found."
          });
        }
      }

      const exclusionClause = excludedEmployeeIds.length
        ? `AND employee_id NOT IN (${excludedEmployeeIds.map(() => "?").join(",")})`
        : "";
      const recipients = db.prepare(`
        SELECT id FROM users
        WHERE role = 'user' AND active = 1 ${exclusionClause}
      `).all(...excludedEmployeeIds);

      if (!recipients.length) {
        return res.status(400).json({
          error: "No active employee accounts remain after applying exclusions."
        });
      }

      const fileKey = `${crypto.randomUUID()}.pdf`;
      savedPath = path.join(assuranceDir, fileKey);
      fs.writeFileSync(savedPath, req.file.buffer, { flag: "wx" });

      const publish = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO assurance_publications
            (title, issue_date, due_date, file_key, published_by,
             include_future_employees)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(
          title,
          issueDate,
          dueDate,
          fileKey,
          req.session.user.id
        );

        const insertExclusion = db.prepare(`
          INSERT INTO assurance_exclusions (assurance_id, employee_id)
          VALUES (?, ?)
        `);
        for (const employeeId of excludedEmployeeIds) {
          insertExclusion.run(result.lastInsertRowid, employeeId);
        }

        const insertAssignment = db.prepare(`
          INSERT INTO assurance_assignments
            (assurance_id, user_id)
          VALUES (?, ?)
        `);

        for (const recipient of recipients) {
          insertAssignment.run(result.lastInsertRowid, recipient.id);
        }

        return result.lastInsertRowid;
      });

      const assuranceId = publish();

      res.status(201).json({
        ok: true,
        assurance_id: assuranceId,
        assigned_count: recipients.length
      });
    } catch (err) {
      if (savedPath && fs.existsSync(savedPath)) {
        fs.unlinkSync(savedPath);
      }
      next(err);
    }
  }
);

// Serve only static files from public/.
app.use(express.static(path.join(__dirname, "public")));



// Employee: list only their own assurance assignments.
app.get("/api/assurances", requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.title, p.issue_date, p.due_date,
           a.status, a.confirmed_at
    FROM assurance_assignments a
    JOIN assurance_publications p ON p.id = a.assurance_id
    WHERE a.user_id = ?
    ORDER BY p.issue_date DESC, p.id DESC
  `).all(req.session.user.id);

  res.json(rows);
});

// Employee or admin: access an authorized PDF.
app.get("/api/assurances/:id/pdf", requireLogin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid assurance ID." });
  }

  const publication = db.prepare(`
    SELECT p.id, p.title, p.file_key
    FROM assurance_publications p
    WHERE p.id = ?
      AND (
        ? = 'admin'
        OR EXISTS (
          SELECT 1 FROM assurance_assignments a
          WHERE a.assurance_id = p.id AND a.user_id = ?
        )
      )
  `).get(id, req.session.user.role, req.session.user.id);

  if (!publication) {
    return res.status(404).json({ error: "Assurance not found." });
  }

  const filePath = path.join(assuranceDir, publication.file_key);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "PDF file not found." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="assurance-${publication.id}.pdf"`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");

  res.sendFile(filePath);
});

// Employee: confirm an assigned assurance.
app.post(
  "/api/assurances/:id/confirm",
  requireLogin,
  (req, res) => {
    if (req.session.user.role !== "user") {
      return res.status(403).json({
        error: "Only employee accounts can submit confirmations."
      });
    }

    const id = Number(req.params.id);
    const expectedText = "I Confirm / I Assure";

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid assurance ID." });
    }

    if (req.body.confirmation !== expectedText) {
      return res.status(400).json({
        error: "Explicit confirmation is required."
      });
    }

    const result = db.prepare(`
      UPDATE assurance_assignments
      SET status = 'Confirmed',
          confirmation_text = ?,
          confirmed_at = CURRENT_TIMESTAMP
      WHERE assurance_id = ?
        AND user_id = ?
        AND status = 'Pending'
    `).run(
      expectedText,
      id,
      req.session.user.id
    );

    if (!result.changes) {
      const existing = db.prepare(`
        SELECT status FROM assurance_assignments
        WHERE assurance_id = ? AND user_id = ?
      `).get(id, req.session.user.id);

      if (!existing) {
        return res.status(404).json({
          error: "This assurance is not assigned to your account."
        });
      }

      return res.status(409).json({
        error: "This assurance has already been confirmed."
      });
    }

    res.json({ ok: true });
  }
);

// Admin: list publications and their completion counts.
app.get(
  "/api/admin/assurances",
  requireLogin,
  requireAdmin,
  (req, res) => {
    const rows = db.prepare(`
      SELECT
        p.id, p.title, p.issue_date, p.due_date,
        p.created_at,
        COUNT(a.id) AS assigned_count,
        SUM(CASE WHEN a.status = 'Confirmed'
                 THEN 1 ELSE 0 END) AS confirmed_count,
        SUM(CASE WHEN a.status = 'Pending'
                 THEN 1 ELSE 0 END) AS pending_count
      FROM assurance_publications p
      LEFT JOIN assurance_assignments a
        ON a.assurance_id = p.id
      GROUP BY p.id
      ORDER BY p.id DESC
    `).all();

    res.json(rows);
  }
);

// Admin: inspect individual employee responses.
app.get(
  "/api/admin/assurances/:id/responses",
  requireLogin,
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid assurance ID." });
    }

    const rows = db.prepare(`
      SELECT
        u.employee_id, u.employee_name, u.username,
        u.station, u.line, u.posting, u.designation,
        a.status, a.confirmation_text, a.confirmed_at
      FROM assurance_assignments a
      JOIN users u ON u.id = a.user_id
      WHERE a.assurance_id = ?
      ORDER BY u.station, u.employee_name
    `).all(id);

    res.json(rows);
  }
);



app.use((err, req, res, next) => {
  console.error(err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, "0.0.0.0", () => {// 
  console.log(`Employee Assurance app listening on port ${PORT}`);
});
