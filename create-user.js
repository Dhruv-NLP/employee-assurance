
require("dotenv").config();

const Database = require("better-sqlite3");// this is a library for interacting with SQLite databases in a synchronous manner, providing a simple and efficient way to perform database operations in the application.
const bcrypt = require("bcryptjs");// this is a library for hashing and comparing passwords securely, ensuring that user passwords are stored in a hashed format to enhance security in the application.
const path = require("path");// this is a built-in Node.js module that provides utilities for working with file and directory paths, allowing for easy manipulation and resolution of file paths in the application.
const readline = require("readline/promises");// this is a built-in Node.js module that provides an interface for reading input from the command line, allowing for interactive user prompts and input handling in the application.

async function main() {   // this is the main function that serves as the entry point for creating an administrator user in the application. It handles user input, validates credentials, and interacts with the database to create the admin account.
  const rl = readline.createInterface({  // this creates a readline interface that allows for reading input from the command line and writing output to the console, enabling interactive prompts for user input in the application.
    input: process.stdin,
    output: process.stdout
  });

  try {
    const username = (await rl.question("Admin username: ")).trim();
    const password = await rl.question("Admin password (12+ chars): ");

    if (!/^[a-zA-Z0-9._-]{1,50}$/.test(username) || password.length < 12 || password.length > 200) {
      throw new Error("Invalid username or password length.");
    }

    const db = new Database(path.join(__dirname, "data", "app.db"));// this creates a new instance of the Database class from the "better-sqlite3" library, connecting to the SQLite database file located at "data/app.db". It allows for executing SQL queries and managing the database in a synchronous manner.

    try {
      const hash = await bcrypt.hash(password, 12);// this hashes the provided password using the bcrypt algorithm with a cost factor of 12, generating a secure password hash that can be stored in the database for authentication purposes.

      
      db.prepare(`       
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, 'admin')
      `).run(username, hash);

      console.log("Administrator created successfully.");
    } finally {
      db.close();
    }
  } finally {
    rl.close();
  }
}

main().catch(err => {      
  console.error("Could not create administrator:", err.message);
  process.exitCode = 1;
});
