import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import {
  RefreshIcon,
  MonitorIcon,
  GamepadIcon,
  ClipboardListIcon,
  PlusIcon,
  EditIcon,
  TrashIcon,
  XIcon,
  AlertTriangleIcon,
  CheckIcon,
  KeyIcon,
  ShieldCheckIcon,
  ServerIcon,
  CpuIcon,
  RamIcon,
} from './Icons';

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [adminTab, setAdminTab] = useState('machines'); // 'machines' | 'games' | 'bookings'
  
  const [machines, setMachines] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  // Keypair PC Pairing state (Google Authenticator MFA)
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairMode, setPairMode] = useState('generate'); // 'generate' | 'enter'
  const [pairTargetName, setPairTargetName] = useState('');
  const [generatedPairCode, setGeneratedPairCode] = useState(null);
  const [pairExpiresAt, setPairExpiresAt] = useState(null);
  const [pairCountdown, setPairCountdown] = useState(600);
  const [pairInputCode, setPairInputCode] = useState('');
  const [pairDetectedHw, setPairDetectedHw] = useState(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState(null);
  const [pairSuccess, setPairSuccess] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Catalog game modal state
  const [showGameModal, setShowGameModal] = useState(false);
  const [editingGame, setEditingGame] = useState(null);
  const [gameTitle, setGameTitle] = useState('');
  const [gameSlug, setGameSlug] = useState('');
  const [gameGenre, setGameGenre] = useState('Action');
  const [gameCover, setGameCover] = useState('');
  const [gameSize, setGameSize] = useState(50);
  const [gameDesc, setGameDesc] = useState('');
  const [gameEnabled, setGameEnabled] = useState(true);
  const [gameSubmitting, setGameSubmitting] = useState(false);
  const [gameError, setGameError] = useState(null);

  // Per-node game installation modal state (MVP Manual Admin Configuration)
  const [showNodeGameModal, setShowNodeGameModal] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [editingNodeGame, setEditingNodeGame] = useState(null);
  const [nodeGameId, setNodeGameId] = useState('');
  const [nodeGameExe, setNodeGameExe] = useState('');
  const [nodeGameWorkDir, setNodeGameWorkDir] = useState('');
  const [nodeGameArgs, setNodeGameArgs] = useState('');
  const [nodeGameStatus, setNodeGameStatus] = useState('ready');
  const [nodeGameEnabled, setNodeGameEnabled] = useState(true);
  const [nodeGameSubmitting, setNodeGameSubmitting] = useState(false);
  const [nodeGameError, setNodeGameError] = useState(null);

  const fetchAllAdminData = async () => {
    if (!token) return;
    try {
      const [mRes, bRes, gRes] = await Promise.all([
        fetch(`${API_BASE}/api/machines`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/bookings/admin/all`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/games`),
      ]);
      if (mRes.ok) setMachines(await mRes.json());
      if (bRes.ok) setBookings(await bRes.json());
      if (gRes.ok) {
        setGames(await gRes.json());
        window.dispatchEvent(new Event('cloudkh-games-updated'));
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllAdminData();
  }, [token]);

  const handleToggleMaintenance = async (machine) => {
    const nextStatus = machine.status === 'maintenance' ? 'available' : 'maintenance';
    setUpdatingId(machine.id);
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machine.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        fetchAllAdminData();
      }
    } catch (err) {
      alert('Error updating status: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteMachine = async (machineId, machineName) => {
    if (!window.confirm(`Delete gaming PC node "${machineName}"? This action cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machineId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to delete machine');
      }
    } catch (err) {
      alert('Delete error: ' + err.message);
    }
  };

  const handleAdminCancelBooking = async (bookingId) => {
    if (!window.confirm(`Cancel reservation #${bookingId}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAllAdminData();
      }
    } catch (err) {
      alert('Failed to cancel: ' + err.message);
    }
  };

  // --- CATALOG MODAL HANDLERS ---
  const openAddGameModal = () => {
    setEditingGame(null);
    setGameTitle('');
    setGameSlug('');
    setGameGenre('Action RPG');
    setGameCover('https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80');
    setGameSize(60);
    setGameDesc('');
    setGameEnabled(true);
    setGameError(null);
    setShowGameModal(true);
  };

  const openEditGameModal = (game) => {
    setEditingGame(game);
    setGameTitle(game.title);
    setGameSlug(game.slug || '');
    setGameGenre(game.genre);
    setGameCover(game.cover_url || '');
    setGameSize(game.size_gb || 50);
    setGameDesc(game.description || '');
    setGameEnabled(game.enabled !== false);
    setGameError(null);
    setShowGameModal(true);
  };

  const handleSaveGame = async (e) => {
    e.preventDefault();
    setGameError(null);
    setGameSubmitting(true);

    const payload = {
      title: gameTitle,
      slug: gameSlug || undefined,
      genre: gameGenre,
      cover_url: gameCover,
      description: gameDesc,
      size_gb: parseFloat(gameSize) || 50,
      enabled: gameEnabled,
    };

    try {
      const url = editingGame
        ? `${API_BASE}/api/games/${editingGame.id}`
        : `${API_BASE}/api/games`;
      const method = editingGame ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to save game');
      }

      setShowGameModal(false);
      fetchAllAdminData();
    } catch (err) {
      setGameError(err.message);
    } finally {
      setGameSubmitting(false);
    }
  };

  const handleDeleteGame = async (gameId) => {
    if (!window.confirm('Delete this game from the platform catalog? This will remove its installations across all gaming PCs.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/games/${gameId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const errData = await res.json();
        alert(errData.detail || 'Failed to delete game');
      }
    } catch (err) {
      alert('Delete error: ' + err.message);
    }
  };

  // --- PER-NODE GAME CONFIGURATION HANDLERS ---
  const openAddGameToNodeModal = (machine) => {
    setSelectedNode(machine);
    setEditingNodeGame(null);
    setNodeGameId(games[0]?.id ? String(games[0].id) : '');
    setNodeGameExe('');
    setNodeGameWorkDir('');
    setNodeGameArgs('');
    setNodeGameStatus('ready');
    setNodeGameEnabled(true);
    setNodeGameError(null);
    setShowNodeGameModal(true);
  };

  const openEditNodeGameModal = (machine, nodeGame) => {
    setSelectedNode(machine);
    setEditingNodeGame(nodeGame);
    setNodeGameId(String(nodeGame.game_id));
    setNodeGameExe(nodeGame.executable_path || '');
    setNodeGameWorkDir(nodeGame.working_directory || '');
    setNodeGameArgs(nodeGame.launch_arguments || '');
    setNodeGameStatus(nodeGame.status || 'ready');
    setNodeGameEnabled(nodeGame.enabled !== false);
    setNodeGameError(null);
    setShowNodeGameModal(true);
  };

  const handleSaveNodeGame = async (e) => {
    e.preventDefault();
    if (!selectedNode) return;
    setNodeGameError(null);
    setNodeGameSubmitting(true);

    const payload = {
      game_id: parseInt(nodeGameId),
      executable_path: nodeGameExe.trim(),
      working_directory: nodeGameWorkDir.trim() || undefined,
      launch_arguments: nodeGameArgs.trim() || undefined,
      status: nodeGameStatus,
      enabled: nodeGameEnabled,
    };

    try {
      const res = await fetch(`${API_BASE}/api/machines/${selectedNode.id}/games`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to configure game on PC');
      }

      setShowNodeGameModal(false);
      fetchAllAdminData();
    } catch (err) {
      setNodeGameError(err.message);
    } finally {
      setNodeGameSubmitting(false);
    }
  };

  const handleRemoveNodeGame = async (machineId, gameId, gameTitle) => {
    if (!window.confirm(`Unassign "${gameTitle}" from this gaming PC?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machineId}/games/${gameId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const errData = await res.json();
        alert(errData.detail || 'Failed to remove game from machine');
      }
    } catch (err) {
      alert('Unassign error: ' + err.message);
    }
  };

  // --- KEYPAIR PC PAIRING HANDLERS (Admin Google Authenticator MFA) ---
  const openPairModal = async () => {
    setShowPairModal(true);
    setPairMode('generate');
    setPairTargetName('');
    setGeneratedPairCode(null);
    setPairInputCode('');
    setPairError(null);
    setPairSuccess(null);
    setCopiedCode(false);

    try {
      const res = await fetch(`${API_BASE}/api/machines/hardware/detect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const hw = await res.json();
        setPairDetectedHw(hw);
        setPairTargetName(hw.name || 'Gaming Rig Node');
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!generatedPairCode || pairCountdown <= 0) return;
    const timer = setInterval(() => {
      setPairCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [generatedPairCode, pairCountdown]);

  // Real-time polling for generated keypair status
  useEffect(() => {
    if (!generatedPairCode || !showPairModal || pairSuccess) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/machines/pair/status/${generatedPairCode}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'paired') {
            setPairSuccess(`Gaming PC '${data.machine_name || 'Rig'}' paired successfully!`);
            fetchAllAdminData();
            setTimeout(() => {
              setShowPairModal(false);
              setPairSuccess(null);
              setGeneratedPairCode(null);
            }, 2500);
          }
        }
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(pollInterval);
  }, [generatedPairCode, showPairModal, pairSuccess]);

  const handleGeneratePairCode = async () => {
    setPairLoading(true);
    setPairError(null);
    try {
      const res = await fetch(`${API_BASE}/api/machines/pair/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target_name: pairTargetName.trim() || 'Gaming Rig Node' }),
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedPairCode(data.code);
        setPairExpiresAt(data.expires_at);
        setPairCountdown(data.expires_in_seconds || 600);
      } else {
        setPairError(data.detail || 'Failed to generate pairing code');
      }
    } catch (err) {
      setPairError(err.message);
    } finally {
      setPairLoading(false);
    }
  };

  const handleCompletePairing = async (e) => {
    e.preventDefault();
    if (!pairInputCode.trim()) return;
    setPairLoading(true);
    setPairError(null);
    try {
      const res = await fetch(`${API_BASE}/api/machines/pair/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: pairInputCode.trim(),
          name: pairTargetName.trim() || pairDetectedHw?.name,
          gpu: pairDetectedHw?.gpu,
          cpu: pairDetectedHw?.cpu,
          ram: pairDetectedHw?.ram,
          os: pairDetectedHw?.os,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPairSuccess(`Paired '${data.machine.name}' successfully!`);
        fetchAllAdminData();
        setTimeout(() => {
          setShowPairModal(false);
          setPairSuccess(null);
          setPairInputCode('');
        }, 2000);
      } else {
        setPairError(data.detail || 'Pairing failed. Check code.');
      }
    } catch (err) {
      setPairError(err.message);
    } finally {
      setPairLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!generatedPairCode) return;
    navigator.clipboard.writeText(generatedPairCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (user?.role !== 'admin') {
    return (
      <div className="bookings-unauth-container glass-panel">
        <h2>Access Denied</h2>
        <p>Administrator credentials required to view the management console.</p>
      </div>
    );
  }
  const activeSessionsCount = bookings.filter((b) => {
    const nowIso = new Date().toISOString();
    return b.status === 'confirmed' && b.start_time <= nowIso && nowIso <= b.end_time;
  }).length;

  const formatRam = (ram) => {
    if (!ram) return '16 GB';
    return ram.replace(/\s*\(.*?\)/g, '').trim();
  };

  const formatCpu = (cpu) => {
    if (!cpu) return 'CPU';
    return cpu.replace(/\([RTM]+\)/gi, '').replace(/\s+CPU\s+/i, ' ').replace(/\s+/g, ' ').trim();
  };

  const formatOs = (m) => {
    if (m.os) return m.os.replace(/Microsoft\s+/i, '');
    const match = m.ram?.match(/\((.*?)\)/);
    if (match) return match[1].replace(/Microsoft\s+/i, '');
    return 'Windows 11';
  };

  return (
    <div className="admin-dashboard-container">
      {/* Top Overview & Action Toolbar */}
      <div className="admin-header-clean">
        <div>
          <div className="pairing-mfa-badge">
            <ShieldCheckIcon size={12} />
            <span>MFA Verified</span>
          </div>
          <h1 className="admin-title">Admin Console</h1>
        </div>
        <div className="admin-header-actions">
          <button className="btn-pair-pc-header" onClick={openPairModal}>
            <KeyIcon size={14} />
            <span>+ Pair PC</span>
          </button>
          <button className="btn-secondary" onClick={fetchAllAdminData} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <RefreshIcon size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Modern Bento Stats Grid */}
      <div className="admin-bento-grid">
        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Fleet Rigs</span>
            <div className="bento-icon-box"><ServerIcon size={16} /></div>
          </div>
          <div className="bento-value">
            {machines.filter((m) => m.status === 'available').length}
            <span className="bento-subval">/{machines.length}</span>
          </div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Catalog Games</span>
            <div className="bento-icon-box"><GamepadIcon size={16} /></div>
          </div>
          <div className="bento-value">{games.length}</div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Live Streams</span>
            <div className="bento-icon-box"><MonitorIcon size={16} /></div>
          </div>
          <div className={`bento-value ${activeSessionsCount > 0 ? 'highlight-green' : ''}`}>
            {activeSessionsCount}
          </div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Reservations</span>
            <div className="bento-icon-box"><ClipboardListIcon size={16} /></div>
          </div>
          <div className="bento-value">{bookings.length}</div>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="admin-subnav-tabs">
        <button
          className={`admin-subnav-btn ${adminTab === 'machines' ? 'active' : ''}`}
          onClick={() => setAdminTab('machines')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <MonitorIcon size={16} />
          <span>Gaming PCs ({machines.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'games' ? 'active' : ''}`}
          onClick={() => setAdminTab('games')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <GamepadIcon size={16} />
          <span>Game Catalog ({games.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setAdminTab('bookings')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <ClipboardListIcon size={16} />
          <span>Reservations ({bookings.length})</span>
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading management data...</div>
      ) : (
        <>
          {/* TAB 1: GAMING PCS GRID & PER-PC INSTALLED GAMES */}
          {adminTab === 'machines' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <h2>Connected Gaming PCs</h2>
              </div>

              <div className="admin-pcs-grid">
                {machines.map((m) => (
                  <div
                    key={m.id}
                    className={`admin-pc-node-card glass-panel ${m.is_host === 1 ? 'host-card' : ''}`}
                  >
                    <div className="pc-card-header">
                      <span className={`pc-role-badge ${m.is_host === 1 ? 'host' : 'remote'}`}>
                        {m.is_host === 1 ? 'Host Workstation' : `Node #${m.id}`}
                      </span>
                      <span className={`pc-status-pill ${m.status}`}>
                        <span className="pulse-dot" />
                        <span>{m.status.toUpperCase()}</span>
                      </span>
                    </div>

                    <h3 className="pc-name-title">
                      <MonitorIcon size={18} style={{ opacity: 0.8 }} />
                      <span>{m.name}</span>
                    </h3>

                    {/* 2x2 Hardware Specs Matrix */}
                    <div className="spec-chips-grid">
                      <div className="spec-chip">
                        <span className="spec-chip-label"><GamepadIcon size={10} /> GPU</span>
                        <span className="spec-chip-val" title={m.gpu}>{m.gpu}</span>
                      </div>
                      <div className="spec-chip">
                        <span className="spec-chip-label"><CpuIcon size={10} /> CPU</span>
                        <span className="spec-chip-val" title={m.cpu}>{formatCpu(m.cpu)}</span>
                      </div>
                      <div className="spec-chip">
                        <span className="spec-chip-label"><RamIcon size={10} /> RAM</span>
                        <span className="spec-chip-val" title={m.ram}>{formatRam(m.ram)}</span>
                      </div>
                      <div className="spec-chip">
                        <span className="spec-chip-label"><MonitorIcon size={10} /> OS</span>
                        <span className="spec-chip-val" title={formatOs(m)}>{formatOs(m)}</span>
                      </div>
                    </div>

                    {/* Installed Games Section */}
                    <div className="node-games-section">
                      <div className="node-games-header">
                        <span className="node-games-title">
                          Installed Games <span className="node-games-count">{m.installed_games?.length || 0}</span>
                        </span>
                        <button
                          className="btn-add-node-game"
                          onClick={() => openAddGameToNodeModal(m)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          <PlusIcon size={12} />
                          <span>Add Game</span>
                        </button>
                      </div>

                      {m.installed_games && m.installed_games.length > 0 && (
                        <div className="node-games-list">
                          {m.installed_games.map((ng) => (
                            <div key={ng.id} className="node-game-card">
                              <div className="node-game-top">
                                <div className="node-game-title-row">
                                  <span className="node-game-title">{ng.title}</span>
                                  <span className={`status-pill-mini ${ng.status || 'ready'}`}>
                                    {ng.status || 'ready'}
                                  </span>
                                </div>
                                <div className="node-game-actions">
                                  <button
                                    className="btn-node-game-action"
                                    onClick={() => openEditNodeGameModal(m, ng)}
                                    title="Edit configuration"
                                  >
                                    <EditIcon size={12} />
                                  </button>
                                  <button
                                    className="btn-node-game-action delete"
                                    onClick={() => handleRemoveNodeGame(m.id, ng.game_id, ng.title)}
                                    title="Unassign game"
                                  >
                                    <XIcon size={12} />
                                  </button>
                                </div>
                              </div>

                              <div className="node-game-path-box">
                                <div className="node-game-path-line">
                                  <span className="node-game-path-label">Path:</span>
                                  <span className="node-game-path-val" title={ng.executable_path}>
                                    {ng.executable_path}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: 'auto', paddingTop: '12px' }}>
                      <button
                        style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        className={`btn-toggle-maintenance ${m.status === 'maintenance' ? 'restore' : ''}`}
                        onClick={() => handleToggleMaintenance(m)}
                        disabled={updatingId === m.id}
                      >
                        {updatingId === m.id ? (
                          'Updating...'
                        ) : m.status === 'maintenance' ? (
                          <>
                            <CheckIcon size={14} />
                            <span>Restore Available</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangleIcon size={14} />
                            <span>Maintenance Mode</span>
                          </>
                        )}
                      </button>
                      {m.is_host !== 1 && (
                        <button
                          className="btn-game-delete"
                          style={{ padding: '0 16px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          onClick={() => handleDeleteMachine(m.id, m.name)}
                          title="Delete this gaming PC node"
                        >
                          <TrashIcon size={13} />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Direct Pair PC Card Tile */}
                <div className="pc-add-tile" onClick={openPairModal}>
                  <div className="pc-add-icon-circle">
                    <KeyIcon size={20} />
                  </div>
                  <div className="pc-add-title">+ Pair PC</div>
                  <span className="pc-add-badge">MFA Keypair</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GAME CATALOG */}
          {adminTab === 'games' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <h2>Game Catalog</h2>
                <button className="btn-primary btn-add-game" onClick={openAddGameModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <PlusIcon size={14} />
                  <span>Add Game</span>
                </button>
              </div>

              {games.length === 0 ? (
                <div className="empty-bookings-box glass-panel">
                  <p style={{ margin: '0 0 12px 0' }}>No catalog games.</p>
                  <button className="btn-primary" onClick={openAddGameModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <PlusIcon size={14} />
                    <span>Add Game</span>
                  </button>
                </div>
              ) : (
                <div className="admin-games-grid">
                  {games.map((g) => (
                  <div key={g.id} className="admin-game-card glass-panel">
                    <div
                      className="game-cover-banner"
                      style={{ backgroundImage: `url(${g.cover_url})` }}
                    >
                      <span className="game-genre-pill">{g.genre}</span>
                      <span className="game-size-pill">{g.size_gb} GB</span>
                    </div>

                    <div className="game-card-info">
                      <h3 className="game-card-title">{g.title}</h3>
                      <p className="game-card-desc">{g.description || 'No description provided.'}</p>
                      
                      <div className="game-installed-on">
                        <span>Installed on: <strong>{g.installed_machines}</strong></span>
                      </div>

                      <div className="game-actions-row">
                        <button
                          className="btn-game-edit"
                          onClick={() => openEditGameModal(g)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-game-delete"
                          onClick={() => handleDeleteGame(g.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

          {/* TAB 3: RESERVATIONS */}
          {adminTab === 'bookings' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <h2>Reservations</h2>
              </div>

              <div className="admin-bookings-table-wrapper glass-panel">
                <table className="admin-bookings-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Email</th>
                      <th>Rig</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id}>
                        <td>#{b.id}</td>
                        <td><strong>{b.user_name}</strong></td>
                        <td>{b.user_email}</td>
                        <td>{b.machine_name}</td>
                        <td>{new Date(b.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>{new Date(b.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>
                          <span className={`status-pill-small ${b.status}`}>
                            {b.status}
                          </span>
                        </td>
                        <td>
                          {b.status === 'confirmed' && (
                            <button
                              className="btn-admin-cancel"
                              onClick={() => handleAdminCancelBooking(b.id)}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL 1: CONFIGURE GAME ON SPECIFIC PC (Admin → Gaming PCs → PC-001 → Games → Add Game) */}
      {showNodeGameModal && selectedNode && (
        <div className="modal-backdrop" onClick={() => setShowNodeGameModal(false)}>
          <div className="modal-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowNodeGameModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <h2>{editingNodeGame ? 'Edit Game' : 'Add Game to PC'}</h2>
            </div>

            {nodeGameError && (
              <div className="auth-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangleIcon size={16} />
                <span>{nodeGameError}</span>
              </div>
            )}

            <form onSubmit={handleSaveNodeGame} className="auth-form">
              <div className="form-group">
                <label>Game</label>
                <select
                  className="admin-select-input"
                  value={nodeGameId}
                  onChange={(e) => setNodeGameId(e.target.value)}
                  required
                >
                  <option value="" disabled>Select a catalog game...</option>
                  {games.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.title} ({g.genre})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Executable Path</label>
                <input
                  type="text"
                  placeholder="e.g. C:\Program Files\GameFolder\game.exe"
                  value={nodeGameExe}
                  onChange={(e) => setNodeGameExe(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Working Directory</label>
                <input
                  type="text"
                  placeholder="e.g. C:\Program Files\GameFolder"
                  value={nodeGameWorkDir}
                  onChange={(e) => setNodeGameWorkDir(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Launch Arguments</label>
                <input
                  type="text"
                  placeholder="e.g. -fullscreen -novid (optional)"
                  value={nodeGameArgs}
                  onChange={(e) => setNodeGameArgs(e.target.value)}
                />
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="admin-select-input"
                    value={nodeGameStatus}
                    onChange={(e) => setNodeGameStatus(e.target.value)}
                  >
                    <option value="ready">Ready</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="disabled">Disabled</option>
                    <option value="broken">Broken</option>
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '12px' }}>
                    <input
                      type="checkbox"
                      checked={nodeGameEnabled}
                      onChange={(e) => setNodeGameEnabled(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#6366f1' }}
                    />
                    <span>Enabled</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={nodeGameSubmitting}
              >
                {nodeGameSubmitting ? 'Saving...' : 'Save'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CENTRAL CATALOG GAME MODAL */}
      {showGameModal && (
        <div className="modal-backdrop" onClick={() => setShowGameModal(false)}>
          <div className="modal-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowGameModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <h2>{editingGame ? 'Edit Game' : 'Add Game'}</h2>
            </div>

            {gameError && (
              <div className="auth-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangleIcon size={16} />
                <span>{gameError}</span>
              </div>
            )}

            <form onSubmit={handleSaveGame} className="auth-form">
              <div className="form-group">
                <label>Game Title</label>
                <input
                  type="text"
                  placeholder="Enter game title"
                  value={gameTitle}
                  onChange={(e) => setGameTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Slug / Identifier</label>
                <input
                  type="text"
                  placeholder="e.g. game-slug (optional, auto-generated if empty)"
                  value={gameSlug}
                  onChange={(e) => setGameSlug(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Genre / Category</label>
                <input
                  type="text"
                  placeholder="e.g. Racing, Action RPG, Tactical FPS"
                  value={gameGenre}
                  onChange={(e) => setGameGenre(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Cover Artwork URL</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={gameCover}
                  onChange={(e) => setGameCover(e.target.value)}
                />
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Approx Size (GB)</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={gameSize}
                    onChange={(e) => setGameSize(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '12px' }}>
                    <input
                      type="checkbox"
                      checked={gameEnabled}
                      onChange={(e) => setGameEnabled(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#6366f1' }}
                    />
                    <span>Enabled in Catalog</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  placeholder="Brief synopsis of gameplay or specs"
                  value={gameDesc}
                  onChange={(e) => setGameDesc(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={gameSubmitting}
              >
                {gameSubmitting ? 'Saving...' : editingGame ? 'Update Game' : 'Save to Catalog'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: PAIR NEW GAMING PC (Google Authenticator 2-Step Keypair Workflow) */}
      {showPairModal && (
        <div className="modal-backdrop" onClick={() => setShowPairModal(false)}>
          <div className="modal-dialog glass-panel pairing-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowPairModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="pairing-modal-header">
              <div className="pairing-mfa-badge">
                <ShieldCheckIcon size={12} />
                <span>MFA Verified</span>
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: '#fff' }}>
                Pair Gaming PC
              </h2>
            </div>

            {/* Mode Tabs */}
            <div className="pairing-tabs-row">
              <button
                type="button"
                className={`pairing-tab-btn ${pairMode === 'generate' ? 'active' : ''}`}
                onClick={() => {
                  setPairMode('generate');
                  setPairError(null);
                  setPairSuccess(null);
                }}
              >
                Generate Code
              </button>
              <button
                type="button"
                className={`pairing-tab-btn ${pairMode === 'enter' ? 'active' : ''}`}
                onClick={() => {
                  setPairMode('enter');
                  setPairError(null);
                  setPairSuccess(null);
                }}
              >
                Enter Code
              </button>
            </div>

            <div className="pairing-modal-body">
              {pairError && (
                <div className="auth-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <AlertTriangleIcon size={16} />
                  <span>{pairError}</span>
                </div>
              )}

              {pairSuccess && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(48, 209, 88, 0.15)', border: '1px solid rgba(48, 209, 88, 0.4)', color: '#30d158', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
                  <CheckIcon size={15} />
                  <span>{pairSuccess}</span>
                </div>
              )}

              {pairMode === 'generate' ? (
                <div>
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary, #a1a1aa)', display: 'block', marginBottom: '5px' }}>
                      PC Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Workstation 02"
                      value={pairTargetName}
                      onChange={(e) => setPairTargetName(e.target.value)}
                      disabled={pairLoading || !!generatedPairCode}
                      style={{ width: '100%', padding: '9px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '13px' }}
                    />
                  </div>

                  {!generatedPairCode ? (
                    <button
                      type="button"
                      className="btn-primary auth-submit-btn"
                      onClick={handleGeneratePairCode}
                      disabled={pairLoading}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '10px 16px' }}
                    >
                      <KeyIcon size={14} />
                      <span>{pairLoading ? 'Generating...' : 'Generate Code'}</span>
                    </button>
                  ) : (
                    <div>
                      <div className="pairing-code-box">
                        <div className="pairing-code-display">
                          {generatedPairCode}
                        </div>
                        <div className="pairing-countdown">
                          <span>Expires in {Math.floor(pairCountdown / 60)}:{(pairCountdown % 60).toString().padStart(2, '0')}</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleCopyCode}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 12px' }}
                        >
                          <CheckIcon size={13} />
                          <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleGeneratePairCode}
                          disabled={pairLoading}
                          style={{ flex: 1, padding: '8px 12px' }}
                        >
                          New Code
                        </button>
                      </div>

                      <div className="pairing-poll-radar">
                        <span className="spinner-geforce" style={{ width: '11px', height: '11px', borderWidth: '2px' }} />
                        <span>Waiting for PC...</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleCompletePairing}>
                  {pairDetectedHw && (
                    <div className="detected-specs-pill-bar">
                      <span className="detected-pill" title={pairDetectedHw.gpu}><GamepadIcon size={11} /> {pairDetectedHw.gpu}</span>
                      <span className="detected-pill" title={pairDetectedHw.cpu}><CpuIcon size={11} /> {pairDetectedHw.cpu}</span>
                      <span className="detected-pill" title={pairDetectedHw.ram}><RamIcon size={11} /> {pairDetectedHw.ram}</span>
                    </div>
                  )}

                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary, #a1a1aa)', display: 'block', marginBottom: '5px' }}>
                      Pairing Code
                    </label>
                    <input
                      type="text"
                      placeholder="000-000"
                      value={pairInputCode}
                      onChange={(e) => setPairInputCode(e.target.value)}
                      required
                      style={{ width: '100%', padding: '10px 12px', background: 'rgba(0,0,0,0.4)', border: '2px solid rgba(0, 210, 255, 0.4)', borderRadius: '10px', color: '#00d2ff', fontSize: '20px', fontWeight: 800, letterSpacing: '4px', textAlign: 'center' }}
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary, #a1a1aa)', display: 'block', marginBottom: '5px' }}>
                      PC Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Host PC 2"
                      value={pairTargetName}
                      onChange={(e) => setPairTargetName(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '13px' }}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-primary auth-submit-btn"
                    disabled={pairLoading || !pairInputCode.trim()}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '10px 16px' }}
                  >
                    <KeyIcon size={14} />
                    <span>{pairLoading ? 'Pairing...' : 'Pair PC'}</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
