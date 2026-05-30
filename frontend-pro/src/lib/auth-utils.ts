/**
 * Shared utility for authentication headers.
 * Centralizes the logic for retrieving the admin_token from localStorage.
 */
export function getAuthHeaders(): Record<string, string> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('admin_token') : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Handle 401 responses globally: clear tokens and redirect to login.
 * Call this after any fetch that may return 401.
 */
export function handle401(response: Response): boolean {
    if (response.status === 401) {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem("admin_token");
            localStorage.removeItem("admin_user");
        }
        // Dynamic import to avoid issues with sonner on server
        import("sonner").then(({ toast }) => {
            toast.error("Session expired. Please sign in again.");
        });
        // Redirect after a brief delay so toast is visible
        setTimeout(() => {
            if (typeof window !== 'undefined') {
                window.location.href = "/login";
            }
        }, 1000);
        return true;
    }
    return false;
}

/**
 * Authenticated fetch wrapper that handles 401 responses automatically.
 * Use this instead of raw fetch for API calls.
 */
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
    const headers = getAuthHeaders();
    const mergedOptions: RequestInit = {
        ...options,
        headers: {
            ...headers,
            ...(options?.headers || {}),
        },
    };
    const response = await fetch(url, mergedOptions);
    handle401(response);
    return response;
}
