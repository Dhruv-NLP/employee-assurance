
# Employee Assurance

An internal web application for publishing employee assurance notices, assigning them to employees, collecting confirmations, and tracking responses.

## Features

- **Administrator accounts:** Create employee accounts, maintain employee profiles, and deactivate accounts.
- **Targeted publication:** Upload a PDF assurance notice and assign it to all active employees or to employees matched by station, line, and/or posting.
- **Employee confirmations:** Employees can view notices assigned to them, open the PDF, and confirm they have read and understood it.
- **Progress tracking:** Administrators can review assignment totals and employee-level confirmation status.
- **Assurance records:** Administrators can create, update, list, and archive employee assurance records.

## Requirements

- Node.js and npm

## Setup

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Create a `.env` file in the project root. Set `SESSION_SECRET` to a randomly generated value of at least 32 characters. For example, generate one with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Then add the generated value to `.env`:

   ```dotenv
   SESSION_SECRET=paste_the_generated_value_here
   PORT=3000
   ```

   `PORT` is optional; the application uses port `3000` when it is not set.

3. Start the application:

   ```sh
   npm start
   ```

   On first startup, the application creates its SQLite database, tables, and upload directory under `data/`.

4. In a second terminal, create the first administrator:

   ```sh
   node create-user.js
   ```

   Enter an administrator username and a password between 12 and 200 characters. This setup script creates administrator accounts; use the administrator interface to create employee accounts.

5. Open [http://localhost:3000](http://localhost:3000) (or the port configured in `.env`) and sign in with the administrator credentials.

## Running

Start the application with:

```sh
npm start
```

The server listens on `0.0.0.0` at the configured port. The login session expires after 30 minutes. Assurance PDF uploads must be valid PDFs and are limited to 10 MB each.

## Data and backups

The application stores its local data under `data/`:

- `app.db` contains user accounts, employee profiles, assurance records, publications, and assignments.
- `sessions.sqlite` stores login sessions.
- `assurance-files/` contains uploaded assurance PDFs.

These runtime files and `.env` are excluded by `.gitignore`. Back up the database and `assurance-files/` together to preserve the application data and uploaded documents. Keep `.env` and backups private.

## Security notes

- Use a unique, strong `SESSION_SECRET`; do not commit `.env` or share it.
- Employee passwords must be at least 12 characters. Share credentials privately.
- The current session-cookie configuration is intended for an internal HTTP/LAN deployment. Before exposing the app over the internet, deploy behind HTTPS and configure the session cookie for secure HTTPS use.


=======
