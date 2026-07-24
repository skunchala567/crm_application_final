const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:3001/api";

export async function api(path, options = {}) {
  const token = localStorage.getItem("crm_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

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
