/**
 * Format a customer's name, handling corrupted data like 'NaN', 'null', 'undefined'.
 */
export const formatName = (first: string | null | undefined, last: string | null | undefined): string => {
    const f = (first || '').trim();
    const l = (last || '').trim();

    // Check for corrupt strings
    const isCorrupt = (str: string) => {
        const lower = str.toLowerCase();
        return lower === 'nan' || lower === 'null' || lower === 'undefined';
    };

    const cleanFirst = isCorrupt(f) ? '' : f;
    const cleanLast = isCorrupt(l) ? '' : l;

    const full = `${cleanFirst} ${cleanLast}`.trim();
    return full || 'Unknown Customer';
};
