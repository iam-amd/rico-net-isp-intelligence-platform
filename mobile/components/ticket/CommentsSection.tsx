import React, { useState, useEffect } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TicketService } from '../../services/ticketService';
import { TicketComment } from '../../types';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface CommentsSectionProps {
    ticketId: string | number;
    readonly?: boolean;
}

export default function CommentsSection({ ticketId, readonly = false }: CommentsSectionProps) {
    const [comments, setComments] = useState<TicketComment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newComment, setNewComment] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        loadComments();
    }, [ticketId]);

    const loadComments = async () => {
        try {
            setError(null);
            setLoading(true);
            const data = await TicketService.getComments(ticketId);
            setComments(data);
        } catch (e: any) {
            console.error('[CommentsSection] Failed to load comments', e);
            setError(e?.message || 'Failed to load comments');
        } finally {
            setLoading(false);
        }
    };

    const handleSend = async () => {
        const text = newComment.trim();
        if (!text || sending) return;

        setSending(true);
        try {
            const comment = await TicketService.addComment(ticketId, text);
            setComments(prev => [...prev, comment]);
            setNewComment('');
        } catch (e: any) {
            console.error('Failed to send comment', e);
            const msg = e?.message || 'Failed to send comment. Please try again.';
            if (Platform.OS === 'web') {
                alert(msg);
            } else {
                Alert.alert('Send Failed', msg);
            }
        } finally {
            setSending(false);
        }
    };

    const formatTime = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            const now = new Date();
            const diffMs = now.getTime() - d.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return `${diffHours}h ago`;
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7) return `${diffDays}d ago`;
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        } catch {
            return '';
        }
    };

    return (
        <View style={styles.container}>
            {/* Section Header */}
            <View style={styles.sectionHeader}>
                <Ionicons name="chatbubbles-outline" size={16} color={COLORS.text.light} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>COMMENTS & ACTIVITY</Text>
                <Text style={styles.countBadge}>{comments.length}</Text>
            </View>

            {/* Comment List */}
            {loading ? (
                <ActivityIndicator size="small" color={COLORS.primary} style={{ padding: SPACING.md }} />
            ) : error ? (
                <View style={styles.errorState}>
                    <Ionicons name="cloud-offline-outline" size={24} color={COLORS.state.danger} />
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={loadComments}>
                        <Ionicons name="refresh" size={14} color={COLORS.primary} />
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : comments.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>No comments yet</Text>
                </View>
            ) : (
                <View style={styles.commentList}>
                    {comments.map(comment => (
                        <View key={comment.id} style={styles.commentItem}>
                            <View style={styles.avatarSmall}>
                                <Text style={styles.avatarSmallText}>
                                    {comment.author?.charAt(0)?.toUpperCase() || '?'}
                                </Text>
                            </View>
                            <View style={styles.commentContent}>
                                <View style={styles.commentHeader}>
                                    <Text style={styles.authorName}>{comment.author}</Text>
                                    <Text style={styles.timestamp}>{formatTime(comment.created_at)}</Text>
                                </View>
                                <Text style={styles.commentText}>{comment.content}</Text>
                                {comment.is_internal === 1 && (
                                    <View style={styles.internalBadge}>
                                        <Ionicons name="lock-closed" size={10} color={COLORS.state.info} />
                                        <Text style={styles.internalText}>Internal</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    ))}
                </View>
            )}

            {/* Input Bar */}
            {!readonly && (
                <View style={styles.inputBar}>
                    <TextInput
                        style={styles.input}
                        placeholder="Add a comment..."
                        placeholderTextColor={COLORS.text.light}
                        value={newComment}
                        onChangeText={setNewComment}
                        multiline
                        maxLength={1000}
                    />
                    <TouchableOpacity
                        style={[styles.sendBtn, (!newComment.trim() || sending) && styles.sendBtnDisabled]}
                        onPress={handleSend}
                        disabled={!newComment.trim() || sending}
                    >
                        {sending ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <Ionicons name="send" size={18} color="#FFF" />
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: SPACING.md,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
        marginLeft: 4,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.text.light,
        letterSpacing: 1.2,
    },
    countBadge: {
        marginLeft: 6,
        backgroundColor: COLORS.primary + '20',
        color: COLORS.primary,
        fontSize: 11,
        fontWeight: '700',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
        overflow: 'hidden',
    },
    commentList: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    commentItem: {
        flexDirection: 'row',
        padding: SPACING.md,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.background,
    },
    avatarSmall: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: COLORS.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: SPACING.sm,
    },
    avatarSmallText: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.primary,
    },
    commentContent: {
        flex: 1,
    },
    commentHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2,
    },
    authorName: {
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.text.primary,
    },
    timestamp: {
        fontSize: 11,
        color: COLORS.text.light,
    },
    commentText: {
        fontSize: 13,
        color: COLORS.text.secondary,
        lineHeight: 18,
    },
    internalBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 3,
    },
    internalText: {
        fontSize: 10,
        color: COLORS.state.info,
        fontWeight: '600',
    },
    emptyState: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        padding: SPACING.lg,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    emptyText: {
        fontSize: 13,
        color: COLORS.text.light,
    },
    errorState: {
        backgroundColor: '#FEF2F2',
        borderRadius: RADIUS.md,
        padding: SPACING.lg,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#FEE2E2',
        gap: 8,
    },
    errorText: {
        fontSize: 13,
        color: COLORS.state.danger,
        textAlign: 'center',
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.primary + '15',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: RADIUS.full,
        gap: 4,
        marginTop: 4,
    },
    retryText: {
        fontSize: 13,
        fontWeight: '600',
        color: COLORS.primary,
    },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: SPACING.sm,
        marginTop: SPACING.sm,
        gap: 8,
    },
    input: {
        flex: 1,
        fontSize: 14,
        color: COLORS.text.primary,
        maxHeight: 80,
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs,
    },
    sendBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: COLORS.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendBtnDisabled: {
        opacity: 0.4,
    },
});
