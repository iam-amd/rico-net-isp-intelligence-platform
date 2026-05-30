import AsyncStorage from '@react-native-async-storage/async-storage';
import { CollectionSubmission, CollectionSubmissionResponse } from '../types';
import { SurveyDeviceSetup, SurveyService } from './collectionService';

const DRAFT_INDEX_KEY = 'rico_normal_survey_draft_index_v1';
const DRAFT_KEY_PREFIX = 'rico_normal_survey_draft_v1:';
const MAX_SYNC_RETRIES = 5;

export interface SurveyDraftGps {
    lat: number;
    lng: number;
    accuracy: number | null;
}

export interface NormalSurveyDraft {
    username: string;
    pendingSubmit: boolean;
    partial: boolean;
    gps: SurveyDraftGps | null;
    onuIdentifier: string;
    stickerPhotoUri: string | null;
    ontSerialNumber: string;
    ontMacAddress: string;
    ontModel: string;
    showStickerFields: boolean;
    ocrConfidence: 'high' | 'medium' | 'low' | null;
    macConfidence: 'high' | 'medium' | 'low' | null;
    macInDatabase: boolean | null;
    identityInDatabase: boolean | null;
    identityStatus: string | null;
    identityMatchType: 'serial' | 'mac' | 'mac_4a_fix' | null;
    identityLocation: string | null;
    ocrRawText: string | null;
    ocrError: string | null;
    deviceSetup: SurveyDeviceSetup;
    ontStickerData?: Record<string, any>;
    routerStickerUri: string | null;
    routerMacAddress: string;
    routerModel: string;
    routerSerial: string;
    routerStickerData?: Record<string, any>;
    altPhones: string[];
    phoneDraft: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    lastAttempt?: string;
    lastError?: string;
}

export type NormalSurveyDraftInput = Omit<
    NormalSurveyDraft,
    'createdAt' | 'updatedAt' | 'retryCount' | 'lastAttempt'
> & {
    createdAt?: string;
    updatedAt?: string;
    retryCount?: number;
    lastAttempt?: string;
};

export interface SurveyDraftSummary {
    total: number;
    pendingSubmit: number;
    failed: number;
}

function draftKey(username: string): string {
    return `${DRAFT_KEY_PREFIX}${encodeURIComponent(username)}`;
}

async function readIndex(): Promise<string[]> {
    try {
        const raw = await AsyncStorage.getItem(DRAFT_INDEX_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

async function writeIndex(usernames: string[]): Promise<void> {
    await AsyncStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(Array.from(new Set(usernames))));
}

async function addToIndex(username: string): Promise<void> {
    const index = await readIndex();
    if (!index.includes(username)) {
        await writeIndex([...index, username]);
    }
}

async function removeFromIndex(username: string): Promise<void> {
    const index = await readIndex();
    await writeIndex(index.filter((item) => item !== username));
}

function cleanText(value?: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function hasStickerIdentity(draft: Pick<NormalSurveyDraft, 'onuIdentifier' | 'ontSerialNumber' | 'ontMacAddress'>): boolean {
    return (
        draft.onuIdentifier.trim().length >= 4 ||
        draft.ontSerialNumber.trim().length >= 4 ||
        draft.ontMacAddress.trim().length >= 4
    );
}

function isServerUrl(uri?: string | null): boolean {
    return !!uri && (/^https?:\/\//i.test(uri) || uri.startsWith('/uploads/'));
}

async function uploadStickerIfNeeded(
    username: string,
    uri: string | null,
    upload: (username: string, uri: string) => Promise<{ status: string; url: string }>,
): Promise<string | undefined> {
    if (!uri) return undefined;
    if (isServerUrl(uri)) return uri;
    const uploaded = await upload(username, uri);
    return uploaded.url;
}

function buildSubmissionBody(
    draft: NormalSurveyDraft,
    stickerPhotoUrl?: string,
    routerStickerPhotoUrl?: string,
): CollectionSubmission {
    const pendingPhone = draft.phoneDraft.trim().replace(/\D/g, '');
    const phonesToSend = pendingPhone.length === 10 && !draft.altPhones.includes(pendingPhone)
        ? [...draft.altPhones, pendingPhone]
        : draft.altPhones;

    return {
        gps_lat: draft.gps?.lat,
        gps_lng: draft.gps?.lng,
        gps_accuracy_m: draft.gps?.accuracy ?? undefined,
        onu_identifier: cleanText(draft.onuIdentifier)?.toUpperCase(),
        ont_serial_number: cleanText(draft.ontSerialNumber),
        ont_mac_address: cleanText(draft.ontMacAddress),
        ont_model: cleanText(draft.ontModel),
        device_setup: draft.deviceSetup,
        sticker_photo_url: stickerPhotoUrl,
        ont_sticker_data: draft.ontStickerData
            ? { ...draft.ontStickerData, photoUrl: stickerPhotoUrl ?? draft.ontStickerData.photoUrl }
            : undefined,
        router_sticker_photo_url: routerStickerPhotoUrl,
        router_mac_address: draft.deviceSetup === 'onu_router' ? cleanText(draft.routerMacAddress) : undefined,
        router_model: draft.deviceSetup === 'onu_router' ? cleanText(draft.routerModel) : undefined,
        router_serial: draft.deviceSetup === 'onu_router' ? cleanText(draft.routerSerial) : undefined,
        router_sticker_data: draft.routerStickerData
            ? { ...draft.routerStickerData, photoUrl: routerStickerPhotoUrl ?? draft.routerStickerData.photoUrl }
            : undefined,
        alt_phones: phonesToSend.length ? phonesToSend : undefined,
        notes: [
            draft.notes.trim(),
            draft.deviceSetup === 'onu_router' ? 'Device: ONU + Router' : 'Device: Single ONT',
        ].filter(Boolean).join(' | ') || undefined,
    };
}

export const surveyDraftService = {
    async getDraft(username: string): Promise<NormalSurveyDraft | null> {
        try {
            const raw = await AsyncStorage.getItem(draftKey(username));
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    },

    async saveDraft(input: NormalSurveyDraftInput): Promise<NormalSurveyDraft> {
        const existing = await this.getDraft(input.username);
        const now = new Date().toISOString();
        const draft: NormalSurveyDraft = {
            ...input,
            createdAt: input.createdAt ?? existing?.createdAt ?? now,
            updatedAt: now,
            retryCount: input.retryCount ?? existing?.retryCount ?? 0,
            lastAttempt: input.lastAttempt ?? existing?.lastAttempt,
        };

        await AsyncStorage.setItem(draftKey(input.username), JSON.stringify(draft));
        await addToIndex(input.username);
        return draft;
    },

    async clearDraft(username: string): Promise<void> {
        await AsyncStorage.removeItem(draftKey(username));
        await removeFromIndex(username);
    },

    async listDrafts(): Promise<NormalSurveyDraft[]> {
        const usernames = await readIndex();
        const drafts = await Promise.all(usernames.map((username) => this.getDraft(username)));
        return drafts.filter((draft): draft is NormalSurveyDraft => !!draft);
    },

    async getSummary(): Promise<SurveyDraftSummary> {
        const drafts = await this.listDrafts();
        return {
            total: drafts.length,
            pendingSubmit: drafts.filter((draft) => draft.pendingSubmit).length,
            failed: drafts.filter((draft) => draft.retryCount >= MAX_SYNC_RETRIES).length,
        };
    },

    async submitDraft(input: NormalSurveyDraftInput): Promise<CollectionSubmissionResponse> {
        const draft = await this.saveDraft({ ...input, pendingSubmit: true });

        if (!draft.partial && !hasStickerIdentity(draft)) {
            throw new Error('ONT/ONU MAC or serial is required before full survey sync.');
        }
        if (draft.partial && !draft.gps && !hasStickerIdentity(draft)) {
            throw new Error('Capture GPS or scan the ONT sticker before survey sync.');
        }

        const stickerPhotoUrl = await uploadStickerIfNeeded(
            draft.username,
            draft.stickerPhotoUri,
            SurveyService.uploadStickerPhoto,
        );
        const routerStickerPhotoUrl = draft.deviceSetup === 'onu_router'
            ? await uploadStickerIfNeeded(
                draft.username,
                draft.routerStickerUri,
                SurveyService.uploadRouterStickerPhoto,
            )
            : undefined;

        const result = await SurveyService.submitByCustomer(
            draft.username,
            buildSubmissionBody(draft, stickerPhotoUrl, routerStickerPhotoUrl),
        );

        await this.clearDraft(draft.username);
        return result;
    },

    async processPendingDrafts(): Promise<{ processed: number; failed: number }> {
        const drafts = await this.listDrafts();
        let processed = 0;
        let failed = 0;

        for (const draft of drafts) {
            if (!draft.pendingSubmit || draft.retryCount >= MAX_SYNC_RETRIES) continue;
            try {
                await this.submitDraft(draft);
                processed++;
            } catch (error) {
                failed++;
                await this.saveDraft({
                    ...draft,
                    retryCount: draft.retryCount + 1,
                    lastAttempt: new Date().toISOString(),
                    lastError: error instanceof Error ? error.message : 'Survey sync failed',
                });
            }
        }

        return { processed, failed };
    },
};

export default surveyDraftService;
