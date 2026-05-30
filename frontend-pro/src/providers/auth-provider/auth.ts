"use client";

import { AuthProvider } from "@refinedev/core";
import { API_URL } from "@/config";

// S-02 NOTE: Tokens are stored in localStorage, which is accessible to JavaScript and
// vulnerable to XSS attacks. The secure alternative is httpOnly cookies set by the backend,
// which requires adding a /auth/cookie-login endpoint that returns Set-Cookie headers.
// Migration path: Replace localStorage with backend-issued httpOnly cookies + a /auth/refresh endpoint.
export const authProvider: AuthProvider = {
    login: async ({ username, password }) => {
        try {
            // The FastAPI backend expects form data for OAuth2PasswordRequestForm
            const formData = new URLSearchParams();
            formData.append("username", username);
            formData.append("password", password);

            const response = await fetch(`${API_URL}/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData,
            });

            if (!response.ok) {
                return {
                    success: false,
                    error: {
                        message: "Login failed",
                        name: "Invalid username or password",
                    },
                };
            }

            const data = await response.json();

            if (data.access_token) {
                localStorage.setItem("admin_token", data.access_token);
                // G-02 FIX: Fetch and cache real user identity at login time so getIdentity() returns real data.
                try {
                    const meRes = await fetch(`${API_URL}/auth/me`, {
                        headers: { "Authorization": `Bearer ${data.access_token}` },
                    });
                    if (meRes.ok) {
                        const meData = await meRes.json();
                        localStorage.setItem("admin_user", JSON.stringify(meData));
                    }
                } catch {
                    // Non-fatal: identity will fall back to token payload
                }
                return { success: true, redirectTo: "/" };
            }

            return {
                success: false,
                error: {
                    message: "Login failed",
                    name: "Invalid token response",
                },
            };
        } catch (error) {
            return {
                success: false,
                error: {
                    message: "Login failed",
                    name: "Network Error",
                },
            };
        }
    },
    logout: async () => {
        // G-02 FIX: Clear both token and cached user identity on logout.
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");
        return { success: true, redirectTo: "/login" };
    },
    check: async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem("admin_token") : null;
        if (!token) return { authenticated: false, redirectTo: "/login" };

        // G-01 FIX: Decode JWT payload (no signature check) to detect expiry client-side,
        // preventing stuck sessions when the token has expired.
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.exp * 1000 < Date.now()) {
                localStorage.removeItem("admin_token");
                localStorage.removeItem("admin_user");
                return { authenticated: false, redirectTo: "/login" };
            }
        } catch {
            // Malformed token — treat as unauthenticated
            localStorage.removeItem("admin_token");
            localStorage.removeItem("admin_user");
            return { authenticated: false, redirectTo: "/login" };
        }

        return { authenticated: true };
    },
    getPermissions: async () => null,
    getIdentity: async () => {
        const token = typeof window !== 'undefined' ? localStorage.getItem("admin_token") : null;
        if (!token) return null;

        // G-02 FIX: Return real user data cached at login instead of hardcoded "Admin".
        const stored = typeof window !== 'undefined' ? localStorage.getItem("admin_user") : null;
        if (stored) {
            try {
                const user = JSON.parse(stored);
                return { id: String(user.id), name: user.full_name, role: user.role };
            } catch {
                // Corrupted cache — fall through
            }
        }
        return null;
    },
    onError: async (error) => {
        console.error("Auth Provider Error:", error);
        if (error.status === 401 || error.status === 403) {
            return {
                logout: true,
                redirectTo: "/login",
                error: {
                    message: "Session expired",
                    name: "Please sign in again",
                },
            };
        }
        return {};
    },
};
