import AsyncStorage from '@react-native-async-storage/async-storage';
import { surveyDraftService, NormalSurveyDraftInput } from '../../services/surveyDraftService';
import { SurveyService } from '../../services/collectionService';

jest.mock('../../services/collectionService', () => ({
    SurveyService: {
        uploadStickerPhoto: jest.fn(),
        uploadRouterStickerPhoto: jest.fn(),
        submitByCustomer: jest.fn(),
    },
}));

const storage = new Map<string, string>();

function baseDraft(overrides: Partial<NormalSurveyDraftInput> = {}): NormalSurveyDraftInput {
    return {
        username: 'TEST001',
        pendingSubmit: false,
        partial: false,
        gps: { lat: 12.345, lng: 79.123, accuracy: 8 },
        onuIdentifier: 'GPON00ABC123',
        stickerPhotoUri: 'file:///ont.jpg',
        ontSerialNumber: 'GPON00ABC123',
        ontMacAddress: '8C:13:AA:BB:CC:DD',
        ontModel: 'NETLINK-GPON',
        showStickerFields: true,
        ocrConfidence: 'high',
        macConfidence: 'high',
        macInDatabase: true,
        identityInDatabase: true,
        identityStatus: 'online',
        identityMatchType: 'serial',
        identityLocation: 'OLT-1 / 1/2 / ONU 7',
        ocrRawText: 'MAC 8C:13:AA:BB:CC:DD\nSN GPON00ABC123',
        ocrError: null,
        deviceSetup: 'single_ont',
        ontStickerData: { rawText: 'sticker', photoUrl: 'file:///ont.jpg' },
        routerStickerUri: null,
        routerMacAddress: '',
        routerModel: '',
        routerSerial: '',
        routerStickerData: undefined,
        altPhones: ['9876543210'],
        phoneDraft: '',
        notes: 'near staircase',
        ...overrides,
    };
}

describe('surveyDraftService', () => {
    beforeEach(() => {
        storage.clear();
        jest.clearAllMocks();
        (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => Promise.resolve(storage.get(key) ?? null));
        (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
            storage.set(key, value);
            return Promise.resolve();
        });
        (AsyncStorage.removeItem as jest.Mock).mockImplementation((key: string) => {
            storage.delete(key);
            return Promise.resolve();
        });
    });

    it('saves and restores a normal survey draft with sticker evidence', async () => {
        const saved = await surveyDraftService.saveDraft(baseDraft());
        const loaded = await surveyDraftService.getDraft('TEST001');
        const summary = await surveyDraftService.getSummary();

        expect(saved.updatedAt).toBeDefined();
        expect(loaded?.ontStickerData?.rawText).toBe('sticker');
        expect(loaded?.stickerPhotoUri).toBe('file:///ont.jpg');
        expect(summary.total).toBe(1);
        expect(summary.pendingSubmit).toBe(0);
    });

    it('uploads sticker photos, submits one body, then clears the draft', async () => {
        (SurveyService.uploadStickerPhoto as jest.Mock).mockResolvedValue({ status: 'ok', url: '/uploads/ont.jpg' });
        (SurveyService.uploadRouterStickerPhoto as jest.Mock).mockResolvedValue({ status: 'ok', url: '/uploads/router.jpg' });
        (SurveyService.submitByCustomer as jest.Mock).mockResolvedValue({
            status: 'ok',
            assignment_id: 0,
            binding_id: 7,
            message: 'Saved',
            warnings: [],
        });

        const result = await surveyDraftService.submitDraft(baseDraft({
            deviceSetup: 'onu_router',
            routerStickerUri: 'file:///router.jpg',
            routerMacAddress: 'AA:BB:CC:DD:EE:FF',
            routerModel: 'TP-Link',
            routerSerial: 'R123',
            routerStickerData: { rawText: 'router sticker', photoUrl: 'file:///router.jpg' },
        }));

        expect(result.status).toBe('ok');
        expect(SurveyService.uploadStickerPhoto).toHaveBeenCalledWith('TEST001', 'file:///ont.jpg');
        expect(SurveyService.uploadRouterStickerPhoto).toHaveBeenCalledWith('TEST001', 'file:///router.jpg');
        expect(SurveyService.submitByCustomer).toHaveBeenCalledWith(
            'TEST001',
            expect.objectContaining({
                device_setup: 'onu_router',
                sticker_photo_url: '/uploads/ont.jpg',
                router_sticker_photo_url: '/uploads/router.jpg',
                router_mac_address: 'AA:BB:CC:DD:EE:FF',
                router_model: 'TP-Link',
                router_serial: 'R123',
                notes: 'near staircase | Device: ONU + Router',
            }),
        );
        const submittedBody = (SurveyService.submitByCustomer as jest.Mock).mock.calls[0][1];
        expect(submittedBody.ont_sticker_data.photoUrl).toBe('/uploads/ont.jpg');
        expect(submittedBody.router_sticker_data.photoUrl).toBe('/uploads/router.jpg');
        expect(await surveyDraftService.getDraft('TEST001')).toBeNull();
    });

    it('keeps failed pending drafts for retry', async () => {
        await surveyDraftService.saveDraft(baseDraft({ pendingSubmit: true }));
        (SurveyService.uploadStickerPhoto as jest.Mock).mockRejectedValue(new Error('offline'));

        const result = await surveyDraftService.processPendingDrafts();
        const draft = await surveyDraftService.getDraft('TEST001');

        expect(result.failed).toBe(1);
        expect(draft?.pendingSubmit).toBe(true);
        expect(draft?.retryCount).toBe(1);
        expect(draft?.lastError).toBe('offline');
    });
});
