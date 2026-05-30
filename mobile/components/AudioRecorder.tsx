import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import AudioVisualizer from './AudioVisualizer';

interface Props {
    onRecordingComplete: (uri: string) => void;
    disabled?: boolean;
}

export default function AudioRecorder({ onRecordingComplete, disabled }: Props) {
    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [permissionResponse, requestPermission] = Audio.usePermissions();
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [metering, setMetering] = useState(-160); // Initial silence

    // Web Audio API refs
    const audioContextRef = React.useRef<AudioContext | null>(null);
    const analyserRef = React.useRef<AnalyserNode | null>(null);
    const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
    const animationFrameRef = React.useRef<number | null>(null);

    useEffect(() => {
        let timer: any;
        if (isRecording) {
            timer = setInterval(() => {
                setDuration(d => d + 1);
            }, 1000);
        } else {
            setDuration(0);
            cleanupWebAudio();
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [isRecording]);

    const cleanupWebAudio = () => {
        if (Platform.OS === 'web') {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            if (sourceRef.current) {
                sourceRef.current.disconnect();
                sourceRef.current = null;
            }
            if (analyserRef.current) {
                analyserRef.current.disconnect();
                analyserRef.current = null;
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        }
    };

    const startWebAudioMetering = async () => {
        if (Platform.OS !== 'web') return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            sourceRef.current = source;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const updateMetering = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(dataArray);

                // Calculate average volume
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;

                // Boost sensitivity for Web
                // Map 0-255 to a more usable dB range for the visualizer (-160 to 0)
                // Visualizer expects > -60 to start showing
                // Let's ensure even faint noise (~10 value) maps to around -50 or -40

                const normalized = average / 255;
                // Logarithmic-ish boost
                // simple linear mapping: 0 -> -160, 1 -> 0
                // New mapping:
                // average 0 -> -160
                // average 5 -> -60 (start showing)
                // average 50 -> -20
                // average 100+ -> -5 to 0

                let db;
                if (average < 1) {
                    db = -160;
                } else {
                    // Heuristic formula to make it look good
                    db = (20 * Math.log10(normalized)) + 10; // Boosted
                    // Cap at 0
                    db = Math.min(0, Math.max(-160, db));
                }

                // Fallback: If it's too quiet, inject a tiny bit of noise if recording is active so user sees IT IS working
                if (db < -60) db = -60 + (Math.random() * 5);

                setMetering(db);

                // Throttle updates to ~100ms to match mobile behavior and avoid excessive re-renders
                setTimeout(() => {
                    if (animationFrameRef.current) { // Check if still running
                        animationFrameRef.current = requestAnimationFrame(updateMetering);
                    }
                }, 50); // Faster updates for smoother web feel? Let's stick to 50-100. 
            };

            // Start the loop
            animationFrameRef.current = requestAnimationFrame(updateMetering);

            updateMetering();
        } catch (error) {
            console.error("Failed to start web audio metering:", error);
        }
    };

    async function startRecording() {
        try {
            if (permissionResponse?.status !== 'granted') {
                console.log('Requesting permission..');
                await requestPermission();
            }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            console.log('Starting recording..');
            const recordingOptions = {
                ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
                isMeteringEnabled: true,
            };

            const { recording } = await Audio.Recording.createAsync(
                recordingOptions,
                (status) => {
                    if (status.metering !== undefined) {
                        setMetering(status.metering);
                    }
                }
            );

            setRecording(recording);
            setIsRecording(true);
            if (Platform.OS === 'web') {
                startWebAudioMetering();
            }
            console.log('Recording started');
        } catch (err) {
            console.error('Failed to start recording', err);
            Alert.alert('Error', 'Failed to start recording');
        }
    }

    async function stopRecording() {
        console.log('Stopping recording..');
        setRecording(null);
        setIsRecording(false);
        try {
            if (recording) {
                await recording.stopAndUnloadAsync();
                const uri = recording.getURI();
                console.log('Recording stopped and stored at', uri);
                if (uri) {
                    onRecordingComplete(uri);
                }
            }
        } catch (error) {
            console.error('Failed to stop recording', error);
        }
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    if (disabled) return null;

    if (isRecording) {
        return (
            <View style={styles.recordingContainer}>
                <View style={styles.recordingIndicator}>
                    {/* <View style={styles.dot} /> */}
                    <Text style={styles.recordingText}>Recording {formatDuration(duration)}</Text>
                    <AudioVisualizer isRecording={true} metering={metering} />
                </View>
                <TouchableOpacity onPress={stopRecording} style={styles.stopBtn}>
                    <Ionicons name="stop" size={20} color="white" />
                    <Text style={styles.btnText}>STOP</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <TouchableOpacity style={styles.startBtn} onPress={startRecording} disabled={disabled}>
            <Ionicons name="mic" size={20} color={COLORS.primary} />
            <Text style={styles.startText}>Record Audio Note</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    startBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EFF6FF',
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderStyle: 'dashed',
        marginTop: 10,
    },
    startText: {
        marginLeft: SPACING.sm,
        color: COLORS.primary,
        fontWeight: '600',
        fontSize: 14,
    },
    recordingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FEF2F2',
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#FECACA',
        marginTop: 10,
    },
    recordingIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: COLORS.state.danger,
        marginRight: 8,
    },
    recordingText: {
        color: COLORS.state.danger,
        fontWeight: '600',
        fontSize: 14,
    },
    stopBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.state.danger,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: RADIUS.sm,
    },
    btnText: {
        color: 'white',
        fontWeight: '700',
        fontSize: 12,
        marginLeft: 6,
    }
});
