import { isValidTransition } from '../../types';

describe('Ticket State Machine', () => {
    it('Open can transition to Assigned', () => {
        expect(isValidTransition('Open', 'Assigned')).toBe(true);
    });

    it('Open can transition to Ongoing', () => {
        expect(isValidTransition('Open', 'Ongoing')).toBe(true);
    });

    it('Open cannot transition to Resolved', () => {
        expect(isValidTransition('Open', 'Resolved')).toBe(false);
    });

    it('Assigned can transition to Ongoing', () => {
        expect(isValidTransition('Assigned', 'Ongoing')).toBe(true);
    });

    it('Assigned can transition to Open', () => {
        expect(isValidTransition('Assigned', 'Open')).toBe(true);
    });

    it('Ongoing can transition to Resolved', () => {
        expect(isValidTransition('Ongoing', 'Resolved')).toBe(true);
    });

    it('Ongoing can transition to Assigned', () => {
        expect(isValidTransition('Ongoing', 'Assigned')).toBe(true);
    });

    it('Ongoing cannot transition to Closed', () => {
        expect(isValidTransition('Ongoing', 'Closed')).toBe(false);
    });

    it('Resolved can transition to Closed', () => {
        expect(isValidTransition('Resolved', 'Closed')).toBe(true);
    });

    it('Closed can be reopened for operational correction', () => {
        expect(isValidTransition('Closed', 'Open')).toBe(true);
        expect(isValidTransition('Closed', 'Ongoing')).toBe(true);
        expect(isValidTransition('Closed', 'Assigned')).toBe(true);
        expect(isValidTransition('Closed', 'Resolved')).toBe(false);
    });
});
