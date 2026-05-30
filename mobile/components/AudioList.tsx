import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { TicketMedia } from '../types';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { CONFIG } from '../constants/config';

interface Props {
    audios: TicketMedia[];
    onDelete?: (id: number) => void;
}

export default function AudioList({ audios, onDelete }: Props) {
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [playingId, setPlayingId] = useState<number | null>(null);

    async function playSound(audio: TicketMedia) {
        if (sound) {
            await sound.unloadAsync();
            setSound(null);
            if (playingId === audio.id) {
                setPlayingId(null);
                return;
            }
        }

        const uri = audio.file_path.startsWith('http') || audio.file_path.startsWith('file://')
            ? audio.file_path
            : `${CONFIG.API_BASE_URL}/${audio.file_path.replace(/^\//, '')}`;

        console.log('Loading Sound', uri);
        try {
            const { sound: newSound } = await Audio.Sound.createAsync({ uri });
            setSound(newSound);
            setPlayingId(audio.id);

            console.log('Playing Sound');
            await newSound.playAsync();
            newSound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    setPlayingId(null);
                    setSound(null);
                }
            });
        } catch (error) {
            console.error("Failed to play sound", error);
        }
    }

    useEffect(() => {
        return sound
            ? () => {
                console.log('Unloading Sound');
                sound.unloadAsync();
            }
            : undefined;
    }, [sound]);

    if (!audios || audios.length === 0) return null;

    return (
        <View style={styles.container}>
            {audios.map((audio) => (
                <View key={audio.id} style={styles.item}>
                    <TouchableOpacity onPress={() => playSound(audio)} style={styles.playBtn}>
                        <Ionicons name={playingId === audio.id ? "pause" : "play"} size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                    <Text style={styles.filename} numberOfLines={1}>Audio Note {audio.id}</Text>
                    {onDelete && (
                        <TouchableOpacity onPress={() => onDelete(audio.id)} style={styles.deleteBtn}>
                            <Ionicons name="trash" size={18} color={COLORS.state.danger} />
                        </TouchableOpacity>
                    )}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 10,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        padding: SPACING.sm,
        borderRadius: RADIUS.md,
        marginBottom: 8,
    },
    playBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'white',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
    },
    filename: {
        flex: 1,
        fontSize: 14,
        color: COLORS.text.primary,
        fontWeight: '500',
    },
    deleteBtn: {
        padding: 8,
    }
});
