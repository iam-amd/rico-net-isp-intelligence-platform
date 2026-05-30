import { Shield } from "lucide-react";
import { roleColorMap } from "../utils";

export function RoleBadge({ role, size = "sm" }: { role: string; size?: "sm" | "md" }) {
    const sizeClass = size === "md"
        ? "px-3 py-1 text-sm"
        : "px-2.5 py-0.5 text-xs";

    return (
        <span
            className={`inline-flex items-center gap-1.5 ${sizeClass} rounded-full font-medium border ${roleColorMap[role] || roleColorMap["Field Tech"]
                }`}
        >
            <Shield className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
            {role}
        </span>
    );
}
