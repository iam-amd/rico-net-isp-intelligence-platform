import React, { useState } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, Modal, Text, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TicketMedia } from '../types';
import { CONFIG } from '../constants/config';
import { COLORS, RADIUS, SPACING } from '../constants/theme';

const { width } = Dimensions.get('window');
// On Web, the window width can be huge, causing huge images. 
// We'll clamp the calculation base or use a fixed size.
const isWeb = Platform.OS === 'web';
const gridWidth = isWeb ? Math.min(width, 500) : width;
const ITEM_WIDTH = (gridWidth - SPACING.md * 2 - 20) / 3; // 3 columns based on a reasonable max width

interface Props {
    photos: TicketMedia[];
    onDelete?: (id: number) => void;
    readonly?: boolean;
}

export default function PhotoGrid({ photos, onDelete, readonly = false }: Props) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const getImageUrl = (path: string) => {
        if (!path) return null;
        // Check if it's already a full URL (http/https or file:// or data:)
        if (path.startsWith('http') || path.startsWith('file://') || path.startsWith('data:')) {
            return path;
        }

        // It's a relative path from the server
        // Remove leading slash if present to avoid double slashes with API_BASE_URL
        const cleanPath = path.replace(/\\/g, '/').replace(/^\//, '');
        return `${CONFIG.API_BASE_URL}/${cleanPath}`;
    };

    return (
        <View style={styles.grid}>
            {photos.map((photo) => {
                const uri = getImageUrl(photo.file_path);
                return (
                    <TouchableOpacity
                        key={photo.id}
                        style={styles.item}
                        onPress={() => setPreviewUrl(uri)}
                    >
                        <Image source={{ uri: uri || '' }} style={styles.image} />

                        {!readonly && onDelete && (
                            <TouchableOpacity
                                style={styles.deleteBtn}
                                onPress={() => onDelete(photo.id)}
                            >
                                <Ionicons name="close" size={12} color="white" />
                            </TouchableOpacity>
                        )}
                    </TouchableOpacity>
                );
            })}

            {/* FULL SCREEN PREVIEW MODAL */}
            <Modal visible={!!previewUrl} transparent={true} onRequestClose={() => setPreviewUrl(null)}>
                <View style={styles.modalContainer}>
                    <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={() => setPreviewUrl(null)}
                    >
                        <Ionicons name="close-circle" size={30} color="white" />
                    </TouchableOpacity>

                    {previewUrl && (
                        <Image
                            source={{ uri: previewUrl }}
                            style={styles.fullImage}
                            resizeMode="contain"
                        />
                    )}
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    item: {
        width: ITEM_WIDTH,
        height: ITEM_WIDTH,
        borderRadius: RADIUS.sm,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#eee',
    },
    image: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    deleteBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        backgroundColor: 'rgba(0,0,0,0.6)',
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullImage: {
        width: '100%',
        height: '80%',
    },
    closeBtn: {
        position: 'absolute',
        top: 40,
        right: 20,
        zIndex: 10,
    }
});
