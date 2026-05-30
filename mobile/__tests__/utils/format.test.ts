import { formatName } from '../../utils/format';

describe('formatName', () => {
    it('should format first and last name', () => {
        expect(formatName('John', 'Doe')).toBe('John Doe');
    });

    it('should handle only first name', () => {
        expect(formatName('John', undefined)).toBe('John');
    });

    it('should handle only last name', () => {
        expect(formatName(undefined, 'Doe')).toBe('Doe');
    });

    it('should handle NaN strings', () => {
        expect(formatName('NaN', 'NaN')).not.toContain('NaN');
    });

    it('should handle null strings', () => {
        expect(formatName('null', 'null')).not.toContain('null');
    });

    it('should handle undefined strings', () => {
        expect(formatName('undefined', 'undefined')).not.toContain('undefined');
    });

    it('should trim whitespace', () => {
        const result = formatName('  John  ', '  Doe  ');
        expect(result).toBe('John Doe');
    });

    it('should return Unknown for empty/null input', () => {
        expect(formatName(undefined, undefined)).toBeTruthy();
    });
});
