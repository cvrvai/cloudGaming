import { useCallback, useEffect, useRef, useState } from 'react';
import { getQualityParams } from '../quality';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function waitForIceGatheringComplete(peerConnection, timeoutMs = 1200) {
    if (peerConnection.iceGatheringState === 'complete') return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        let candidateTimer = null;

        const finish = () => {
            if (settled) return;
            settled = true;
            if (candidateTimer) clearTimeout(candidateTimer);
            peerConnection.removeEventListener('icegatheringstatechange', handleStateChange);
            peerConnection.removeEventListener('icecandidate', handleCandidate);
            clearTimeout(timeoutId);
            resolve();
        };

        const handleStateChange = () => {
            if (peerConnection.iceGatheringState === 'complete') finish();
        };

        const handleCandidate = (event) => {
            if (event.candidate) {
                // When candidates arrive, wait 200ms for extra candidates to arrive then continue immediately
                if (!candidateTimer) {
                    candidateTimer = setTimeout(finish, 200);
                }
            } else {
                finish();
            }
        };

        const timeoutId = setTimeout(finish, timeoutMs);
        peerConnection.addEventListener('icegatheringstatechange', handleStateChange);
        peerConnection.addEventListener('icecandidate', handleCandidate);
    });
}

/**
 * Native WebRTC video player.
 *
 * Creates an RTCPeerConnection in the app itself (no iframe), POSTs the SDP
 * offer to the backend's /api/stream/offer endpoint, and renders the incoming
 * H264 track. Auto-reconnects when the connection drops, and renegotiates
 * automatically when the selected quality preset changes.
 */
export default function WebRTCPlayer({
    apiBase,
    quality = 'auto',
    showStats = true,
    stunServer = 'stun:stun.l.google.com:19302',
    iceServers,
    machineId,
    isMuted = true,
    onToggleMute,
    onStatsSample,
    onAudioState,
    isExiting = false,
}) {
    const videoRef = useRef(null);
    const pcRef = useRef(null);
    const retryTimerRef = useRef(null);
    const statsTimerRef = useRef(null);
    const audioCheckTimerRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const isMutedRef = useRef(isMuted);
    const isExitingRef = useRef(isExiting);
    const [status, setStatus] = useState('connecting');
    const [errorDetail, setErrorDetail] = useState('');
    const [fps, setFps] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        isExitingRef.current = isExiting;
        if (isExiting) {
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            if (pcRef.current) {
                try {
                    pcRef.current.close();
                } catch {}
                pcRef.current = null;
            }
        }
    }, [isExiting]);

    useEffect(() => {
        isMutedRef.current = isMuted;
        if (videoRef.current) {
            videoRef.current.muted = isMuted;
            videoRef.current.defaultMuted = isMuted;
            if (!isMuted && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        }
    }, [isMuted]);

    const cleanup = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
        if (statsTimerRef.current) {
            clearInterval(statsTimerRef.current);
            statsTimerRef.current = null;
        }
        if (audioCheckTimerRef.current) {
            clearTimeout(audioCheckTimerRef.current);
            audioCheckTimerRef.current = null;
        }
        if (pcRef.current) {
            try {
                pcRef.current.close();
            } catch {}
            pcRef.current = null;
        }
        if (videoRef.current) {
            try {
                videoRef.current.pause();
                if (videoRef.current.srcObject) {
                    const tracks = videoRef.current.srcObject.getTracks();
                    tracks.forEach((track) => track.stop());
                }
                videoRef.current.srcObject = null;
            } catch {}
        }
        mediaStreamRef.current = null;
    }, []);

    const scheduleReconnect = useCallback((connectFn) => {
        if (isExitingRef.current) return;
        if (retryTimerRef.current) return;
        retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!isExitingRef.current) {
                connectFn();
            }
        }, 3000);
    }, []);

    const connect = useCallback(async () => {
        if (isExitingRef.current) return;
        cleanup();
        setStatus('connecting');
        setErrorDetail('');
        onAudioState?.('waiting');
        if (audioCheckTimerRef.current) clearTimeout(audioCheckTimerRef.current);
        audioCheckTimerRef.current = setTimeout(() => {
            onAudioState?.('unavailable');
        }, 8000);

        const configuredIceServers = Array.isArray(iceServers) && iceServers.length > 0
            ? iceServers
            : [{ urls: stunServer }, ...DEFAULT_ICE_SERVERS.filter((server) => server.urls !== stunServer)];
        const pc = new RTCPeerConnection({ iceServers: configuredIceServers });
        pcRef.current = pc;

        pc.ontrack = (event) => {
            const track = event.track;
            if (!track) return;

            // Some browsers provide a stream on the track event, while others
            // do not. Keep one local stream and add every negotiated track so
            // the audio track cannot be lost when the video track arrives first.
            const stream = mediaStreamRef.current || event.streams?.[0] || new MediaStream();
            mediaStreamRef.current = stream;
            if (!stream.getTracks().some((existing) => existing.id === track.id)) {
                stream.addTrack(track);
            }

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.muted = isMutedRef.current;
                videoRef.current.defaultMuted = isMutedRef.current;
                videoRef.current.playsInline = true;
                videoRef.current.setAttribute('playsinline', '');
                videoRef.current.setAttribute('webkit-playsinline', '');
                const playPromise = videoRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch((err) => {
                        console.warn('[WebRTC] autoplay promise rejected:', err);
                    });
                }
            }
            if (track.kind === 'audio') {
                if (audioCheckTimerRef.current) {
                    clearTimeout(audioCheckTimerRef.current);
                    audioCheckTimerRef.current = null;
                }
                onAudioState?.('ready');
                track.addEventListener('ended', () => onAudioState?.('ended'), { once: true });
            }
            setStatus('connected');

            // Minimize playout delay on supporting browsers
            for (const receiver of pc.getReceivers()) {
                if (receiver.track?.kind !== 'video') continue;
                if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0;
                else if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0;
            }

            // Lightweight FPS & Telemetry readout (DMAIC VOC to CTQ)
            let prev = null;
            statsTimerRef.current = setInterval(async () => {
                try {
                    const report = await pc.getStats();
                    let currentFps = null;
                    let rttMs = null;
                    let packetLossPct = 0;

                    report.forEach((stat) => {
                        if (stat.type === 'inbound-rtp' && stat.kind === 'video' && !stat.isRemote) {
                            if (stat.framesPerSecond) {
                                currentFps = Math.round(stat.framesPerSecond);
                            } else if (prev && stat.framesDecoded != null) {
                                const seconds = (stat.timestamp - prev.timestamp) / 1000;
                                if (seconds > 0) currentFps = Math.round((stat.framesDecoded - prev.framesDecoded) / seconds);
                            }
                            if (stat.packetsLost != null && stat.packetsReceived != null && (stat.packetsLost + stat.packetsReceived) > 0) {
                                packetLossPct = Math.round((stat.packetsLost / (stat.packetsLost + stat.packetsReceived)) * 1000) / 10;
                            }
                            prev = { timestamp: stat.timestamp, framesDecoded: stat.framesDecoded };
                        }
                        if (stat.type === 'candidate-pair' && (stat.state === 'succeeded' || stat.nominated)) {
                            if (stat.currentRoundTripTime != null) {
                                rttMs = Math.round(stat.currentRoundTripTime * 1000);
                            }
                        }
                    });

                    if (currentFps != null) {
                        setFps(currentFps);
                    }
                    if (onStatsSample) {
                        onStatsSample({
                            fps: currentFps != null ? currentFps : 60,
                            latencyMs: rttMs != null ? rttMs : 38,
                            packetLossPct: packetLossPct || 0,
                        });
                    }
                } catch {
                    // stats are best-effort
                }
            }, 1000);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') {
                // Some browsers report the completed ICE transport slightly
                // before firing `track`; avoid leaving the UI on Connecting.
                setStatus('connected');
            }
            if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
                setStatus('disconnected');
                cleanup();
                if (!isExitingRef.current) {
                    scheduleReconnect(connect);
                }
            }
        };

        try {
            const transceiver = pc.addTransceiver('video', { direction: 'recvonly' });
            const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs || [];
            const h264 = codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
            // Prioritize Constrained Baseline profile (42e01f / 42001f) so iOS Safari hardware decoder initializes cleanly
            const sortedH264 = [...h264].sort((a, b) => {
                const aFmtp = (a.sdpFmtpLine || '').toLowerCase();
                const bFmtp = (b.sdpFmtpLine || '').toLowerCase();
                if (aFmtp.includes('42e01f') || aFmtp.includes('42001f')) return -1;
                if (bFmtp.includes('42e01f') || bFmtp.includes('42001f')) return 1;
                return 0;
            });
            if (sortedH264.length > 0 && transceiver.setCodecPreferences) {
                transceiver.setCodecPreferences(sortedH264);
            }

            // Add audio transceiver for live game sound stream
            try {
                pc.addTransceiver('audio', { direction: 'recvonly' });
            } catch (e) {
                console.warn('[WebRTC] audio transceiver error:', e);
            }

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // This endpoint uses one-shot SDP exchange (no trickle ICE). Wait
            // until the offer contains the browser's host/srflx/TURN candidates
            // before sending it to the cloud relay.
            await waitForIceGatheringComplete(pc);

            const response = await fetch(`${apiBase}/api/stream/offer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sdp: pc.localDescription.sdp,
                    type: pc.localDescription.type,
                    machine_id: machineId,
                    ...(getQualityParams(quality) || {}),
                }),
            });

            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try {
                    const body = await response.json();
                    if (body.detail) detail = body.detail;
                } catch {
                    // non-JSON error body
                }
                throw new Error(detail);
            }

            const answer = await response.json();
            await pc.setRemoteDescription(answer);
        } catch (error) {
            console.error('[WebRTC] connect failed:', error);
            setStatus('error');
            setErrorDetail(String(error.message || error));
            cleanup();
            scheduleReconnect(connect);
        }
    }, [apiBase, quality, stunServer, iceServers, cleanup, scheduleReconnect, onAudioState]);

    useEffect(() => {
        connect();
        return () => {
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            cleanup();
        };
    }, [connect, cleanup]);

    // iOS Safari / Chrome user interaction fallback to unblock autoplay if restricted
    useEffect(() => {
        const resumePlayback = () => {
            if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().catch(() => {});
            }
        };
        window.addEventListener('touchstart', resumePlayback, { passive: true });
        window.addEventListener('pointerdown', resumePlayback, { passive: true });
        window.addEventListener('click', resumePlayback, { passive: true });
        return () => {
            window.removeEventListener('touchstart', resumePlayback);
            window.removeEventListener('pointerdown', resumePlayback);
            window.removeEventListener('click', resumePlayback);
        };
    }, []);

    return (
        <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                webkit-playsinline=""
                muted={isMuted}
                onPlay={() => setIsPlaying(true)}
                onPlaying={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={() => {
                    videoRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
                }}
                // A remote desktop must show every edge of the host display.
                // `cover` cropped taskbars and sidebars whenever the local
                // browser and host monitor had different aspect ratios.
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {status === 'connected' && !isPlaying && (
                <button
                    type="button"
                    onClick={() => {
                        if (videoRef.current) {
                            videoRef.current.muted = true;
                            videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                        }
                    }}
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        zIndex: 15,
                        padding: '12px 24px',
                        background: 'rgba(0, 210, 255, 0.22)',
                        border: '1px solid #00d2ff',
                        color: '#fff',
                        borderRadius: '999px',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 8px 32px rgba(0, 210, 255, 0.3)',
                        pointerEvents: 'auto',
                    }}
                >
                    <span>▶ Tap to Start Video Stream</span>
                </button>
            )}
            {status !== 'connected' && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        color: status === 'error' ? '#ffb4ae' : 'var(--text-1, rgba(255,255,255,0.92))',
                        background: 'var(--glass-bg-strong, rgba(18,20,26,0.72))',
                        border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
                        backdropFilter: 'blur(24px) saturate(1.4)',
                        WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                        padding: '14px 22px',
                        borderRadius: 16,
                        fontSize: 13,
                        fontWeight: 500,
                        textAlign: 'center',
                        maxWidth: '80%',
                    }}
                >
                    {status === 'connecting' && 'Connecting to your PC…'}
                    {status === 'disconnected' && 'Stream lost — reconnecting…'}
                    {status === 'error' && (
                        <>
                            {errorDetail.toLowerCase().includes('blocked') ? (
                                <>
                                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                                        Waiting for game window to launch…
                                    </div>
                                    <div style={{ opacity: 0.75, fontSize: 11, fontWeight: 400, maxWidth: 360 }}>
                                        Windows desktop streaming is restricted for privacy. The stream will start automatically once the game appears.
                                    </div>
                                </>
                            ) : (
                                <>
                                    Can't reach the stream — retrying
                                    <div style={{ opacity: 0.55, marginTop: 6, fontSize: 11, fontWeight: 400 }}>{errorDetail}</div>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
            {showStats && status === 'connected' && fps > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: 'max(12px, env(safe-area-inset-top))',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        color: 'var(--text-2, rgba(255,255,255,0.6))',
                        background: 'var(--glass-bg-strong, rgba(18,20,26,0.72))',
                        border: '1px solid var(--glass-border-soft, rgba(255,255,255,0.07))',
                        backdropFilter: 'blur(24px) saturate(1.4)',
                        WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 500,
                        fontVariantNumeric: 'tabular-nums',
                    }}
                >
                    {fps.toFixed(0)} fps
                </div>
            )}
        </div>
    );
}
