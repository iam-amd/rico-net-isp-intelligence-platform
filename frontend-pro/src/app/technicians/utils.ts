// ─── Shared utilities for the technicians module ─────────────────

/** Extract initials from a full name (e.g. "John Smith" → "JS") */
export function getInitials(name: string): string {
    return name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

/** Format ISO date string to "07 Mar 2026" style */
export function formatDate(d: string | null): string {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

/** Color maps for ticket statuses */
export const statusColors: Record<string, string> = {
    Open: "bg-blue-50 text-blue-700",
    Assigned: "bg-amber-50 text-amber-700",
    Ongoing: "bg-indigo-50 text-indigo-700",
    Resolved: "bg-green-50 text-green-700",
    Closed: "bg-gray-100 text-gray-500",
};

/** Color maps for ticket priorities (text) */
export const priorityColors: Record<string, string> = {
    Low: "text-gray-500",
    Normal: "text-blue-600",
    Medium: "text-amber-600",
    High: "text-orange-600",
    Urgent: "text-red-600",
};

/** Color maps for priority bar charts */
export const priorityBarColors: Record<string, string> = {
    Low: "bg-gray-400",
    Normal: "bg-blue-500",
    Medium: "bg-amber-500",
    High: "bg-orange-500",
    Urgent: "bg-red-500",
};

/** Color map for role badges */
export const roleColorMap: Record<string, string> = {
    Admin: "bg-purple-50 text-purple-700 border-purple-200",
    Supervisor: "bg-blue-50 text-blue-700 border-blue-200",
    "Senior Tech": "bg-amber-50 text-amber-700 border-amber-200",
    "Field Tech": "bg-gray-100 text-gray-600 border-gray-200",
};
