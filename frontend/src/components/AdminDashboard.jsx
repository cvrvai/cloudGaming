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
} from './Icons';

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [adminTab, setAdminTab] = useState('machines'); // 'machines' | 'games' | 'bookings'
  
  const [machines, setMachines] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

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

  return (
    <div className="admin-dashboard-container">
      {/* Top Overview & Sub-Tabs */}
      <div className="admin-header-clean">
        <div>
          <h1 className="admin-title">Admin Management Console</h1>
          <p className="admin-subtitle">
            Configure gaming PCs, manage installed game executables, and oversee platform sessions.
          </p>
        </div>
        <button className="btn-secondary" onClick={fetchAllAdminData} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <RefreshIcon size={14} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Admin KPI Stats */}
      <div className="admin-stats-row">
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Gaming PCs</span>
          <span className="stat-value">{machines.length}</span>
          <span className="stat-hint">{machines.filter((m) => m.status === 'available').length} Online</span>
        </div>
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Game Catalog</span>
          <span className="stat-value">{games.length}</span>
          <span className="stat-hint">Active Titles</span>
        </div>
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Active Sessions</span>
          <span className="stat-value active-val">{activeSessionsCount}</span>
          <span className="stat-hint">Live Now</span>
        </div>
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Total Bookings</span>
          <span className="stat-value">{bookings.length}</span>
          <span className="stat-hint">Recorded</span>
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
          {/* TAB 1: GAMING PCS & PER-PC INSTALLED GAMES (MVP Manual Admin Setup) */}
          {adminTab === 'machines' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <div>
                  <h2>Connected Gaming PCs</h2>
                  <p>Configure hardware nodes and manually define installed games, executables, and working directories.</p>
                </div>
              </div>

              <div className="admin-machines-grid">
                {machines.map((m) => (
                  <div
                    key={m.id}
                    className={`admin-node-card glass-panel ${m.is_host === 1 ? 'host-card' : ''}`}
                  >
                    <div className="admin-node-header">
                      <div>
                        {m.is_host === 1 && <span className="host-tag-pill">LOCAL HOST WORKSTATION</span>}
                        <h3>{m.name}</h3>
                      </div>
                      <span className={`status-tag ${m.status}`}>
                        {m.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="admin-node-specs">
                      <div><strong>GPU:</strong> {m.gpu}</div>
                      <div><strong>CPU:</strong> {m.cpu}</div>
                      <div><strong>RAM:</strong> {m.ram}</div>
                      <div><strong>Notes:</strong> {m.notes || 'Gaming workstation.'}</div>
                    </div>

                    {/* Installed Games on this PC (Manual Admin Configuration) */}
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

                      {!m.installed_games || m.installed_games.length === 0 ? (
                        <div className="node-games-empty">
                          No games configured on this PC yet. Click "+ Add Game" to assign one.
                        </div>
                      ) : (
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
                                {ng.working_directory && (
                                  <div className="node-game-path-line">
                                    <span className="node-game-path-label">Dir:</span>
                                    <span className="node-game-path-val" title={ng.working_directory}>
                                      {ng.working_directory}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
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
                            <span>Restore to Available</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangleIcon size={14} />
                            <span>Put Under Maintenance</span>
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
              </div>
            </div>
          )}

          {/* TAB 2: GAME CATALOG */}
          {adminTab === 'games' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <div>
                  <h2>Game Catalog</h2>
                  <p>Global catalog of titles available across the CloudKH platform.</p>
                </div>
                <button className="btn-primary btn-add-game" onClick={openAddGameModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <PlusIcon size={14} />
                  <span>Add Game to Catalog</span>
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
                <div>
                  <h2>All System Reservations</h2>
                  <p>Monitor scheduled sessions across all users with instant termination controls.</p>
                </div>
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
              <h2>{editingNodeGame ? 'Edit Game Configuration' : 'Add Game to PC'}</h2>
              <p className="auth-subtitle">
                Configure trusted executable and directory for <strong>{selectedNode.name}</strong>.
              </p>
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
              <h2>{editingGame ? 'Edit Catalog Game' : 'Add Game to Catalog'}</h2>
              <p className="auth-subtitle">Configure game metadata and artwork.</p>
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
    </div>
  );
}
