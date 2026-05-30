import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OcrIdentityMatchType, StickerOcrResponse } from './collectionService';

export type ScannerStickerType = 'ont' | 'router';
export type ScannerSource = 'camera_scan' | 'barcode_only' | 'manual';

export interface StickerScanResult {
    stickerType: ScannerStickerType;
    source: ScannerSource;
    capturedAt: string;
    photoUri: string | null;
    photoUrl?: string | null;
    barcodeValue?: string | null;
    barcodeType?: string | null;
    macAddress: string | null;
    gponSn: string | null;
    serialNumber: string | null;
    onuIdentifier: string | null;
    model: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    macConfidence: 'high' | 'medium' | 'low' | null;
    deviceType: StickerOcrResponse['device_type'] | 'unknown';
    rawText: string | null;
    stickerFields?: Record<string, any>;
    serialCandidates?: string[];
    macCandidates?: string[];
    identityInDatabase: boolean | null;
    identityStatus: string | null;
    identityMatchType: OcrIdentityMatchType;
    identityMatchValue: string | null;
    identityOltHost: string | null;
    identityPonPort: string | null;
    identityOnuIndex: number | null;
    error?: string | null;
}

const NORMAL_PREFIX = 'rico_sticker_scan_result:normal:';
const PG_ROOM_PREFIX = 'rico_sticker_scan_result:pg_room:';
const PG_GROUP_PREFIX = 'rico_sticker_scan_result:pg_group:';

function keyPart(value: string): string {
    return encodeURIComponent(value);
}

function normalKey(username: string, stickerType: ScannerStickerType): string {
    return `${NORMAL_PREFIX}${keyPart(username)}:${stickerType}`;
}

function pgRoomKey(roomId: string, stickerType: ScannerStickerType): string {
    return `${PG_ROOM_PREFIX}${keyPart(roomId)}:${stickerType}`;
}

function pgGroupKey(groupId: string): string {
    return `${PG_GROUP_PREFIX}${keyPart(groupId)}`;
}

async function readAndRemove(key: string): Promise<StickerScanResult | null> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    await AsyncStorage.removeItem(key);
    try {
        return JSON.parse(raw) as StickerScanResult;
    } catch {
        return null;
    }
}

async function write(key: string, result: StickerScanResult): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(result));
}

export const stickerScanResultService = {
    saveNormalSurveyResult(username: string, stickerType: ScannerStickerType, result: StickerScanResult) {
        return write(normalKey(username, stickerType), result);
    },

    consumeNormalSurveyResult(username: string, stickerType: ScannerStickerType) {
        return readAndRemove(normalKey(username, stickerType));
    },

    savePGRoomResult(roomId: string, stickerType: ScannerStickerType, result: StickerScanResult) {
        return write(pgRoomKey(roomId, stickerType), result);
    },

    consumePGRoomResult(roomId: string, stickerType: ScannerStickerType) {
        return readAndRemove(pgRoomKey(roomId, stickerType));
    },

    savePGGroupResult(groupId: string, result: StickerScanResult) {
        return write(pgGroupKey(groupId), result);
    },

    consumePGGroupResult(groupId: string) {
        return readAndRemove(pgGroupKey(groupId));
    },
};

export default stickerScanResultService;
