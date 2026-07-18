import { useEffect, useState } from 'react';
import { QUALITY_PRESETS } from '../quality';
import './SettingsPage.css';

// Keep these keys local to the settings surface. `QUALITY_PRESETS` has always
// been a stable export, which prevents a stale development-module cache from
// breaking the whole app during a Vite hot reload through the tunnel.
const REMOTE_QUALITY_PRESETS = {
    auto: { ...QUALITY_PRESETS.auto, label: 'Host default' },
    fast: { ...QUALITY_PRESETS.fast, label: 'Low bandwidth' },
    balanced: QUALITY_PRESETS.balanced,
    hd: QUALITY_PRESETS.hd,
};

const Slider = ({ label, value, min, max, onChange }) => (
    <label className="remote-settings-slider">
        <span><span>{label}</span><strong>{Math.round(value)}</strong></span>
        <input
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
        />
    </label>
);

const SettingsPage = ({
    apiBase, quality, setQuality, inputMode, setInputMode,
    mouseMode, setMouseMode,
    sensitivity, onSensitivityChange, onBack
}) => {
    const [info, setInfo] = useState(null);

    useEffect(() => {
        let cancelled = false;

        const fetchInfo = async () => {
            try {
                const response = await fetch(`${apiBase}/api/system/info`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (!cancelled) {
                    setInfo(data);
                }
            } catch {
                if (!cancelled) setInfo(null);
            }
        };

        fetchInfo();
        const timer = window.setInterval(fetchInfo, 5000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [apiBase]);

    // The public browser remote is intentionally limited to the dependable
    // presets below. Clear a legacy saved HD/Full HD choice on first load.
    useEffect(() => {
        if (!REMOTE_QUALITY_PRESETS[quality]) setQuality('auto');
    }, [quality, setQuality]);

    const isReady = Boolean(info?.gstreamer_available);
    const shortQualityLabels = { auto: 'Auto', fast: 'Low', balanced: 'Balanced', hd: 'Smooth' };

    return (
        <main className="remote-settings" aria-label="Remote session settings">
            <div className="remote-settings-shell">
                <header className="remote-settings-header">
                    <button type="button" className="remote-settings-back" onClick={onBack} aria-label="Return to remote desktop">
                        ←
                    </button>
                    <h1>Settings</h1>
                    <div
                        className={`remote-settings-state ${isReady ? 'ready' : 'checking'}`}
                        aria-label={isReady ? 'Host online' : 'Host unavailable'}
                        title={isReady ? 'Host online' : 'Host unavailable'}
                    >
                        <i />
                    </div>
                </header>

                <div className="remote-settings-grid">
                    <section className="remote-settings-card remote-settings-controls">
                        <div className="remote-settings-mode" role="group" aria-label="Control mode">
                            <button
                                type="button"
                                className={inputMode === 'touchpad' ? 'active' : ''}
                                onClick={() => setInputMode('touchpad')}
                            >
                                <strong>Desktop</strong>
                            </button>
                            <button
                                type="button"
                                className={inputMode === 'gamepad' ? 'active' : ''}
                                onClick={() => setInputMode('gamepad')}
                            >
                                <strong>Gamepad</strong>
                            </button>
                        </div>
                        {inputMode === 'touchpad' && (
                            <div className="remote-settings-mode remote-settings-pointer" role="group" aria-label="Mouse behavior">
                                <button
                                    type="button"
                                    className={mouseMode === 'absolute' ? 'active' : ''}
                                    onClick={() => setMouseMode('absolute')}
                                >
                                    <strong>Desktop cursor</strong>
                                </button>
                                <button
                                    type="button"
                                    className={mouseMode === 'relative' ? 'active' : ''}
                                    onClick={() => setMouseMode('relative')}
                                >
                                    <strong>Game mouse</strong>
                                </button>
                            </div>
                        )}
                        <Slider
                            label="Speed"
                            value={sensitivity}
                            min={1}
                            max={60}
                            onChange={onSensitivityChange}
                        />
                    </section>

                    <section className="remote-settings-card remote-settings-display">
                        <div className="remote-quality-list" role="group" aria-label="Video quality">
                            {Object.entries(REMOTE_QUALITY_PRESETS).map(([key, preset]) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={quality === key ? 'active' : ''}
                                    onClick={() => setQuality(key)}
                                    aria-label={`${preset.label} video quality`}
                                >
                                    <span>
                                        <strong>{shortQualityLabels[key]}</strong>
                                    </span>
                                    <i aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    </section>

                </div>
            </div>
        </main>
    );
};

export default SettingsPage;
