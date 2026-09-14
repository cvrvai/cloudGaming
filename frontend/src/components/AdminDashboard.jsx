import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [adminTab, setAdminTab] = useState('games'); // 'games' | 'machines' | 'bookings'
  
  const [machines, setMachines] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  // New game modal state
  const [showGameModal, setShowGameModal] = useState(false);
  const [editingGame, setEditingGame] = useState(null);
  const [gameTitle, setGameTitle] = useState('');
  const [gameGenre, setGameGenre] = useState('Action');
  const [gameCover, setGameCover] = useState('');
  const [gameExe, setGameExe] = useState('');
  const [gameSize, setGameSize] = useState(50);
  const [gameDesc, setGameDesc] = useState('');
  const [gameInstalledRigs, setGameInstalledRigs] = useState('all');
  const [gameSubmitting, setGameSubmitting] = useState(false);
  const [gameError, setGameError] = useState(null);

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
      if (gRes.ok) setGames(await gRes.json());
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

  const openAddGameModal = () => {
    setEditingGame(null);
    setGameTitle('');
    setGameGenre('Action RPG');
    setGameCover('https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80');
    setGameExe('C:\\Games\\GameName\\game.exe');
    setGameSize(60);
    setGameDesc('');
    setGameInstalledRigs('all');
    setGameError(null);
    setShowGameModal(true);
  };

  const openEditGameModal = (game) => {
    setEditingGame(game);
    setGameTitle(game.title);
    setGameGenre(game.genre);
    setGameCover(game.cover_url || '');
    setGameExe(game.exe_path || '');
    setGameSize(game.size_gb || 50);
    setGameDesc(game.description || '');
    setGameInstalledRigs(game.installed_machines || 'all');
    setGameError(null);
    setShowGameModal(true);
  };

  const handleSaveGame = async (e) => {
    e.preventDefault();
    setGameError(null);
    setGameSubmitting(true);

    const payload = {
      title: gameTitle,
      genre: gameGenre,
      cover_url: gameCover,
      description: gameDesc,
      exe_path: gameExe,
      size_gb: parseFloat(gameSize) || 50,
      installed_machines: gameInstalledRigs,
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
    if (!window.confirm('Delete this game from the platform library?')) return;
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
            Monitor gaming nodes, configure installed games, and oversee platform reservations.
          </p>
        </div>
        <button className="btn-secondary" onClick={fetchAllAdminData}>
          🔄 Refresh
        </button>
      </div>

      {/* Admin KPI Stats */}
      <div className="admin-stats-row">
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Gaming Rigs</span>
          <span className="stat-value">{machines.length}</span>
          <span className="stat-hint">{machines.filter((m) => m.status === 'available').length} Online</span>
        </div>
        <div className="admin-stat-card glass-panel">
          <span className="stat-label">Game Library</span>
          <span className="stat-value">{games.length}</span>
          <span className="stat-hint">Installed Titles</span>
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
          className={`admin-subnav-btn ${adminTab === 'games' ? 'active' : ''}`}
          onClick={() => setAdminTab('games')}
        >
          🎮 Game Library ({games.length})
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'machines' ? 'active' : ''}`}
          onClick={() => setAdminTab('machines')}
        >
          🖥️ Machine Nodes ({machines.length})
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setAdminTab('bookings')}
        >
          📋 Reservations ({bookings.length})
        </button>
      </div>

      {loading ? (
        <div className="admin-loading">Loading management data...</div>
      ) : (
        <>
          {/* TAB 1: GAME LIBRARY ("PUT GAME") */}
          {adminTab === 'games' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <div>
                  <h2>Installed Games Library</h2>
                  <p>Manage games available on host workstations and remote rigs.</p>
                </div>
                <button className="btn-primary btn-add-game" onClick={openAddGameModal}>
                  ➕ Put / Add Game
                </button>
              </div>

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
                      
                      <div className="game-exe-box">
                        <span className="exe-label">Launch Target:</span>
                        <code className="exe-path">{g.exe_path || 'Standard Launcher'}</code>
                      </div>

                      <div className="game-installed-on">
                        <span>Installed on: <strong>{g.installed_machines === 'all' ? 'All Gaming Rigs' : `Rig #${g.installed_machines}`}</strong></span>
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
            </div>
          )}

          {/* TAB 2: MACHINE NODES */}
          {adminTab === 'machines' && (
            <div className="admin-tab-content">
              <div className="tab-section-header">
                <div>
                  <h2>Connected Machine Nodes</h2>
                  <p>Real-time hardware status and maintenance controls for gaming workstations.</p>
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
                      <div><strong>Notes:</strong> {m.notes || 'Ready for game streaming.'}</div>
                    </div>

                    <div className="admin-node-actions">
                      <button
                        className={`btn-toggle-maintenance ${m.status === 'maintenance' ? 'restore' : ''}`}
                        onClick={() => handleToggleMaintenance(m)}
                        disabled={updatingId === m.id}
                      >
                        {updatingId === m.id
                          ? 'Updating...'
                          : m.status === 'maintenance'
                          ? '✓ Restore to Available'
                          : '⚠️ Put Under Maintenance'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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

      {/* Put / Edit Game Modal */}
      {showGameModal && (
        <div className="modal-backdrop" onClick={() => setShowGameModal(false)}>
          <div className="modal-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowGameModal(false)}>
              ✕
            </button>

            <div className="auth-header">
              <h2>{editingGame ? 'Edit Game' : 'Put New Game in Library'}</h2>
              <p className="auth-subtitle">Configure game shortcut and rig availability.</p>
            </div>

            {gameError && <div className="auth-error-banner">⚠️ {gameError}</div>}

            <form onSubmit={handleSaveGame} className="auth-form">
              <div className="form-group">
                <label>Game Title</label>
                <input
                  type="text"
                  placeholder="e.g. Cyberpunk 2077, GTA V, CS2"
                  value={gameTitle}
                  onChange={(e) => setGameTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Genre / Category</label>
                <input
                  type="text"
                  placeholder="e.g. Action RPG, Tactical FPS, Open World"
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

              <div className="form-group">
                <label>Executable Path / Launch Target</label>
                <input
                  type="text"
                  placeholder="C:\Games\GameName\game.exe or steam://rungameid/..."
                  value={gameExe}
                  onChange={(e) => setGameExe(e.target.value)}
                />
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Install Size (GB)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={gameSize}
                    onChange={(e) => setGameSize(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Install Availability</label>
                  <select
                    className="admin-select-input"
                    value={gameInstalledRigs}
                    onChange={(e) => setGameInstalledRigs(e.target.value)}
                  >
                    <option value="all">All Gaming Rigs</option>
                    {machines.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        Only {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  placeholder="Brief description of gameplay or performance specs"
                  value={gameDesc}
                  onChange={(e) => setGameDesc(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={gameSubmitting}
              >
                {gameSubmitting ? 'Saving...' : editingGame ? 'Update Game' : 'Add Game to Platform'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
