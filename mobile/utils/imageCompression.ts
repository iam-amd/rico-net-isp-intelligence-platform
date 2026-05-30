import * as ImageManipulator from 'expo-image-manipulator';

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.7;

export async function compressImage(uri: string): Promise<string> {
    try {
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: MAX_DIMENSION } }],
            {
                compress: JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );
        return result.uri;
    } catch (error) {
        console.warn('[ImageCompression] Failed, using original:', error);
        return uri;
    }
}
