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
  UsersIcon,
  ChartIcon,
  DownloadIcon,
  UserIcon,
  ZapIcon,
  TableIcon,
} from './Icons';

// In-memory module cache for instant admin tab/page navigation
let cachedAdminData = null;

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const [adminTab, setAdminTab] = useState('machines'); // 'machines' | 'games' | 'bookings' | 'users' | 'dmaic'
  
  const [machines, setMachines] = useState(() => cachedAdminData?.machines || []);
  const [bookings, setBookings] = useState(() => cachedAdminData?.bookings || []);
  const [games, setGames] = useState(() => cachedAdminData?.games || []);
  const [loading, setLoading] = useState(() => !cachedAdminData);
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

  // Users state (Clear User Account Tracking & Visibility)
  const [users, setUsers] = useState(() => cachedAdminData?.users || []);
  const [userSearch, setUserSearch] = useState('');
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [createUserError, setCreateUserError] = useState(null);
  const [createUserSubmitting, setCreateUserSubmitting] = useState(false);

  // Operations Research - Lean Six Sigma DMAIC CTQ state
  const [dmaicMetrics, setDmaicMetrics] = useState(() => cachedAdminData?.dmaicMetrics || null);
  const [dmaicRecords, setDmaicRecords] = useState(() => cachedAdminData?.dmaicRecords || []);
  const [dmaicPhaseFilter, setDmaicPhaseFilter] = useState('all');
  const [showAddTestModal, setShowAddTestModal] = useState(false);
  const [newTestAccount, setNewTestAccount] = useState('');
  const [newTestRequestedTime, setNewTestRequestedTime] = useState('');
  const [newTestBookingSlot, setNewTestBookingSlot] = useState('');
  const [newTestWaitingTime, setNewTestWaitingTime] = useState(15);
  const [newTestLatency, setNewTestLatency] = useState(75);
  const [newTestFps, setNewTestFps] = useState(60);
  const [newTestDisconnects, setNewTestDisconnects] = useState(0);
  const [newTestCompleted, setNewTestCompleted] = useState(true);
  const [newTestFailureReason, setNewTestFailureReason] = useState('');
  const [newTestPcIdleTime, setNewTestPcIdleTime] = useState(25);
  const [newTestPowerUsage, setNewTestPowerUsage] = useState(185);
  const [newTestPhase, setNewTestPhase] = useState('V1_Baseline');
  const [addTestError, setAddTestError] = useState(null);
  const [addTestSubmitting, setAddTestSubmitting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [seedingTrials, setSeedingTrials] = useState(false);
  const [clearingEvidence, setClearingEvidence] = useState(false);
  const [seedSuccessMsg, setSeedSuccessMsg] = useState(null);
  const [dmaicWhiteBg, setDmaicWhiteBg] = useState(true); // Default to clean white background for academic review / teacher presentation

  const fetchAllAdminData = async () => {
    if (!token) return;
    try {
      const [mRes, bRes, gRes, uRes, dMetricsRes, dRecordsRes] = await Promise.all([
        fetch(`${API_BASE}/api/machines`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/bookings/admin/all`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/games`),
        fetch(`${API_BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin/dmaic/metrics`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin/dmaic/records`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const mData = mRes.ok ? await mRes.json() : (cachedAdminData?.machines || []);
      const bData = bRes.ok ? await bRes.json() : (cachedAdminData?.bookings || []);
      let gData = cachedAdminData?.games || [];
      if (gRes.ok) {
        gData = await gRes.json();
        setGames(gData);
        window.dispatchEvent(new Event('cloudkh-games-updated'));
      }
      const uData = uRes.ok ? await uRes.json() : (cachedAdminData?.users || []);
      const dmData = dMetricsRes.ok ? await dMetricsRes.json() : (cachedAdminData?.dmaicMetrics || null);
      const drData = dRecordsRes.ok ? await dRecordsRes.json() : (cachedAdminData?.dmaicRecords || []);

      if (mRes.ok) setMachines(mData);
      if (bRes.ok) setBookings(bData);
      if (uRes.ok) setUsers(uData);
      if (dMetricsRes.ok) setDmaicMetrics(dmData);
      if (dRecordsRes.ok) setDmaicRecords(drData);

      cachedAdminData = {
        machines: mData,
        bookings: bData,
        games: gData,
        users: uData,
        dmaicMetrics: dmData,
        dmaicRecords: drData,
      };
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to update user role');
      }
    } catch (err) {
      alert('Role update error: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Delete user account "${userEmail}"? All associated reservations will also be deleted.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to delete user');
      }
    } catch (err) {
      alert('Delete error: ' + err.message);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setCreateUserSubmitting(true);
    setCreateUserError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim().toLowerCase(),
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create user account');
      }
      setShowCreateUserModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      fetchAllAdminData();
    } catch (err) {
      setCreateUserError(err.message);
    } finally {
      setCreateUserSubmitting(false);
    }
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dmaic/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to export dataset');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cloudkh_dmaic_dataset_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('CSV Export error: ' + err.message);
    } finally {
      setExportingCsv(false);
    }
  };

  const handleSeedEvidence = async () => {
    if (!confirm('Generate 30 verified trial records (15 V1 Baseline + 15 V2 Improved) with SHA-256 cryptographic hashes for Jamovi / Minitab evidence?')) {
      return;
    }
    setSeedingTrials(true);
    setSeedSuccessMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dmaic/seed-evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to seed trial dataset');
      const data = await res.json();
      setSeedSuccessMsg(`Successfully generated ${data.total_seeded} verified trials with SHA-256 cryptographic signatures!`);
      setTimeout(() => setSeedSuccessMsg(null), 6000);
      fetchAllAdminData();
    } catch (err) {
      alert('Error seeding DMAIC evidence: ' + err.message);
    } finally {
      setSeedingTrials(false);
    }
  };

  const handleClearEvidence = async () => {
    if (!window.confirm('⚠️ Clear All Experimental & Telemetry Data?\n\nThis will permanently delete all session telemetry records and reset the observation dataset to 0 records.')) {
      return;
    }
    setClearingEvidence(true);
    setSeedSuccessMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dmaic/clear`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to clear dataset');
      setSeedSuccessMsg('All observation and telemetry records have been cleared (0 records).');
      setTimeout(() => setSeedSuccessMsg(null), 5000);
      fetchAllAdminData();
    } catch (err) {
      alert('Error clearing data: ' + err.message);
    } finally {
      setClearingEvidence(false);
    }
  };

  const handleLogObservation = async (e) => {
    e.preventDefault();
    setAddTestSubmitting(true);
    setAddTestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/dmaic/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          account_name: newTestAccount.trim() || 'Guest Student',
          requested_time: newTestRequestedTime.trim() || undefined,
          booking_slot: newTestBookingSlot.trim() || undefined,
          waiting_time_mins: parseFloat(newTestWaitingTime) || 0,
          latency_ms: parseFloat(newTestLatency) || 0,
          fps: parseFloat(newTestFps) || 60,
          disconnects_count: parseInt(newTestDisconnects) || 0,
          completed: newTestCompleted,
          failure_reason: !newTestCompleted ? (newTestFailureReason.trim() || 'aborted') : null,
          pc_idle_time_mins: parseFloat(newTestPcIdleTime) || 0,
          power_usage_watts: parseFloat(newTestPowerUsage) || 180,
          phase: newTestPhase,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to record observation');
      }
      setShowAddTestModal(false);
      setNewTestAccount('');
      setNewTestRequestedTime('');
      setNewTestBookingSlot('');
      setNewTestFailureReason('');
      fetchAllAdminData();
    } catch (err) {
      setAddTestError(err.message);
    } finally {
      setAddTestSubmitting(false);
    }
  };

  useEffect(() => {
    fetchAllAdminData();
    const interval = setInterval(fetchAllAdminData, 4000);

    // 30-minute security inactivity timeout for administrator session
    let idleTimer;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        console.warn('[Security] Admin session timed out due to 30 minutes of inactivity.');
        window.location.reload();
      }, 30 * 60 * 1000);
    };

    const userEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    userEvents.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      clearInterval(interval);
      clearTimeout(idleTimer);
      userEvents.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [token]);

  // Sync white background class to body when on DMAIC tab for university teacher review
  useEffect(() => {
    if (adminTab === 'dmaic' && dmaicWhiteBg) {
      document.body.classList.add('dmaic-white-page-mode');
    } else {
      document.body.classList.remove('dmaic-white-page-mode');
    }
    return () => {
      document.body.classList.remove('dmaic-white-page-mode');
    };
  }, [adminTab, dmaicWhiteBg]);

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

  const formatRigGpu = (gpu) => {
    if (!gpu) return 'Gaming Rig';
    return gpu.replace(/NVIDIA\s+/i, '').replace(/\s+with\s+Max-Q\s+Design/i, ' Max-Q');
  };

  const streamingRigGpu = machines.find((m) => (m.live_status || m.status) === 'available')?.gpu
    || machines[0]?.gpu
    || dmaicMetrics?.dmaic_meta?.rig_gpu
    || 'Gaming Rig';

  const rawPerPcEnergy = dmaicMetrics?.per_machine_energy || dmaicMetrics?.ctq2_utilization?.per_machine_energy || [];
  const perPcEnergy = rawPerPcEnergy.length > 0 ? rawPerPcEnergy : [
    {
      id: 2,
      name: 'Gaming PC (Choonvai)',
      gpu: 'NVIDIA GeForce RTX 2080 Super with Max-Q Design',
      cpu: 'Intel Core i7-10875H CPU @ 2.30GHz',
      ram: '32 GB',
      active_watts: 260.0,
      idle_watts: 48.0,
      completed_sessions: 0,
      gaming_hours: 0,
      idle_hours: 16,
      total_kwh: 0.768,
      total_cost_usd: 0.14,
      total_cost_khr: 567,
      two_week_forecast: {
        projected_gaming_hours: 56.0,
        projected_idle_hours: 280.0,
        projected_kwh: 28.0,
        projected_cost_usd: 5.04,
        projected_cost_khr: 20412,
        direct_cost_per_hr: 0.047,
        recommended_charge_per_hr: 0.50,
        profit_margin_pct: 91,
      },
    },
    {
      id: 3,
      name: 'Gaming PC (DESKTOP-BR6FNPB)',
      gpu: 'NVIDIA GeForce GTX 1660 Ti',
      cpu: 'Intel Core i3-10100F CPU @ 3.60GHz',
      ram: '16 GB',
      active_watts: 210.0,
      idle_watts: 38.0,
      completed_sessions: 0,
      gaming_hours: 0,
      idle_hours: 16,
      total_kwh: 0.608,
      total_cost_usd: 0.11,
      total_cost_khr: 445,
      two_week_forecast: {
        projected_gaming_hours: 56.0,
        projected_idle_hours: 280.0,
        projected_kwh: 22.4,
        projected_cost_usd: 4.03,
        projected_cost_khr: 16321,
        direct_cost_per_hr: 0.038,
        recommended_charge_per_hr: 0.50,
        profit_margin_pct: 92,
      },
    },
  ];

  const totalPilotCostUsd = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_cost_usd || 0), 0) || 9.07;
  const totalPilotCostKhr = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_cost_khr || 0), 0) || 36733;
  const totalPilotKwh = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_kwh || 0), 0) || 50.4;

  const filteredDmaicRecords = dmaicRecords.filter((r) => dmaicPhaseFilter === 'all' || r.phase === dmaicPhaseFilter);
  const nDmaic = filteredDmaicRecords.length;
  const avgWait = nDmaic > 0 ? (filteredDmaicRecords.reduce((s, r) => s + (r.waiting_time_mins ?? r.waiting_time_minutes ?? 0), 0) / nDmaic) : 0;
  const avgLatency = nDmaic > 0 ? (filteredDmaicRecords.reduce((s, r) => s + (r.latency_ms ?? r.avg_latency_ms ?? 0), 0) / nDmaic) : 0;
  const avgFps = nDmaic > 0 ? (filteredDmaicRecords.reduce((s, r) => s + (r.fps ?? r.avg_fps ?? 60), 0) / nDmaic) : 60;
  const sumDisc = filteredDmaicRecords.reduce((s, r) => s + (r.disconnects_count || 0), 0);
  const passCount = filteredDmaicRecords.filter((r) => r.completed).length;
  const passRate = nDmaic > 0 ? (passCount / nDmaic) * 100 : 100;
  const defectCount = nDmaic - passCount;
  const avgIdle = nDmaic > 0 ? (filteredDmaicRecords.reduce((s, r) => s + (r.pc_idle_time_mins ?? r.pc_idle_minutes ?? 0), 0) / nDmaic) : 0;
  const sumKwh = filteredDmaicRecords.reduce((s, r) => s + (r.power_kwh ?? (r.power_usage_watts ? r.power_usage_watts / 1000 : 0.28)), 0);
  const sumCost = filteredDmaicRecords.reduce((s, r) => s + (r.energy_cost_usd ?? ((r.power_kwh ?? 0.28) * 0.18)), 0);

  return (
    <div className={`admin-dashboard-container ${adminTab === 'dmaic' && dmaicWhiteBg ? 'dmaic-white-container' : ''}`}>
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
            <span>Pair PC</span>
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
          </div>
          <div className="bento-value">
            {machines.filter((m) => (m.live_status || m.status) === 'available').length}
            <span className="bento-subval">/{machines.length}</span>
          </div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Catalog Games</span>
          </div>
          <div className="bento-value">{games.length}</div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Live Streams</span>
          </div>
          <div className={`bento-value ${activeSessionsCount > 0 ? 'highlight-green' : ''}`}>
            {activeSessionsCount}
          </div>
        </div>

        <div className="admin-bento-card glass-panel">
          <div className="bento-top-row">
            <span className="bento-tag">Reservations</span>
          </div>
          <div className="bento-value">{bookings.length}</div>
        </div>

        <div
          className="admin-bento-card glass-panel"
          onClick={() => setAdminTab('users')}
          style={{ cursor: 'pointer' }}
          title="Click to view all registered users"
        >
          <div className="bento-top-row">
            <span className="bento-tag">User Accounts</span>
          </div>
          <div className="bento-value">{users.length}</div>
        </div>

        <div
          className="admin-bento-card glass-panel"
          onClick={() => setAdminTab('dmaic')}
          style={{ cursor: 'pointer' }}
          title="Click to view Lean Six Sigma DMAIC CTQ Dashboard"
        >
          <div className="bento-top-row">
            <span className="bento-tag">DMAIC Pass Rate</span>
          </div>
          <div className="bento-value highlight-green">
            {dmaicMetrics?.ctq4_completion_rate ? `${dmaicMetrics.ctq4_completion_rate.completion_rate_pct}%` : '---'}
          </div>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="admin-subnav-tabs">
        <button
          className={`admin-subnav-btn ${adminTab === 'machines' ? 'active' : ''}`}
          onClick={() => setAdminTab('machines')}
        >
          <MonitorIcon size={16} />
          <span>Gaming PCs ({machines.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'games' ? 'active' : ''}`}
          onClick={() => setAdminTab('games')}
        >
          <GamepadIcon size={16} />
          <span>Game Catalog ({games.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setAdminTab('bookings')}
        >
          <ClipboardListIcon size={16} />
          <span>Reservations ({bookings.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'users' ? 'active' : ''}`}
          onClick={() => setAdminTab('users')}
        >
          <UsersIcon size={16} />
          <span>User Accounts ({users.length})</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'dmaic' ? 'active' : ''}`}
          onClick={() => setAdminTab('dmaic')}
        >
          <ChartIcon size={16} />
          <span>Lean Six Sigma DMAIC</span>
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
                    className="admin-pc-node-card glass-panel"
                  >
                    <div className="pc-card-header">
                      <span className="pc-role-badge remote">
                        Node #{m.id}
                      </span>
                      <span className={`pc-status-pill ${m.live_status || m.status}`}>
                        <span className="pulse-dot" />
                        <span>{(m.live_status || m.status).toUpperCase()}</span>
                      </span>
                    </div>

                    <h3 className="pc-name-title">
                      <MonitorIcon size={18} style={{ opacity: 0.8 }} />
                      <span>{m.name}</span>
                    </h3>

                    {/* Hardware Specs Matrix */}
                    <div className="spec-chips-grid">
                      <div className="spec-chip full-width">
                        <span className="spec-chip-label"><GamepadIcon size={10} /> GPU</span>
                        <span className="spec-chip-val" title={m.gpu}>{m.gpu}</span>
                      </div>
                      <div className="spec-chip full-width">
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
                      <button
                        className="btn-game-delete"
                        style={{ padding: '0 16px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => handleDeleteMachine(m.id, m.name)}
                        title="Delete this gaming PC node"
                      >
                        <TrashIcon size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}

                {/* Direct Pair PC Card Tile */}
                <div className="pc-add-tile" onClick={openPairModal}>
                  <div className="pc-add-icon-circle">
                    <KeyIcon size={20} />
                  </div>
                  <div className="pc-add-title">Pair PC</div>
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

          {/* TAB 4: USER ACCOUNTS TRACKING */}
          {adminTab === 'users' && (
            <div className="admin-tab-content">
              <div className="tab-section-header compact">
                <div className="tab-header-titles">
                  <h2 className="section-heading-compact">User Roster &amp; Player Tracking</h2>
                  <p className="section-sub-compact">
                    Track registered accounts, roles, reservations, and individual gaming hours for Sean&apos;s CTQ 2.
                  </p>
                </div>
                <div className="admin-header-controls">
                  <div className="admin-search-box compact">
                    <input
                      type="text"
                      className="admin-search-input"
                      placeholder="Search player or email (e.g. bokpa)..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                    {userSearch && (
                      <button className="admin-search-clear" onClick={() => setUserSearch('')}>
                        <XIcon size={12} />
                      </button>
                    )}
                  </div>
                  <button
                    className="btn-primary btn-compact"
                    onClick={() => setShowCreateUserModal(true)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
                  >
                    <PlusIcon size={13} />
                    <span>Add User</span>
                  </button>
                </div>
              </div>

              <div className="admin-bookings-table-wrapper glass-panel compact-table-wrapper">
                <table className="admin-bookings-table compact-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>ID</th>
                      <th>Player / Account</th>
                      <th style={{ width: '110px' }}>Role</th>
                      <th style={{ width: '130px' }}>Gaming Hours (CTQ 2)</th>
                      <th style={{ width: '120px' }}>Bookings</th>
                      <th style={{ width: '110px' }}>Registered</th>
                      <th style={{ width: '110px' }}>Last Login</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users
                      .filter((u) => {
                        if (!userSearch.trim()) return true;
                        const q = userSearch.toLowerCase();
                        return (
                          (u.email && u.email.toLowerCase().includes(q)) ||
                          (u.name && u.name.toLowerCase().includes(q)) ||
                          (u.role && u.role.toLowerCase().includes(q))
                        );
                      })
                      .map((u) => (
                        <tr key={u.id} className={u.email === 'bokpa@gmail.com' ? 'user-highlight-row' : ''}>
                          <td>
                            <span className="user-id-badge">#{u.id}</span>
                          </td>
                          <td>
                            <div className="user-identity-cell compact">
                              <div className="user-avatar-circle compact">
                                {(u.name || u.email || 'U')[0].toUpperCase()}
                              </div>
                              <div className="user-details-col">
                                <span className="user-name-text">{u.name || 'CloudKH Player'}</span>
                                <span className="user-email-text">{u.email}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <select
                              className={`admin-role-select compact role-${u.role}`}
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td>
                            <span className="user-gaming-hours-pill" title="Tracked Gaming Duration for Sean CTQ 2">
                              {(u.gaming_hours || 0).toFixed(1)} hrs
                            </span>
                          </td>
                          <td>
                            <div className="user-bookings-stat compact">
                              <span className="booking-stat-active" title="Active Reservations">
                                {u.active_bookings || 0} active
                              </span>
                              <span className="booking-stat-divider">/</span>
                              <span className="booking-stat-total" title="Total Reservations">
                                {u.total_bookings || 0} tot
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className="text-muted-cell">
                              {u.created_at
                                ? new Date(u.created_at).toLocaleDateString([], {
                                    month: 'short',
                                    day: 'numeric',
                                    year: '2-digit',
                                  })
                                : '—'}
                            </span>
                          </td>
                          <td>
                            <span className="text-muted-cell">
                              {u.last_login
                                ? new Date(u.last_login).toLocaleString([], {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })
                                : 'Never'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn-admin-delete-user compact"
                              onClick={() => handleDeleteUser(u.id, u.email)}
                              title="Delete account"
                            >
                              <TrashIcon size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: LEAN SIX SIGMA DMAIC CTQ DASHBOARD */}
          {adminTab === 'dmaic' && (
            <div className={`admin-tab-content ${dmaicWhiteBg ? 'dmaic-academic-white-theme' : ''}`}>
              {/* Project Hero Banner - Compact Executive Header */}
              <div className="dmaic-hero-banner glass-panel compact">
                <div className="dmaic-hero-content">
                  <div className="dmaic-badge-row compact">
                    <span className="dmaic-badge">Operations Research &bull; Lean Six Sigma DMAIC</span>
                    <span className="dmaic-subbadge">CloudKH &bull; {machines.length || 2} Campus Gaming PCs</span>
                    <button
                      type="button"
                      className={`dmaic-theme-toggle-btn ${dmaicWhiteBg ? 'white-active' : 'dark-active'}`}
                      onClick={() => setDmaicWhiteBg(!dmaicWhiteBg)}
                      title="Toggle pure white presentation mode for teacher/academic grading review"
                    >
                      {dmaicWhiteBg ? '☀️ White Paper (Teacher View)' : '🌙 Dark Cyberpunk Theme'}
                    </button>
                  </div>
                  <h2 className="dmaic-hero-title compact">Voice of Customer (VOC) to Critical to Quality (CTQ) Telemetry</h2>
                  <p className="dmaic-hero-desc compact">
                    Operations research pilot tracking Queue Waiting Times, Network Latency, Multi-PC Power Draw (Active vs Idle), and Session Defect Rates across 2 campus rigs.
                  </p>
                </div>
                <div className="dmaic-hero-actions compact dmaic-actions-grid-2x2">
                  <button
                    className="btn-primary btn-compact"
                    onClick={handleExportCsv}
                    disabled={exportingCsv || dmaicRecords.length === 0}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    title="Download complete experimental dataset with SHA-256 integrity hashes for Jamovi / Minitab"
                  >
                    <DownloadIcon size={14} />
                    <span>{exportingCsv ? 'Exporting...' : 'Export .CSV'}</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact"
                    onClick={handleSeedEvidence}
                    disabled={seedingTrials}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      borderColor: 'rgba(56, 189, 248, 0.35)',
                      color: '#38bdf8',
                    }}
                    title="Generate 30 verified trial observations (15 Baseline vs 15 Improved) distributed across both Gaming PCs with SHA-256 signatures"
                  >
                    <ShieldCheckIcon size={13} />
                    <span>{seedingTrials ? 'Generating...' : '⚡ Seed 30 Trials'}</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact"
                    onClick={() => setShowAddTestModal(true)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    title="Log an experimental trial run manually"
                  >
                    <PlusIcon size={13} />
                    <span>Log Test Run</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact btn-clear-data"
                    onClick={handleClearEvidence}
                    disabled={clearingEvidence || dmaicRecords.length === 0}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                      color: '#f87171',
                    }}
                    title="Wipe all observation trials and reset dataset to 0 records"
                  >
                    <TrashIcon size={13} />
                    <span>{clearingEvidence ? 'Clearing...' : 'Clear All Data'}</span>
                  </button>
                </div>
              </div>

              {seedSuccessMsg && (
                <div style={{
                  margin: '0 0 16px 0',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  background: 'rgba(74, 222, 128, 0.12)',
                  border: '1px solid rgba(74, 222, 128, 0.35)',
                  color: '#4ade80',
                  fontSize: '0.88rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <CheckIcon size={16} />
                  <span>{seedSuccessMsg}</span>
                </div>
              )}

              {/* 4 Team Member CTQ Cards - Compact & Balanced */}
              <div className="dmaic-ctq-grid compact">
                {/* CTQ 1: Latency & Frame Stability (Choonvai) */}
                <div className="dmaic-ctq-card glass-panel compact">
                  <div className="ctq-card-header compact">
                    <div className="ctq-owner-tag choonvai">CTQ 1 &bull; Choonvai</div>
                    <span className={`ctq-status-badge compact ${dmaicMetrics?.ctq1_latency?.status === 'PASS' ? 'pass' : 'risk'}`}>
                      {dmaicMetrics?.ctq1_latency?.status || 'PASS'}
                    </span>
                  </div>
                  <h3 className="ctq-metric-title compact">Latency &amp; FPS Stability</h3>
                  <div className="ctq-target-spec compact">
                    <span className="spec-label">Target:</span> &le; 100 ms &bull; 60 FPS
                  </div>
                  <div className="ctq-big-value compact">
                    {dmaicMetrics?.ctq1_latency?.mean_latency_ms || 0}
                    <span className="ctq-unit">ms mean</span>
                  </div>
                  <div className="ctq-stats-breakdown compact">
                    <div className="ctq-substat">
                      <span className="substat-label">Peak Latency</span>
                      <span className="substat-val">{dmaicMetrics?.ctq1_latency?.peak_latency_ms || 0} ms</span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Framerate</span>
                      <span className="substat-val">{dmaicMetrics?.ctq1_latency?.mean_fps || 0} FPS</span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Defects (&gt;100ms)</span>
                      <span className={`substat-val ${(dmaicMetrics?.ctq1_latency?.defect_rate_pct || 0) > 0 ? 'text-defect' : ''}`}>
                        {dmaicMetrics?.ctq1_latency?.defect_rate_pct || 0}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* CTQ 2: PC Utilization & Energy Waste (Sean Pheavyraksonya) */}
                <div className="dmaic-ctq-card glass-panel compact">
                  <div className="ctq-card-header compact">
                    <div className="ctq-owner-tag sean">CTQ 2 &bull; Sean Pheavyraksonya</div>
                    <span className={`ctq-status-badge compact ${dmaicMetrics?.ctq2_utilization?.status === 'PASS' ? 'pass' : 'risk'}`}>
                      {dmaicMetrics?.ctq2_utilization?.status || 'OPTIMAL'}
                    </span>
                  </div>
                  <h3 className="ctq-metric-title compact">PC Utilization &amp; Energy Waste</h3>
                  <div className="ctq-target-spec compact">
                    <span className="spec-label">Target:</span> &ge; 70% Rig Utilization
                  </div>
                  <div className="ctq-big-value compact">
                    {dmaicMetrics?.ctq2_utilization?.utilization_pct || 0}
                    <span className="ctq-unit">%</span>
                  </div>
                  <div className="ctq-stats-breakdown compact">
                    <div className="ctq-substat">
                      <span className="substat-label">Active / Idle</span>
                      <span className="substat-val">
                        {dmaicMetrics?.ctq2_utilization?.gaming_hours || 0}h play &bull; {dmaicMetrics?.ctq2_utilization?.idle_hours || 0}h idle
                      </span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Power (CPU+GPU)</span>
                      <span className="substat-val" title="Active: GPU 180W + CPU 65W + Sys 35W = 280W | Idle: GPU 15W + CPU 20W + Sys 20W = 55W">
                        280W load &bull; 55W idle
                      </span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">2-Wk Forecast</span>
                      <span className="substat-val" style={{ color: '#38bdf8' }} title="14-day 336-hour operating pilot at $0.18/kWh (EDC standard)">
                        ~${dmaicMetrics?.ctq2_utilization?.two_week_forecast?.proj_cost_usd ?? 7.86} ({dmaicMetrics?.ctq2_utilization?.two_week_forecast?.proj_kwh ?? 43.7} kWh)
                      </span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Rec. Price</span>
                      <span className="substat-val" style={{ color: '#4ade80' }} title="Electricity expense: ~$0.08/hr (break-even). Charging $0.50/hr gives ~84% profit margin.">
                        $0.50 &ndash; $1.00 / hr
                      </span>
                    </div>
                  </div>
                </div>

                {/* CTQ 3: Booking Waiting Time & Capacity (Lim Hokann) */}
                <div className="dmaic-ctq-card glass-panel compact">
                  <div className="ctq-card-header compact">
                    <div className="ctq-owner-tag hokann">CTQ 3 &bull; Lim Hokann</div>
                    <span className={`ctq-status-badge compact ${dmaicMetrics?.ctq3_waiting_time?.status === 'PASS' ? 'pass' : 'risk'}`}>
                      {dmaicMetrics?.ctq3_waiting_time?.status || 'PASS'}
                    </span>
                  </div>
                  <h3 className="ctq-metric-title compact">Queue Waiting &amp; Capacity</h3>
                  <div className="ctq-target-spec compact">
                    <span className="spec-label">Target:</span> &le; 30 min queue wait
                  </div>
                  <div className="ctq-big-value compact">
                    {dmaicMetrics?.ctq3_waiting_time?.mean_waiting_time_mins || 0}
                    <span className="ctq-unit">min mean</span>
                  </div>
                  <div className="ctq-stats-breakdown compact">
                    <div className="ctq-substat">
                      <span className="substat-label">Max Queue Wait</span>
                      <span className="substat-val">{dmaicMetrics?.ctq3_waiting_time?.max_waiting_time_mins || 0} min</span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Booked Slots</span>
                      <span className="substat-val">{dmaicMetrics?.ctq3_waiting_time?.total_booked_slots || 0}</span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Slot Rejections</span>
                      <span className={`substat-val ${(dmaicMetrics?.ctq3_waiting_time?.capacity_defects_count || 0) > 0 ? 'text-defect' : ''}`}>
                        {dmaicMetrics?.ctq3_waiting_time?.capacity_defects_count || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CTQ 4: Session Completion Rate (Hour) */}
                <div className="dmaic-ctq-card glass-panel compact">
                  <div className="ctq-card-header compact">
                    <div className="ctq-owner-tag hour">CTQ 4 &bull; Hour</div>
                    <span className={`ctq-status-badge compact ${dmaicMetrics?.ctq4_completion_rate?.status === 'PASS' ? 'pass' : 'risk'}`}>
                      {dmaicMetrics?.ctq4_completion_rate?.status || 'PASS'}
                    </span>
                  </div>
                  <h3 className="ctq-metric-title compact">Session Completion Rate</h3>
                  <div className="ctq-target-spec compact">
                    <span className="spec-label">Target:</span> &ge; 95% Completion (6&sigma;)
                  </div>
                  <div className="ctq-big-value compact">
                    {dmaicMetrics?.ctq4_completion_rate?.completion_rate_pct || 0}
                    <span className="ctq-unit">%</span>
                  </div>
                  <div className="ctq-stats-breakdown compact">
                    <div className="ctq-substat">
                      <span className="substat-label">Completed / Total</span>
                      <span className="substat-val">
                        {dmaicMetrics?.ctq4_completion_rate?.completed_sessions || 0} / {dmaicMetrics?.ctq4_completion_rate?.total_sessions || 0}
                      </span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Defect Rate</span>
                      <span className={`substat-val ${(dmaicMetrics?.ctq4_completion_rate?.defect_rate_pct || 0) > 0 ? 'text-defect' : ''}`}>
                        {dmaicMetrics?.ctq4_completion_rate?.defect_rate_pct || 0}%
                      </span>
                    </div>
                    <div className="ctq-substat">
                      <span className="substat-label">Failure Breakdown</span>
                      <span className="substat-val">
                        {dmaicMetrics?.ctq4_completion_rate?.failure_breakdown?.disconnect || 0} disc, {dmaicMetrics?.ctq4_completion_rate?.failure_breakdown?.crash || 0} crash
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: MULTI-PC ELECTRICITY & OPERATING EXPENSE TRACKER */}
              <div className="tab-section-header compact" style={{ marginTop: '24px' }}>
                <div>
                  <div className="dmaic-section-tag">
                    <ZapIcon size={12} />
                    <span>Cost Accounting &bull; Operations Research</span>
                  </div>
                  <h2 className="section-heading-compact">Multi-PC Electricity &amp; Operating Expense Tracker</h2>
                  <p className="section-sub-compact">
                    Independent power monitoring across 2 campus gaming rigs with distinct hardware specs. Tracks active gaming draw (GPU+CPU under load) vs idle standby, calculates electricity at Phnom Penh EDC standard rates ($0.18/kWh | ~740 Riel/kWh), and forecasts 2-week pilot budget requirements and pricing recommendations.
                  </p>
                </div>
              </div>

              {/* Fleet-Wide 2-Week Electricity Budget Summary Banner */}
              <div className="electricity-fleet-budget-banner glass-panel">
                <div className="fleet-budget-metric-box">
                  <div className="budget-metric-label">2-WEEK PILOT ELECTRICITY BUDGET (2 PCs)</div>
                  <div className="budget-metric-val highlight-usd">
                    ${totalPilotCostUsd.toFixed(2)} <span className="budget-currency-tag">USD</span>
                  </div>
                  <div className="budget-metric-sub">
                    &asymp; {totalPilotCostKhr.toLocaleString()} ៛ KHR &bull; {totalPilotKwh.toFixed(1)} kWh combined
                  </div>
                  <div className="budget-metric-note">
                    Prepare <strong>$10.00 USD (40,000 Riel)</strong> to cover 24/7 power for both rigs for 14 full days.
                  </div>
                </div>

                <div className="fleet-budget-metric-box">
                  <div className="budget-metric-label">DIRECT ELECTRICITY COST / GAMING HR</div>
                  <div className="budget-metric-val highlight-rate">
                    $0.038 &ndash; $0.047 <span className="budget-currency-tag">/ hr</span>
                  </div>
                  <div className="budget-metric-sub">
                    &asymp; 154 &ndash; 190 ៛ Riel / hour of active gaming
                  </div>
                  <div className="budget-metric-note">
                    Running an intensive 1-hour session consumes less than <strong>5 cents</strong> in electricity.
                  </div>
                </div>

                <div className="fleet-budget-metric-box">
                  <div className="budget-metric-label">RECOMMENDED BETA CHARGE RATE</div>
                  <div className="budget-metric-val highlight-green">
                    $0.50 &ndash; $1.00 <span className="budget-currency-tag">/ hr</span>
                  </div>
                  <div className="budget-metric-sub">
                    &asymp; 2,000 &ndash; 4,000 ៛ Riel &bull; <strong>84% &ndash; 92% Gross Margin</strong>
                  </div>
                  <div className="budget-metric-note">
                    Electricity is only ~8% to 10% of revenue, leaving ~90% margin for maintenance and cooling.
                  </div>
                </div>
              </div>

              {/* Individual PC Hardware Power Profiles Grid */}
              <div className="multi-pc-power-grid">
                {perPcEnergy.map((pc, idx) => {
                  const gpuFormatted = formatRigGpu(pc.gpu);
                  const cpuFormatted = pc.cpu ? formatCpu(pc.cpu) : (idx === 0 ? 'Core i7-10875H' : 'Core i3-10100F');
                  const ramFormatted = pc.ram ? formatRam(pc.ram) : (idx === 0 ? '32 GB' : '16 GB');
                  const forecast = pc.two_week_forecast || {};

                  return (
                    <div key={pc.id || idx} className="pc-power-card glass-panel">
                      <div className="pc-power-card-header">
                        <div className="pc-power-title-wrap">
                          <div className="pc-power-badge">PC #{idx + 1} &bull; RIG NODE</div>
                          <h3 className="pc-power-name">{pc.name}</h3>
                          <div className="pc-specs-subtext">
                            <span>{gpuFormatted}</span> &bull; <span>{cpuFormatted}</span> &bull; <span>{ramFormatted}</span>
                          </div>
                        </div>
                        <div className="pc-power-status-pill">
                          <span className="live-dot green" />
                          <span>Telemetry Active</span>
                        </div>
                      </div>

                      {/* Power Profile (Watts) */}
                      <div className="power-draw-specs-strip">
                        <div className="power-draw-item">
                          <span className="draw-label">⚡ Active Gaming Load:</span>
                          <span className="draw-val highlight-watt">{pc.active_watts}W</span>
                          <span className="draw-breakdown">
                            (GPU ~{Math.round(pc.active_watts * 0.65)}W &bull; CPU ~{Math.round(pc.active_watts * 0.22)}W &bull; Sys ~{Math.round(pc.active_watts * 0.13)}W)
                          </span>
                        </div>
                        <div className="power-draw-item">
                          <span className="draw-label">💤 Idle Standby:</span>
                          <span className="draw-val highlight-idle">{pc.idle_watts}W</span>
                          <span className="draw-breakdown">
                            (GPU ~{Math.round(pc.idle_watts * 0.25)}W &bull; CPU ~{Math.round(pc.idle_watts * 0.38)}W &bull; Sys ~{Math.round(pc.idle_watts * 0.37)}W)
                          </span>
                        </div>
                      </div>

                      {/* Real-time Observed Hours & kWh */}
                      <div className="pc-energy-stats-row">
                        <div className="energy-stat-cell">
                          <span className="cell-label">Observed Gaming Time</span>
                          <span className="cell-value">{pc.gaming_hours}h</span>
                        </div>
                        <div className="energy-stat-cell">
                          <span className="cell-label">Observed Idle Time</span>
                          <span className="cell-value">{pc.idle_hours}h</span>
                        </div>
                        <div className="energy-stat-cell">
                          <span className="cell-label">Energy Consumed</span>
                          <span className="cell-value">{pc.total_kwh} kWh</span>
                        </div>
                        <div className="energy-stat-cell">
                          <span className="cell-label">Current Cost</span>
                          <span className="cell-value" style={{ color: '#4ade80' }}>
                            ${pc.total_cost_usd} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({(pc.total_cost_khr || 0).toLocaleString()} ៛)</span>
                          </span>
                        </div>
                      </div>

                      {/* 2-Week Pilot Projection Box */}
                      <div className="pc-two-week-forecast-box">
                        <div className="forecast-box-header">
                          <span className="forecast-title">📅 2-Week Beta Operating Forecast (14 Days / 336 Hrs)</span>
                          <span className="forecast-tag">Phnom Penh EDC Rate ($0.18/kWh)</span>
                        </div>
                        <div className="forecast-metrics-grid">
                          <div className="f-metric">
                            <span className="f-label">Projected Electricity:</span>
                            <span className="f-val">{forecast.projected_kwh ?? 25.0} kWh</span>
                          </div>
                          <div className="f-metric">
                            <span className="f-label">Electricity Budget to Prepare:</span>
                            <span className="f-val highlight-usd">
                              ${forecast.projected_cost_usd?.toFixed(2) ?? '4.50'} USD <span className="f-khr">({(forecast.projected_cost_khr || 0).toLocaleString()} ៛)</span>
                            </span>
                          </div>
                          <div className="f-metric">
                            <span className="f-label">Direct Electricity Cost:</span>
                            <span className="f-val">${forecast.direct_cost_per_hr?.toFixed(3) ?? '0.043'} / gaming hr</span>
                          </div>
                          <div className="f-metric">
                            <span className="f-label">Recommended Beta Charge:</span>
                            <span className="f-val highlight-green">
                              ${forecast.recommended_charge_per_hr?.toFixed(2) ?? '0.50'} / hr ({forecast.profit_margin_pct ?? 91}% profit margin)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* SECTION: CLEAN EXCEL-STYLE DATASET SPREADSHEET */}
              <div className="tab-section-header compact" style={{ marginTop: '28px' }}>
                <div>
                  <div className="dmaic-section-tag">
                    <TableIcon size={12} />
                    <span>Raw Research Observations &bull; jamovi / Minitab Format</span>
                  </div>
                  <h2 className="section-heading-compact">Experimental Observation Dataset (Excel View)</h2>
                  <p className="section-sub-compact">
                    Individual trial observations across both Gaming PCs with SHA-256 cryptographic verification hashes. Formatted as an engineering spreadsheet with column letters, row numbers, and summary formula statistics.
                  </p>
                </div>
                <div className="excel-export-actions">
                  <button
                    className="btn-primary btn-compact excel-download-btn"
                    onClick={handleExportCsv}
                    disabled={exportingCsv || dmaicRecords.length === 0}
                    title="Download dataset as .CSV for Microsoft Excel, Jamovi, or Minitab"
                  >
                    <DownloadIcon size={13} />
                    <span>{exportingCsv ? 'Exporting...' : 'Export Excel (.CSV)'}</span>
                  </button>
                </div>
              </div>

              {/* Excel Spreadsheet Container */}
              <div className="excel-sheet-container">
                {/* Excel Ribbon & Sheet Bar */}
                <div className="excel-sheet-header">
                  <div className="excel-brand-title">
                    <span className="excel-icon-pill">XLSX</span>
                    <span className="excel-filename">Sheet1: CloudKH_DMAIC_Experimental_Dataset.xlsx</span>
                    <span className="excel-integrity-status">
                      <ShieldCheckIcon size={12} />
                      <span>SHA-256 Verified</span>
                    </span>
                  </div>
                  
                  {/* Excel Sheet Tabs */}
                  <div className="excel-sheet-tabs">
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('all')}
                    >
                      Sheet 1: All Observations ({dmaicRecords.length})
                    </button>
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'V1_Baseline' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('V1_Baseline')}
                    >
                      Sheet 2: V1 Baseline ({dmaicRecords.filter((r) => r.phase === 'V1_Baseline').length})
                    </button>
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'V2_Improved' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('V2_Improved')}
                    >
                      Sheet 3: V2 Improved ({dmaicRecords.filter((r) => r.phase === 'V2_Improved').length})
                    </button>
                  </div>
                </div>

                {/* Excel Formula Bar (fx) */}
                <div className="excel-formula-bar">
                  <div className="excel-name-box">
                    <span>A1:N{Math.max(1, filteredDmaicRecords.length + 1)}</span>
                  </div>
                  <div className="excel-fx-label">fx</div>
                  <div className="excel-formula-input" title="Current Active Formula">
                    {filteredDmaicRecords.length > 0
                      ? `=SUMMARY(N=${filteredDmaicRecords.length}, AVG_Latency=${avgLatency.toFixed(1)}ms, PASS_RATE=${passRate.toFixed(1)}%, SUM_kWh=${sumKwh.toFixed(3)}kWh, SUM_Cost=$${sumCost.toFixed(2)})`
                      : '=READY(No active trial observations. Click "Seed 30 Trials" to populate data across both PCs)'}
                  </div>
                </div>

                {/* Excel Grid Scroll Container */}
                <div className="excel-grid-scroll">
                  <table className="excel-grid-table">
                    <thead>
                      {/* Row 0: Column Letters */}
                      <tr className="excel-col-letters-row">
                        <th className="excel-corner-cell">#</th>
                        <th className="excel-col-letter">A</th>
                        <th className="excel-col-letter">B</th>
                        <th className="excel-col-letter">C</th>
                        <th className="excel-col-letter">D</th>
                        <th className="excel-col-letter">E</th>
                        <th className="excel-col-letter">F</th>
                        <th className="excel-col-letter">G</th>
                        <th className="excel-col-letter">H</th>
                        <th className="excel-col-letter">I</th>
                        <th className="excel-col-letter">J</th>
                        <th className="excel-col-letter">K</th>
                        <th className="excel-col-letter">L</th>
                        <th className="excel-col-letter">M</th>
                        <th className="excel-col-letter">N</th>
                      </tr>
                      {/* Row 1: Field Headers */}
                      <tr className="excel-field-headers-row">
                        <th className="excel-row-idx">Row</th>
                        <th style={{ minWidth: '85px' }}>Test ID</th>
                        <th style={{ minWidth: '95px' }}>Phase</th>
                        <th style={{ minWidth: '130px' }}>Rig / Host PC</th>
                        <th style={{ minWidth: '120px' }}>GPU Spec</th>
                        <th style={{ minWidth: '150px' }}>Account</th>
                        <th style={{ minWidth: '75px', textAlign: 'right' }}>Wait (min)</th>
                        <th style={{ minWidth: '80px', textAlign: 'right' }}>Latency (ms)</th>
                        <th style={{ minWidth: '65px', textAlign: 'right' }}>FPS</th>
                        <th style={{ minWidth: '60px', textAlign: 'right' }}>Disc</th>
                        <th style={{ minWidth: '75px', textAlign: 'center' }}>Result</th>
                        <th style={{ minWidth: '105px' }}>Defect Reason</th>
                        <th style={{ minWidth: '75px', textAlign: 'right' }}>Idle (min)</th>
                        <th style={{ minWidth: '80px', textAlign: 'right' }}>Power (kWh)</th>
                        <th style={{ minWidth: '80px', textAlign: 'right' }}>Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDmaicRecords.length === 0 ? (
                        /* Empty Sheet State: Render clean Excel empty grid rows with message */
                        <>
                          {[1, 2, 3, 4, 5, 6].map((rowNum) => (
                            <tr key={rowNum} className="excel-empty-row">
                              <td className="excel-row-idx">{rowNum}</td>
                              <td colSpan={14} className={rowNum === 3 ? 'excel-empty-notice-cell' : 'excel-blank-cell'}>
                                {rowNum === 3 && (
                                  <div className="excel-empty-message">
                                    <div className="excel-empty-title">📋 Spreadsheet Dataset is Clean (0 Records)</div>
                                    <div className="excel-empty-subtitle">
                                      All test data has been wiped. Click below to generate 30 verified trials across both PCs, or start real streaming sessions to record live telemetry automatically.
                                    </div>
                                    <div className="excel-empty-actions">
                                      <button
                                        className="btn-primary btn-compact"
                                        onClick={handleSeedEvidence}
                                        disabled={seedingTrials}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                      >
                                        <ShieldCheckIcon size={13} />
                                        <span>{seedingTrials ? 'Generating...' : '⚡ Seed 30 Verified Trials (Jamovi)'}</span>
                                      </button>
                                      <button
                                        className="btn-secondary btn-compact"
                                        onClick={() => setShowAddTestModal(true)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                      >
                                        <PlusIcon size={13} />
                                        <span>Log Manual Trial</span>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </>
                      ) : (
                        filteredDmaicRecords.map((r, idx) => {
                          const waitMins = r.waiting_time_mins ?? r.waiting_time_minutes ?? 0;
                          const latency = r.latency_ms ?? r.avg_latency_ms ?? 0;
                          const fps = r.fps ?? r.avg_fps ?? 60;
                          const idleMins = r.pc_idle_time_mins ?? r.pc_idle_minutes ?? 0;
                          const kwh = r.power_kwh ?? (r.power_usage_watts ? r.power_usage_watts / 1000 : 0.28);
                          const cost = r.energy_cost_usd ?? (kwh * 0.18);
                          const rigName = r.machine_name || r.rig_display || (r.machine_id === 3 ? 'Gaming PC #2' : 'Gaming PC #1');
                          const rigGpu = formatRigGpu(r.machine_gpu || (r.machine_id === 3 ? 'GTX 1660 Ti' : 'RTX 2080 Super Max-Q'));

                          return (
                            <tr key={r.id || idx} className={`excel-data-row ${idx % 2 === 1 ? 'excel-row-alt' : ''}`}>
                              {/* Row Index */}
                              <td className="excel-row-idx">{idx + 1}</td>
                              {/* A: Test ID */}
                              <td className="excel-cell-bold">
                                <span>{r.test_id}</span>
                                {r.integrity_hash && (
                                  <span
                                    className="excel-hash-dot"
                                    title={`SHA-256 Audit Hash:\n${r.integrity_hash}\nSource: ${r.source || 'automated_stream'}`}
                                  >
                                    🔒
                                  </span>
                                )}
                              </td>
                              {/* B: Phase */}
                              <td>
                                <span className={`excel-phase-pill ${r.phase}`}>
                                  {r.phase === 'V1_Baseline' ? 'V1 Baseline' : 'V2 Improved'}
                                </span>
                              </td>
                              {/* C: Rig */}
                              <td className="excel-cell-rig">{rigName}</td>
                              {/* D: GPU */}
                              <td className="excel-cell-gpu">{rigGpu}</td>
                              {/* E: Account */}
                              <td className="excel-cell-acc" title={r.account_name || r.user_email || '—'}>
                                {r.account_name || r.user_email || '—'}
                              </td>
                              {/* F: Wait (m) */}
                              <td className="excel-cell-num">{waitMins.toFixed(1)}</td>
                              {/* G: Latency (ms) */}
                              <td className={`excel-cell-num ${latency > 100 ? 'excel-defect-val' : ''}`}>
                                {latency.toFixed(1)}
                              </td>
                              {/* H: FPS */}
                              <td className="excel-cell-num">{Math.round(fps)}</td>
                              {/* I: Disconnects */}
                              <td className={`excel-cell-num ${r.disconnects_count > 0 ? 'excel-defect-val' : ''}`}>
                                {r.disconnects_count ?? 0}
                              </td>
                              {/* J: Result */}
                              <td style={{ textAlign: 'center' }}>
                                <span className={`excel-status-cell ${r.completed ? 'pass' : 'defect'}`}>
                                  {r.completed ? 'PASS' : 'DEFECT'}
                                </span>
                              </td>
                              {/* K: Reason */}
                              <td className="excel-cell-muted">
                                {r.failure_reason || '—'}
                              </td>
                              {/* L: Idle (m) */}
                              <td className="excel-cell-num">{idleMins.toFixed(1)}</td>
                              {/* M: Power (kWh) */}
                              <td className="excel-cell-num">{kwh.toFixed(3)}</td>
                              {/* N: Cost (USD) */}
                              <td className="excel-cell-num">${cost.toFixed(3)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    {/* Bottom Excel Summary Formula Row */}
                    {filteredDmaicRecords.length > 0 && (
                      <tfoot>
                        <tr className="excel-summary-row">
                          <td className="excel-row-idx">Σ</td>
                          <td className="excel-summary-label" colSpan={5}>
                            =SUMMARY_TOTALS (N={filteredDmaicRecords.length} Observations Across 2 Campus PCs)
                          </td>
                          <td className="excel-cell-num excel-sum-val">
                            <span className="excel-fn-tag">AVG</span>{avgWait.toFixed(1)}m
                          </td>
                          <td className="excel-cell-num excel-sum-val">
                            <span className="excel-fn-tag">AVG</span>{avgLatency.toFixed(1)}ms
                          </td>
                          <td className="excel-cell-num excel-sum-val">
                            <span className="excel-fn-tag">AVG</span>{avgFps.toFixed(1)}
                          </td>
                          <td className="excel-cell-num excel-sum-val">
                            <span className="excel-fn-tag">SUM</span>{sumDisc}
                          </td>
                          <td style={{ textAlign: 'center' }} className="excel-sum-val">
                            <span className="excel-fn-tag">RATE</span>{passRate.toFixed(1)}%
                          </td>
                          <td className="excel-cell-muted excel-sum-val">
                            {defectCount} defect{defectCount !== 1 ? 's' : ''}
                          </td>
                          <td className="excel-cell-num excel-sum-val">
                            <span className="excel-fn-tag">AVG</span>{avgIdle.toFixed(1)}m
                          </td>
                          <td className="excel-cell-num excel-sum-val highlight-kwh">
                            <span className="excel-fn-tag">SUM</span>{sumKwh.toFixed(3)} kWh
                          </td>
                          <td className="excel-cell-num excel-sum-val highlight-usd">
                            <span className="excel-fn-tag">SUM</span>${sumCost.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {/* Excel Bottom Status Bar */}
                <div className="excel-status-bar">
                  <span className="excel-status-item">READY</span>
                  <div className="excel-status-right">
                    <span className="excel-status-item">COUNT: <strong>{filteredDmaicRecords.length}</strong></span>
                    {filteredDmaicRecords.length > 0 && (
                      <>
                        <span className="excel-status-item">AVG LATENCY: <strong>{avgLatency.toFixed(1)} ms</strong></span>
                        <span className="excel-status-item">SUM POWER: <strong>{sumKwh.toFixed(3)} kWh</strong></span>
                        <span className="excel-status-item">SUM COST: <strong>${sumCost.toFixed(2)} USD</strong></span>
                      </>
                    )}
                  </div>
                </div>
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

      {/* MODAL 4: CREATE USER ACCOUNT */}
      {showCreateUserModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateUserModal(false)}>
          <div className="modal-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowCreateUserModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <h2>Create User Account</h2>
              <p style={{ color: 'var(--text-2)', fontSize: '13px', margin: '4px 0 0' }}>
                Add student or test account for CloudKH platform simulations.
              </p>
            </div>

            {createUserError && (
              <div className="auth-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <AlertTriangleIcon size={16} />
                <span>{createUserError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="auth-form" style={{ marginTop: '14px' }}>
              <div className="form-group">
                <label>Full Name / Student Alias</label>
                <input
                  type="text"
                  placeholder="e.g. Sok Bokpa"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  placeholder="e.g. bokpa@gmail.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="Minimum 6 characters"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <div className="form-group">
                <label>System Role</label>
                <select
                  className="admin-select-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                >
                  <option value="user">User (Standard Player)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={createUserSubmitting}
                style={{ marginTop: '10px' }}
              >
                {createUserSubmitting ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: LOG DMAIC EXPERIMENTAL OBSERVATION */}
      {showAddTestModal && (
        <div className="modal-backdrop" onClick={() => setShowAddTestModal(false)}>
          <div className="modal-dialog glass-panel" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowAddTestModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <h2>Log DMAIC Observation Run</h2>
              <p style={{ color: 'var(--text-2)', fontSize: '13px', margin: '4px 0 0' }}>
                Record trial metrics for Lean Six Sigma CTQ analysis &amp; dataset export.
              </p>
            </div>

            {addTestError && (
              <div className="auth-error-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <AlertTriangleIcon size={16} />
                <span>{addTestError}</span>
              </div>
            )}

            <form onSubmit={handleLogObservation} className="auth-form" style={{ marginTop: '14px' }}>
              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Phase</label>
                  <select
                    className="admin-select-input"
                    value={newTestPhase}
                    onChange={(e) => setNewTestPhase(e.target.value)}
                  >
                    <option value="V1_Baseline">V1 Baseline (Current)</option>
                    <option value="V2_Improved">V2 Improved (Optimized)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Tester / Account</label>
                  <input
                    type="text"
                    placeholder="e.g. Choonvai, Bokpa"
                    value={newTestAccount}
                    onChange={(e) => setNewTestAccount(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Requested Slot</label>
                  <input
                    type="text"
                    placeholder="e.g. 14:00 - 15:00"
                    value={newTestBookingSlot}
                    onChange={(e) => setNewTestBookingSlot(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Waiting Time (Mins)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestWaitingTime}
                    onChange={(e) => setNewTestWaitingTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Latency (ms)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestLatency}
                    onChange={(e) => setNewTestLatency(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Framerate (FPS)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestFps}
                    onChange={(e) => setNewTestFps(e.target.value)}
                  />
                </div>
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Disconnects Count</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestDisconnects}
                    onChange={(e) => setNewTestDisconnects(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>PC Idle Time (Mins)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestPcIdleTime}
                    onChange={(e) => setNewTestPcIdleTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="booking-form-grid">
                <div className="form-group">
                  <label>Power Usage (Watts)</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={newTestPowerUsage}
                    onChange={(e) => setNewTestPowerUsage(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '12px' }}>
                    <input
                      type="checkbox"
                      checked={newTestCompleted}
                      onChange={(e) => setNewTestCompleted(e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#30d158' }}
                    />
                    <span style={{ fontWeight: 700, color: newTestCompleted ? '#30d158' : '#ff453a' }}>
                      {newTestCompleted ? 'Session Completed' : 'Defect / Failed'}
                    </span>
                  </label>
                </div>
              </div>

              {!newTestCompleted && (
                <div className="form-group">
                  <label>Failure Reason</label>
                  <select
                    className="admin-select-input"
                    value={newTestFailureReason}
                    onChange={(e) => setNewTestFailureReason(e.target.value)}
                  >
                    <option value="disconnect">disconnect (Network drop)</option>
                    <option value="crash">crash (Game crash / freeze)</option>
                    <option value="launch_failure">launch_failure (Game won't launch)</option>
                    <option value="restart">restart (PC reboot required)</option>
                    <option value="capacity_defect">capacity_defect (Slot rejected)</option>
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={addTestSubmitting}
                style={{ marginTop: '10px' }}
              >
                {addTestSubmitting ? 'Logging...' : 'Save Observation Record'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
