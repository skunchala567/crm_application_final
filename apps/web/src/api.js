const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001/api";

/**
 * Deletion-password challenges used to call `window.prompt`, which embedded
 * browsers and sandboxed frames refuse to run -- deleting a lead there failed
 * with "prompt() is not supported." instead of asking for the password.
 * `DeletionPasswordDialog` registers a real dialog here at start-up.
 */
let deletionPasswordPrompt = null;

export function setDeletionPasswordPrompt(handler) {
  deletionPasswordPrompt = handler;
  return () => { if (deletionPasswordPrompt === handler) deletionPasswordPrompt = null; };
}

async function askDeletionPassword(message) {
  if (deletionPasswordPrompt) return deletionPasswordPrompt(message);
  // The dialog should always be mounted; fall back rather than lose the
  // delete, and report it plainly if this browser blocks prompts too.
  try {
    return window.prompt(message);
  } catch {
    throw new Error("A deletion password is required, but this browser cannot show the prompt.");
  }
}

export async function api(path, options = {}) {
  const token = localStorage.getItem("crm_token");
  const businessUnitId = localStorage.getItem("crm_business_unit_id");
  const request = extraHeaders => fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(businessUnitId ? { "X-Business-Unit-Id": businessUnitId } : {}),
      ...options.headers,
      ...extraHeaders,
    },
  });

  let response = await request();
  if (response.status === 428 && String(options.method || 'GET').toUpperCase() === 'DELETE') {
    let challenge;
    try { challenge = await response.json(); } catch { challenge = {}; }
    if (challenge.code === 'DELETION_PASSWORD_REQUIRED') {
      const password = await askDeletionPassword(
        challenge.message || 'Enter the deletion password to confirm this deletion:'
      );
      if (password == null) throw new Error('Deletion cancelled');
      response = await request({ 'X-Deletion-Password': password });
    }
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = { message: response.statusText || "No response body" };
  }

  if (!response.ok) {
    // Only logout if it's a CRM auth error, not external API errors (like Google Sheets)
    if (response.status === 401 && token && path !== "/auth/login" && !path.includes("/hub/")) {
      localStorage.removeItem("crm_token");
      localStorage.removeItem("crm_user");
      window.dispatchEvent(new CustomEvent("crm:session-expired"));
    }

    // Log full error to console for debugging
    console.error(`API Error [${response.status}] ${path}:`, { status: response.status, body, path });

    // Return more detailed error message
    let errorMsg = "Request failed";
    if (body.message) {
      errorMsg = typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
    } else if (body.error) {
      errorMsg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    } else if (response.statusText) {
      errorMsg = response.statusText;
    }

    throw new Error(errorMsg);
  }
  return body;
}

// Helper methods for common HTTP verbs
api.get = (path, options = {}) => api(path, { ...options, method: "GET" });
api.post = (path, body, options = {}) => api(path, { ...options, method: "POST", body: JSON.stringify(body) });
api.put = (path, body, options = {}) => api(path, { ...options, method: "PUT", body: JSON.stringify(body) });
api.patch = (path, body, options = {}) => api(path, { ...options, method: "PATCH", body: JSON.stringify(body) });
api.delete = (path, options = {}) => api(path, { ...options, method: "DELETE" });
