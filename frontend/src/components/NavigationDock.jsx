import { useEffect, useState } from 'react';
import { SettingsIcon } from './Icons';

const statusColor = (status) => {
    if (status === 'connected') return '#22c55e';
    if (status === 'error') return '#f59e0b';
    return '#ef4444';
};

const IconButton = ({ label, onClick, children }) => (
    <button
        type="button"
        className="edge-toolbar-button"
        aria-label={label}
        title={label}
        onClick={onClick}
    >
        {children}
    </button>
);

const NavigationDock = ({ status, onNavigate, onToggleMenu }) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isVisible, setIsVisible] = useState(true);

    const revealToolbar = () => {
        setIsVisible(true);
        window.clearTimeout(window.__cloudGameToolbarTimer);
        window.__cloudGameToolbarTimer = window.setTimeout(() => {
            setIsVisible(false);
        }, 3000);
    };

    const toggleFullscreen = async () => {
        // Fullscreen only the remote application—not unrelated browser UI—so
        // the streamed desktop fills the display like a native remote client.
        const root = document.querySelector('.app-container') || document.documentElement;

        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                const request = root.requestFullscreen || root.webkitRequestFullscreen;
                if (request) await request.call(root);
            } else {
                const exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) await exit.call(document);
            }
        } catch (error) {
            console.warn('Fullscreen request failed:', error);
        }
    };

    useEffect(() => {
        const syncFullscreenState = () => {
            const fullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
            setIsFullscreen(fullscreen);
            // Keep controls immediately reachable after entering or leaving.
            setIsVisible(true);
            window.clearTimeout(window.__cloudGameToolbarTimer);
            if (fullscreen) {
                window.__cloudGameToolbarTimer = window.setTimeout(() => setIsVisible(false), 3000);
            }
        };

        const revealAtTopEdge = (event) => {
            if ((document.fullscreenElement || document.webkitFullscreenElement) && event.clientY <= 72) revealToolbar();
        };

        // It starts visible, so only arm the initial auto-hide timer here.
        // Avoid a synchronous state update while mounting the effect.
        window.clearTimeout(window.__cloudGameToolbarTimer);
        window.__cloudGameToolbarTimer = window.setTimeout(() => {
            setIsVisible(false);
        }, 3000);
        document.addEventListener('pointerdown', revealToolbar, { passive: true });
        document.addEventListener('pointermove', revealAtTopEdge, { passive: true });
        document.addEventListener('fullscreenchange', syncFullscreenState);
        document.addEventListener('webkitfullscreenchange', syncFullscreenState);

        return () => {
            window.clearTimeout(window.__cloudGameToolbarTimer);
            document.removeEventListener('pointerdown', revealToolbar);
            document.removeEventListener('pointermove', revealAtTopEdge);
            document.removeEventListener('fullscreenchange', syncFullscreenState);
            document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
        };
    }, []);

    return (
        <div className={`edge-toolbar ${isVisible ? 'visible' : 'hidden'}`}>
            <div className="remote-session-brand" aria-label="CloudKH Remote">
                <span className="remote-session-mark" aria-hidden="true">▣</span>
                <span>CloudKH Remote</span>
            </div>

            <div className="edge-toolbar-divider" />

            <div className="edge-toolbar-status" aria-label={`Remote control ${status}`}>
                <span className="toolbar-dot" style={{ backgroundColor: statusColor(status) }} />
                <span>{status === 'connected' ? 'Connected' : status === 'error' ? 'Reconnecting' : 'Connecting'}</span>
            </div>

            <div className="edge-toolbar-divider" />

            <IconButton label="Remote controls" onClick={onToggleMenu}>
                <span aria-hidden="true">⌘</span>
            </IconButton>

            <IconButton label="Settings" onClick={() => onNavigate('settings')}>
                <SettingsIcon size={16} />
            </IconButton>

            <IconButton label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
                <span aria-hidden="true">{isFullscreen ? '↙' : '⛶'}</span>
            </IconButton>
        </div>
    );
};

export default NavigationDock;
