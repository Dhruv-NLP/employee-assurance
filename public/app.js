
"use strict";

// ---------- Elements ----------
const loginPanel = document.querySelector("#login-panel");
const appPanel = document.querySelector("#app-panel");
const adminPanel = document.querySelector("#admin-panel");
const employeePanel = document.querySelector("#employee-panel");
const logoutButton = document.querySelector("#logout");
const message = document.querySelector("#message");
const loginMessage = document.querySelector("#login-message");

const userForm = document.querySelector("#user-form");
const profileForm = document.querySelector("#profile-form");
const profileUserSelect = document.querySelector("#profile-user-select");
const usersBody = document.querySelector("#users-body");

const assuranceForm = document.querySelector("#assurance-form");
const assurancesBody = document.querySelector("#assurances-body");
const employeeAssurances = document.querySelector("#employee-assurances");

const pdfPanel = document.querySelector("#pdf-panel");
const pdfViewer = document.querySelector("#pdf-viewer");
const openPdf = document.querySelector("#open-pdf");
const confirmCheckbox = document.querySelector("#confirmation-checkbox");
const confirmButton = document.querySelector("#confirm-assurance");
const confirmationMessage =
  document.querySelector("#confirmation-message");

const responsesPanel = document.querySelector("#responses-panel");
const responsesBody = document.querySelector("#responses-body");

let currentUser = null;
let employeeUsers = [];
let employeeAssurancesData = [];
let selectedAssurance = null;

// ---------- API helper ----------
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  // Do not set Content-Type manually for FormData.
  // The browser must add the multipart boundary for PDF uploads.
  if (
    options.body &&
    typeof options.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function showMessage(text) {
  message.textContent = text;
}

function showLoginMessage(text) {
  loginMessage.textContent = text;
}

function addCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value == null || value === "" ? "—" : String(value);
  row.appendChild(cell);
  return cell;
}

function addButton(parent, text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;

  if (className) button.className = className;

  button.addEventListener("click", onClick);
  parent.appendChild(button);
  return button;
}

function formatDate(value) {
  if (!value) return "—";

  // Date-only values should not shift to the previous day due to timezone.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  return value;
}

function formatTimestamp(value) {
  if (!value) return "—";

  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function setLoggedIn(user) {
  currentUser = user;

  loginPanel.hidden = Boolean(user);
  appPanel.hidden = !user;
  logoutButton.hidden = !user;

  if (!user) {
    adminPanel.hidden = true;
    employeePanel.hidden = true;
    closePdf();
    responsesPanel.hidden = true;
    showLoginMessage("");
    return;
  }

  document.querySelector("#welcome").textContent =
    `Signed in as ${user.username} (${user.role})`;

  const isAdmin = user.role === "admin";

  adminPanel.hidden = !isAdmin;
  employeePanel.hidden = isAdmin;

  showLoginMessage("");
}

function handleError(error, target = message) {
  target.textContent = error.message || "Something went wrong.";

  if (error.status === 429) {
    target.textContent =
      "Too many requests. Please wait before trying again.";
  }
}

// ---------- Login and session restoration ----------
document.querySelector("#login-form").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  showLoginMessage("Signing in…");

  try {
    const user = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });

    form.reset();
    setLoggedIn(user);
    showMessage("Login successful.");

    await loadRoleData();
  } catch (error) {
    handleError(error, loginMessage);
  }
});

async function start() {
  // A failed /api/me request is not proof that the session is invalid.
  // Do not call logout or destroy the session on a temporary API failure.
  try {
    const result = await api("/api/me");

    if (!result.user) {
      setLoggedIn(null);
      return;
    }

    setLoggedIn(result.user);
    await loadRoleData();
  } catch (error) {
    loginPanel.hidden = false;
    appPanel.hidden = true;

    showLoginMessage(
      `Unable to verify your session: ${error.message}. ` +
      "Check the server connection and reload the page."
    );
  }
}

async function loadRoleData() {
  if (!currentUser) return;

  if (currentUser.role === "admin") {
    await Promise.all([
      loadUsers(),
      loadAdminAssurances()
    ]);
  } else {
    await loadEmployeeAssurances();
  }
}

// ---------- Logout ----------
logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await api("/api/logout", { method: "POST" });

    setLoggedIn(null);
    showLoginMessage("You have logged out.");
  } catch (error) {
    showMessage(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});

// ---------- Admin: create employee account ----------
userForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: form.elements.username.value.trim(),
        password: form.elements.password.value
      })
    });

    form.reset();
    showMessage("Account created. Now complete the employee profile.");

    await loadUsers();
  } catch (error) {
    handleError(error);
  }
});

// ---------- Admin: employee profiles ----------
async function loadUsers() {
  const data = await api("/api/admin/users");

  employeeUsers = data;
  usersBody.replaceChildren();
  profileUserSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select employee account";
  profileUserSelect.appendChild(placeholder);

  for (const user of employeeUsers) {
    const option = document.createElement("option");
    option.value = String(user.id);
    option.textContent = `${user.username} (${user.role})`;
    profileUserSelect.appendChild(option);

    const row = document.createElement("tr");

    addCell(row, user.username);
    addCell(row, user.employee_id);
    addCell(row, user.employee_name);
    addCell(row, user.station);
    addCell(row, user.line);
    addCell(row, user.posting);
    addCell(row, user.designation);
    addCell(row, user.active ? "Active" : "Inactive");

    usersBody.appendChild(row);
  }
}

profileUserSelect.addEventListener("change", () => {
  const user = employeeUsers.find(
    item => String(item.id) === profileUserSelect.value
  );

  if (!user) {
    profileForm.reset();
    return;
  }

  profileForm.elements.user_id.value = user.id;
  profileForm.elements.employee_id.value = user.employee_id || "";
  profileForm.elements.employee_name.value = user.employee_name || "";
  profileForm.elements.station.value = user.station || "";
  profileForm.elements.line.value = user.line || "";
  profileForm.elements.posting.value = user.posting || "";
  profileForm.elements.designation.value = user.designation || "";
});

profileForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const userId = profileUserSelect.value;

  if (!userId) {
    showMessage("Select an employee account first.");
    return;
  }

  const profile = {
    employee_id: form.elements.employee_id.value.trim(),
    employee_name: form.elements.employee_name.value.trim(),
    station: form.elements.station.value.trim(),
    line: form.elements.line.value.trim(),
    posting: form.elements.posting.value.trim(),
    designation: form.elements.designation.value.trim()
  };

  try {
    await api(`/api/admin/users/${userId}/profile`, {
      method: "PUT",
      body: JSON.stringify(profile)
    });

    showMessage("Employee profile saved.");
    await loadUsers();
    profileUserSelect.value = userId;
  } catch (error) {
    handleError(error);
  }
});

// ---------- Admin: publish an assurance ----------
function splitTargets(value) {
  return [...new Set(
    value.split(",").map(item => item.trim()).filter(Boolean)
  )];
}

assuranceForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const allEmployees = form.elements.all_employees.checked;

  const stations = splitTargets(form.elements.stations.value);
  const lines = splitTargets(form.elements.lines.value);
  const postings = splitTargets(form.elements.postings.value);

  if (!allEmployees && !stations.length && !lines.length && !postings.length) {
    document.querySelector("#publish-message").textContent =
      "Select all employees or enter at least one target station, line or posting.";
    return;
  }

  if (!form.elements.pdf.files.length) {
    document.querySelector("#publish-message").textContent =
      "Select a PDF document.";
    return;
  }

  const formData = new FormData();
  formData.append("title", form.elements.title.value.trim());
  formData.append("issue_date", form.elements.issue_date.value);
  formData.append("due_date", form.elements.due_date.value);
  formData.append("pdf", form.elements.pdf.files[0]);
  formData.append("all_employees", String(allEmployees));
  formData.append("stations", JSON.stringify(stations));
  formData.append("lines", JSON.stringify(lines));
  formData.append("postings", JSON.stringify(postings));

  const publishMessage = document.querySelector("#publish-message");
  publishMessage.textContent = "Publishing assurance…";

  try {
    const result = await api("/api/admin/assurances", {
      method: "POST",
      body: formData
    });

    form.reset();

    publishMessage.textContent =
      `Published successfully. Assigned to ${result.assigned_count} employee(s).`;

    await loadAdminAssurances();
  } catch (error) {
    handleError(error, publishMessage);
  }
});

// ---------- Admin: published assurance list ----------
async function loadAdminAssurances() {
  const data = await api("/api/admin/assurances");

  assurancesBody.replaceChildren();

  for (const assurance of data) {
    const row = document.createElement("tr");

    addCell(row, assurance.title);
    addCell(row, formatDate(assurance.issue_date));
    addCell(row, formatDate(assurance.due_date));
    addCell(row, assurance.assigned_count);
    addCell(row, assurance.confirmed_count);
    addCell(row, assurance.pending_count);

    const actions = addCell(row, "");

    addButton(actions, "View responses", async () => {
      try {
        await loadResponses(assurance);
      } catch (error) {
        handleError(error);
      }
    });

    assurancesBody.appendChild(row);
  }
}

// ---------- Admin: employee-level response list ----------
async function loadResponses(assurance) {
  const data = await api(
    `/api/admin/assurances/${assurance.id}/responses`
  );

  responsesBody.replaceChildren();
  document.querySelector("#responses-title").textContent =
    `Responses: ${assurance.title}`;

  for (const response of data) {
    const row = document.createElement("tr");

    addCell(row, response.employee_id);
    addCell(row, response.employee_name);
    addCell(row, response.station);
    addCell(row, response.line);
    addCell(row, response.posting);
    addCell(row, response.status);
    addCell(row, formatTimestamp(response.confirmed_at));

    responsesBody.appendChild(row);
  }

  responsesPanel.hidden = false;
  responsesPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelector("#close-responses").addEventListener("click", () => {
  responsesPanel.hidden = true;
});

// ---------- Employee: assigned assurances ----------
async function loadEmployeeAssurances() {
  const data = await api("/api/assurances");

  employeeAssurancesData = data;
  employeeAssurances.replaceChildren();

  if (!data.length) {
    const empty = document.createElement("p");
    empty.textContent = "You have no assigned assurances at present.";
    employeeAssurances.appendChild(empty);
    return;
  }

  for (const assurance of data) {
    const card = document.createElement("article");
    card.className = "panel";

    const heading = document.createElement("h3");
    heading.textContent = assurance.title;
    card.appendChild(heading);

    const details = document.createElement("p");
    details.textContent =
      `Issue date: ${formatDate(assurance.issue_date)} | ` +
      `Deadline: ${formatDate(assurance.due_date)}`;
    card.appendChild(details);

    const status = document.createElement("p");
    status.textContent =
      assurance.status === "Confirmed"
        ? `Status: Confirmed | Recorded: ${formatTimestamp(assurance.confirmed_at)}`
        : "Status: Pending confirmation";
    card.appendChild(status);

    addButton(card, "Read assurance PDF", () => {
      openAssurance(assurance);
    });

    employeeAssurances.appendChild(card);
  }
}

// ---------- Employee: PDF viewer ----------
function openAssurance(assurance) {
  selectedAssurance = assurance;

  const pdfUrl = `/api/assurances/${assurance.id}/pdf`;

  document.querySelector("#pdf-title").textContent = assurance.title;
  document.querySelector("#pdf-details").textContent =
    `Issue date: ${formatDate(assurance.issue_date)} | ` +
    `Deadline: ${formatDate(assurance.due_date)} | ` +
    `Status: ${assurance.status}`;

  pdfViewer.src = pdfUrl;
  openPdf.href = pdfUrl;

  confirmCheckbox.checked = false;
  confirmCheckbox.disabled = assurance.status === "Confirmed";
  confirmButton.disabled = assurance.status === "Confirmed";

  confirmationMessage.textContent =
    assurance.status === "Confirmed"
      ? `Already confirmed on ${formatTimestamp(assurance.confirmed_at)}.`
      : "";

  pdfPanel.hidden = false;
  pdfPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closePdf() {
  selectedAssurance = null;

  if (pdfViewer) pdfViewer.src = "about:blank";
  if (openPdf) openPdf.removeAttribute("href");
  if (confirmCheckbox) {
    confirmCheckbox.checked = false;
    confirmCheckbox.disabled = false;
  }
  if (confirmButton) confirmButton.disabled = true;
  if (confirmationMessage) confirmationMessage.textContent = "";
  if (pdfPanel) pdfPanel.hidden = true;
}

document.querySelector("#close-pdf").addEventListener("click", closePdf);

confirmCheckbox.addEventListener("change", () => {
  confirmButton.disabled =
    !confirmCheckbox.checked ||
    !selectedAssurance ||
    selectedAssurance.status === "Confirmed";
});

// ---------- Employee: submit confirmation ----------
confirmButton.addEventListener("click", async () => {
  if (!selectedAssurance || !confirmCheckbox.checked) return;

  const assurance = selectedAssurance;
  confirmButton.disabled = true;
  confirmationMessage.textContent = "Saving your confirmation…";

  try {
    await api(`/api/assurances/${assurance.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        confirmation: "I Confirm / I Assure"
      })
    });

    confirmationMessage.textContent =
      "Your confirmation has been recorded.";

    await loadEmployeeAssurances();

    const updated = employeeAssurancesData.find(
      item => item.id === assurance.id
    );

    if (updated) openAssurance(updated);
  } catch (error) {
    confirmationMessage.textContent = error.message;
    confirmButton.disabled = !confirmCheckbox.checked;
  }
});

// ---------- Initial startup ----------
start();
