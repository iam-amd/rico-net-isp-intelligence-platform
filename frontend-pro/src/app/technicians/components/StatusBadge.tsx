export function StatusBadge({ isActive }: { isActive: number | boolean }) {
    const active = isActive === 1 || isActive === true;
    return active ? (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
            Active
        </span>
    ) : (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
            Inactive
        </span>
    );
}
