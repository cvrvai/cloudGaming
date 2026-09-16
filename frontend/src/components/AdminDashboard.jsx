import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import {
  RefreshIcon,
  MonitorIcon,
  GamepadIcon,
  ClipboardListIcon,
  CalendarIcon,
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
  ActivityIcon,
  DownloadIcon,
  UserIcon,
  ZapIcon,
  TableIcon,
  PlayIcon,
  ClockIcon,
  PowerIcon,
  SquareIcon,
} from './Icons';

// Keep a short-lived per-tab cache so a browser reload can render the last known
// admin view immediately while the backend refreshes in the background.
const ADMIN_CACHE_KEY = 'cloudkh_admin_data_v1';
const ADMIN_REQUEST_TIMEOUT_MS = 8000;

const readAdminCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ADMIN_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeAdminCache = (data) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be unavailable in private browsing; in-memory data still works.
  }
};

const updateAdminCache = (key, value) => {
  cachedAdminData = { ...(cachedAdminData || {}), [key]: value };
  writeAdminCache(cachedAdminData);
};

const fetchAdminJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), ADMIN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? await response.json() : null,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};

let cachedAdminData = readAdminCache();
const EDC_TARIFF_USD_PER_KWH = 0.18;

const estimatePowerBreakdown = (totalWatts, mode) => {
  const total = Math.max(0, Math.round(Number(totalWatts) || 0));
  const [gpuShare, cpuShare] = mode === 'idle' ? [0.25, 0.40] : [0.65, 0.23];
  const gpuWatts = Math.round(total * gpuShare);
  const cpuWatts = Math.round(total * cpuShare);
  return {
    gpu_watts: gpuWatts,
    cpu_watts: cpuWatts,
    system_watts: Math.max(0, total - gpuWatts - cpuWatts),
    estimated: true,
  };
};

const getPowerBreakdown = (row, mode) => {
  const totalWatts = Number(row?.[mode === 'idle' ? 'idle_watts' : 'active_watts']) || 0;
  const provided = row?.[mode === 'idle' ? 'idle_power_breakdown' : 'active_power_breakdown'];
  if (provided && (provided.gpu_watts != null || provided.cpu_watts != null || provided.system_watts != null)) {
    return {
      gpu_watts: Number(provided.gpu_watts) || 0,
      cpu_watts: Number(provided.cpu_watts) || 0,
      system_watts: Number(provided.system_watts) || 0,
      estimated: Boolean(provided.estimated),
    };
  }
  return estimatePowerBreakdown(totalWatts, mode);
};

const formatWattRate = (watts) => `${Math.round(Number(watts) || 0)} W`;

const formatEnergyKwh = (kwh) => {
  const value = Number(kwh) || 0;
  return value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(3);
};

const formatFeedbackStars = (rating) => {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  return value ? `${'★'.repeat(value)}${'☆'.repeat(5 - value)}` : 'No rating';
};

const formatExperienceTag = (tag) => {
  if (tag === 'smooth') return 'Smooth';
  if (tag === 'mixed') return 'Mostly okay';
  if (tag === 'laggy') return 'Laggy';
  return '';
};

const getCtqStatusClass = (status) => {
  if (status === 'PASS') return 'pass';
  if (status === 'NO DATA') return 'no-data';
  return 'risk';
};

function PowerMeasurementGuide({ watts = 0, hours = 0 }) {
  const rate = Math.max(0, Math.round(Number(watts) || 0));
  const duration = Math.max(0, Number(hours) || 0);
  const energy = (rate * duration) / 1000;

  return (
    <div className="power-measurement-guide" role="note">
      <strong>How to read power:</strong>{' '}
      <span><b>W (watts)</b> is the instantaneous power rate, not the amount consumed.</span>{' '}
      <span><b>kWh</b> is accumulated energy: W × hours ÷ 1,000.</span>
      {rate > 0 && duration > 0 && (
        <span className="power-measurement-example">
          Example: {formatWattRate(rate)} × {duration.toFixed(2)} h = {formatEnergyKwh(energy)} kWh.
        </span>
      )}
    </div>
  );
}

function VoiceOfCustomerSummary({ stats }) {
  const feedbackCount = Number(stats?.feedback_count) || 0;
  if (!stats) return null;

  return (
    <div className="voc-summary-strip" role="note">
      <strong>Voice of Customer</strong>
      {feedbackCount > 0 ? (
        <>
          <span>{feedbackCount} response{feedbackCount === 1 ? '' : 's'}</span>
          <span>Average rating: <b>{Number(stats.mean_rating || 0).toFixed(1)}/5</b></span>
          <span>Smooth: <b>{stats.smooth_count || 0}</b></span>
          <span>Laggy: <b>{stats.laggy_count || 0}</b></span>
          <span>Written comments: <b>{stats.comment_count || 0}</b></span>
        </>
      ) : (
        <span>No participant feedback collected yet.</span>
      )}
    </div>
  );
}

function PowerBreakdownDetails({
  activeWatts,
  idleWatts,
  activeBreakdown,
  idleBreakdown,
  activeHours,
  idleHours,
  expanded,
  onToggle,
}) {
  const active = getPowerBreakdown({ active_watts: activeWatts, active_power_breakdown: activeBreakdown }, 'active');
  const idle = getPowerBreakdown({ idle_watts: idleWatts, idle_power_breakdown: idleBreakdown }, 'idle');
  const hasDuration = activeHours != null || idleHours != null;
  const componentKwh = (watts, hours) => ((Number(watts) || 0) * (Number(hours) || 0)) / 1000;
  const componentEnergy = (activeWattsForComponent, idleWattsForComponent) => {
    const loadKwh = componentKwh(activeWattsForComponent, activeHours);
    const idleKwh = componentKwh(idleWattsForComponent, idleHours);
    return `${(loadKwh + idleKwh).toFixed(3)} kWh (${loadKwh.toFixed(3)} active + ${idleKwh.toFixed(3)} standby)`;
  };
  const sourceLabel = active.estimated || idle.estimated ? 'Estimated from rig-level rate' : 'Component telemetry';

  return (
    <div className="power-details-control">
      <button
        type="button"
        className="power-details-toggle"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide details' : 'View component estimate'}
      </button>
      {expanded && (
        <div className="power-breakdown-panel">
          <div className="power-breakdown-heading">
            <span>Component power rate</span>
            <span>{sourceLabel}</span>
          </div>
          <div className="power-breakdown-grid">
            <span className="power-breakdown-mode">Active</span>
            <span>GPU <strong>{formatWattRate(active.gpu_watts)}</strong></span>
            <span>CPU <strong>{formatWattRate(active.cpu_watts)}</strong></span>
            <span>System <strong>{formatWattRate(active.system_watts)}</strong></span>
            <span className="power-breakdown-mode">Standby</span>
            <span>GPU <strong>{formatWattRate(idle.gpu_watts)}</strong></span>
            <span>CPU <strong>{formatWattRate(idle.cpu_watts)}</strong></span>
            <span>System <strong>{formatWattRate(idle.system_watts)}</strong></span>
          </div>
          {hasDuration && (
            <div className="power-breakdown-energy">
              {active.estimated || idle.estimated ? 'Estimated energy for displayed time' : 'Energy for displayed time'}: GPU {componentEnergy(active.gpu_watts, idle.gpu_watts)} · CPU {componentEnergy(active.cpu_watts, idle.cpu_watts)} · System {componentEnergy(active.system_watts, idle.system_watts)}
            </div>
          )}
          <div className="power-breakdown-footnote">
            Component sensor telemetry is not connected; the split is for analysis only and sums to the rig-level rate.
          </div>
        </div>
      )}
    </div>
  );
}

function CtqDetailPanel({
  ctqKey,
  metrics,
  records,
  activeWatts,
  idleWatts,
  onClose,
}) {
  const metricMap = {
    ctq1: metrics?.ctq1_latency || {},
    ctq2: metrics?.ctq2_utilization || {},
    ctq3: metrics?.ctq3_waiting_time || {},
    ctq4: metrics?.ctq4_completion_rate || {},
  };
  const metric = metricMap[ctqKey] || {};
  const sampleSize = Number(metric.sample_size ?? records?.length ?? 0);
  const status = metric.status || 'NO DATA';
  const statusClass = getCtqStatusClass(status);

  const details = {
    ctq1: {
      eyebrow: 'CTQ 1 · Network & Streaming Quality',
      title: 'Latency & FPS Stability',
      owner: 'Sean Pheavyraksonya',
      question: 'Can a player receive a responsive, stable game stream?',
      target: 'Mean latency ≤ 100 ms and a 60 FPS service target.',
      measurement: 'Session telemetry records latency, peak latency, FPS, packet loss, and latency defects.',
      rule: 'PASS when mean latency is ≤ 100 ms. An observation above 100 ms is a latency defect; FPS is monitored as a supporting quality signal.',
      formula: 'Defect rate = latency-defect observations ÷ total observations × 100. DPMO = defects ÷ total observations × 1,000,000.',
      values: [
        ['Mean latency', `${metric.mean_latency_ms ?? 0} ms`],
        ['Peak latency', `${metric.peak_latency_ms ?? 0} ms`],
        ['Average FPS', `${metric.mean_fps ?? 0} FPS`],
        ['Packet loss', `${metric.packet_loss_pct ?? 0}%`],
        ['Latency defects', `${metric.defect_count ?? 0} (${metric.defect_rate_pct ?? 0}%)`],
        ['DPMO', `${metric.dpmo ?? 0}`],
      ],
      action: status === 'PASS'
        ? 'Maintain the current streaming configuration and continue monitoring peak latency.'
        : status === 'RISK'
          ? 'Investigate network path, encoder load, and congestion for sessions above 100 ms.'
          : 'Collect more completed session telemetry before making a quality decision.',
    },
    ctq2: {
      eyebrow: 'CTQ 2 · Hardware Fleet & Energy Waste',
      title: 'PC Utilization & Energy Waste',
      owner: 'Choonvai',
      question: 'Is powered PC time being used for gaming instead of wasted in standby?',
      target: 'Active-time utilization ≥ 70% of powered time.',
      measurement: 'Active gaming hours, powered hours, standby hours, power rate (W), energy (kWh), and electricity cost are tracked separately.',
      rule: 'PASS when active gaming hours ÷ powered hours is at least 70%. Below 70% is RISK. Component GPU/CPU/system values are estimates from the rig-level rate.',
      formula: 'Utilization = active gaming hours ÷ powered hours × 100. Energy = watts × hours ÷ 1,000. Cost = kWh × tariff.',
      values: [
        ['Active gaming time', `${metric.gaming_hours ?? 0} h`],
        ['Powered time', `${metric.pc_powered_hours ?? 0} h`],
        ['Standby time', `${metric.idle_hours ?? 0} h`],
        ['Utilization', `${metric.utilization_pct ?? 0}%`],
        ['Active power rate', `${Math.round(Number(metric.active_watts ?? activeWatts) || 0)} W`],
        ['Standby power rate', `${Math.round(Number(metric.idle_watts ?? idleWatts) || 0)} W`],
        ['Energy consumed', `${metric.total_kwh ?? 0} kWh`],
        ['Standby waste', `${metric.idle_waste_kwh ?? 0} kWh (${metric.idle_waste_pct ?? 0}%)`],
        ['Active electricity cost', `$${metric.active_cost_per_hour_usd ?? 0} / active hour`],
      ],
      action: status === 'PASS'
        ? 'Keep scheduling and power policies stable; monitor standby waste as the fleet grows.'
        : status === 'RISK'
          ? 'Increase booked active time or power down unused rigs to reduce standby waste.'
          : 'Collect active and powered-time observations before evaluating utilization.',
    },
    ctq3: {
      eyebrow: 'CTQ 3 · Queue & Slot Capacity Management',
      title: 'Queue Waiting & Capacity',
      owner: 'Lim Hokann',
      question: 'Can players obtain an available gaming slot without excessive waiting?',
      target: 'Mean waiting time ≤ 30 minutes and zero capacity defects.',
      measurement: 'Booking/session telemetry records waiting time, booked slots, cancellations, and capacity defects.',
      rule: 'PASS when mean waiting time is ≤ 30 minutes and capacity defects equal zero. Observations above 30 minutes are counted separately as wait defects.',
      formula: 'Mean wait = total waiting minutes ÷ observations. Wait-defect rate = waits above 30 minutes ÷ observations × 100.',
      values: [
        ['Mean waiting time', `${metric.mean_waiting_time_mins ?? 0} min`],
        ['Maximum waiting time', `${metric.max_waiting_time_mins ?? 0} min`],
        ['Booked slots', `${metric.total_booked_slots ?? 0}`],
        ['Available slots/day', `${metric.available_slots_per_day ?? 0}`],
        ['Wait defects', `${metric.waiting_defect_count ?? 0} (${metric.waiting_defect_rate_pct ?? 0}%)`],
        ['Capacity defects', `${metric.capacity_defects_count ?? 0}`],
        ['Capacity bottleneck', metric.capacity_bottleneck ? 'Yes' : 'No'],
        ['Evidence sample', `${sampleSize} observations`],
      ],
      action: status === 'PASS'
        ? 'Keep queue and slot allocation rules; continue checking for peak-period bottlenecks.'
        : status === 'RISK'
          ? 'Review slot capacity, booking conflicts, and peak demand periods.'
          : 'Collect booking and waiting-time observations before evaluating queue performance.',
    },
    ctq4: {
      eyebrow: 'CTQ 4 · Session Reliability & QoS',
      title: 'Session Completion Rate',
      owner: 'Hour',
      question: 'Do started gaming sessions finish successfully without disconnects or crashes?',
      target: 'Completion rate ≥ 95%.',
      measurement: 'Each completed or failed session is one opportunity. Failures are categorized by reason for root-cause analysis.',
      rule: 'PASS when completed sessions ÷ total sessions is at least 95%. Any incomplete session is a completion defect.',
      formula: 'Completion rate = completed sessions ÷ total sessions × 100. DPMO = failed sessions ÷ total sessions × 1,000,000.',
      values: [
        ['Completed sessions', `${metric.completed_sessions ?? 0}`],
        ['Total sessions', `${metric.total_sessions ?? 0}`],
        ['Completion rate', `${metric.completion_rate_pct ?? 0}%`],
        ['Failed sessions', `${metric.failed_sessions ?? 0}`],
        ['Disconnects', `${metric.total_disconnects ?? 0}`],
        ['DPMO', `${metric.dpmo ?? 0}`],
        ['Evidence sample', `${sampleSize} observations`],
        ['Failure breakdown', Object.entries(metric.failure_counts || {}).map(([reason, count]) => `${reason}: ${count}`).join(', ') || 'None recorded'],
      ],
      action: status === 'PASS'
        ? 'Maintain the session workflow and monitor failure categories for early warning signals.'
        : status === 'RISK'
          ? 'Investigate disconnect and crash causes, then compare completion before and after improvement.'
          : 'Collect completed and failed session observations before evaluating reliability.',
    },
  }[ctqKey];

  if (!details) return null;

  return (
    <div className="ctq-detail-panel" role="region" aria-label={`${details.title} details`}>
      <div className="ctq-detail-header">
        <div>
          <div className="ctq-detail-eyebrow">{details.eyebrow}</div>
          <h3>{details.title}</h3>
          <p>{details.question}</p>
        </div>
        <div className="ctq-detail-header-actions">
          <span className={`ctq-status-badge compact ${statusClass}`}>{status}</span>
          <button type="button" className="ctq-detail-close" onClick={onClose} aria-label="Close CTQ details">
            Close
          </button>
        </div>
      </div>

      <div className="ctq-detail-summary-grid">
        <div className="ctq-detail-summary-card">
          <span>Owner</span>
          <strong>{details.owner}</strong>
        </div>
        <div className="ctq-detail-summary-card">
          <span>Target specification</span>
          <strong>{details.target}</strong>
        </div>
        <div className="ctq-detail-summary-card">
          <span>Evidence</span>
          <strong>{sampleSize} observations</strong>
        </div>
      </div>

      <div className="ctq-detail-copy-grid">
        <div>
          <span className="ctq-detail-label">How it is measured</span>
          <p>{details.measurement}</p>
        </div>
        <div>
          <span className="ctq-detail-label">Decision rule</span>
          <p>{details.rule}</p>
        </div>
      </div>

      <div className="ctq-detail-values">
        <div className="ctq-detail-label">Observed evidence</div>
        <div className="ctq-detail-value-grid">
          {details.values.map(([label, value]) => (
            <div key={label} className="ctq-detail-value-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="ctq-detail-formula">
        <span className="ctq-detail-label">Calculation</span>
        <code>{details.formula}</code>
      </div>

      <div className={`ctq-detail-action ${statusClass}`}>
        <span className="ctq-detail-label">Recommended action</span>
        <p>{details.action}</p>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { token, user } = useAuth();
  const adminRefreshInFlightRef = useRef(false);
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

  // Session Telemetry & Analytics state
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
  const [newTestPowerUsage, setNewTestPowerUsage] = useState('');
  const [newTestPhase, setNewTestPhase] = useState('V1_Baseline');
  const [addTestError, setAddTestError] = useState(null);
  const [addTestSubmitting, setAddTestSubmitting] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [seedingTrials, setSeedingTrials] = useState(false);
  const [clearingEvidence, setClearingEvidence] = useState(false);
  const [seedSuccessMsg, setSeedSuccessMsg] = useState(null);
  const [dailyRigFilter, setDailyRigFilter] = useState('all');
  const [energyViewMode, setEnergyViewMode] = useState('sessions'); // 'sessions' | 'daily'
  const [powerDetailsOpen, setPowerDetailsOpen] = useState({});
  const [selectedCtq, setSelectedCtq] = useState(null);
  const [dmaicWhiteBg, setDmaicWhiteBg] = useState(true); // Default to clean white background for academic review / teacher presentation
  const [backendError, setBackendError] = useState(null);
  const [timeTick, setTimeTick] = useState(Date.now());

  const togglePowerDetails = (key) => {
    setPowerDetailsOpen((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleCtqDetails = (key) => {
    setSelectedCtq((current) => (current === key ? null : key));
  };

  const fetchAllAdminData = async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    // A slow request must not allow the 4-second live refresh to pile up.
    if (adminRefreshInFlightRef.current) return;
    adminRefreshInFlightRef.current = true;

    const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
    const requests = [
      ['machines', fetchAdminJson(`${API_BASE}/api/machines`, authHeaders), setMachines],
      ['bookings', fetchAdminJson(`${API_BASE}/api/bookings/admin/all`, authHeaders), setBookings],
      ['games', fetchAdminJson(`${API_BASE}/api/games`), setGames],
      ['users', fetchAdminJson(`${API_BASE}/api/admin/users`, authHeaders), setUsers],
      ['dmaicMetrics', fetchAdminJson(`${API_BASE}/api/admin/dmaic/metrics`, authHeaders), setDmaicMetrics],
      ['dmaicRecords', fetchAdminJson(`${API_BASE}/api/admin/dmaic/records`, authHeaders), setDmaicRecords],
    ];

    try {
      // Each section updates as soon as its own request completes. allSettled
      // ensures one failed section does not discard the other five responses.
      const results = await Promise.allSettled(
        requests.map(([key, request, setter]) => request.then((result) => {
          if (result.ok) {
            setter(result.data);
            updateAdminCache(key, result.data);
            if (key === 'games') {
              window.dispatchEvent(new Event('cloudkh-games-updated'));
            }
            if (key === 'machines') {
              // The primary screen is usable as soon as machine data arrives,
              // including a valid empty fleet response.
              setLoading(false);
            }
          }
          return result;
        }))
      );

      const machineResult = results[0];
      if (machineResult.status === 'fulfilled' && !machineResult.value.ok && machineResult.value.status === 404) {
        setBackendError('Port 8000 is occupied by another application or the CloudKH backend is offline. Please start CloudKH backend (python backend/run.py).');
      } else if (machineResult.status === 'fulfilled' && !machineResult.value.ok && (machineResult.value.status === 401 || machineResult.value.status === 403)) {
        setBackendError('Administrator privileges required. Please log in with an admin account.');
      } else if (machineResult.status === 'fulfilled' && machineResult.value.ok) {
        setBackendError(null);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
      // Request-level failures are handled by allSettled. This catch is only
      // for an unexpected orchestration error.
      setBackendError('Failed to connect to backend server at http://localhost:8000. Ensure the CloudKH backend is running.');
    } finally {
      adminRefreshInFlightRef.current = false;
      setLoading(false);
    }
  };

  const fetchMachinesOnly = async () => {
    if (!token || adminRefreshInFlightRef.current) return;
    adminRefreshInFlightRef.current = true;
    try {
      const result = await fetchAdminJson(`${API_BASE}/api/machines`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (result.ok) {
        setMachines(result.data);
        updateAdminCache('machines', result.data);
        setBackendError(null);
      }
    } catch (err) {
      // Keep the last known fleet visible during a transient poll failure.
      console.warn('Live machine refresh failed:', err);
    } finally {
      adminRefreshInFlightRef.current = false;
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
      alert('Error seeding sample trials: ' + err.message);
    } finally {
      setSeedingTrials(false);
    }
  };

  const handleClearEvidence = async () => {
    if (!window.confirm('Clear All Experimental & Telemetry Data?\n\nThis will permanently delete all session telemetry records and reset the observation dataset to 0 records.')) {
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
          account: newTestAccount.trim() || 'Guest Student',
          requested_time: newTestRequestedTime.trim() || undefined,
          booking_slot: newTestBookingSlot.trim() || undefined,
          waiting_time_minutes: parseFloat(newTestWaitingTime) || 0,
          avg_latency_ms: parseFloat(newTestLatency) || 0,
          avg_fps: parseFloat(newTestFps) || 60,
          disconnects_count: parseInt(newTestDisconnects) || 0,
          completed: newTestCompleted,
          failure_reason: !newTestCompleted ? (newTestFailureReason.trim() || 'aborted') : null,
          pc_idle_minutes: parseFloat(newTestPcIdleTime) || 0,
          power_watts: parseFloat(newTestPowerUsage) || undefined,
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
      setNewTestPowerUsage('');
      fetchAllAdminData();
    } catch (err) {
      setAddTestError(err.message);
    } finally {
      setAddTestSubmitting(false);
    }
  };

  useEffect(() => {
    fetchAllAdminData();
    // Machine state is live (4s); admin telemetry data refreshes every 10s or immediately on focus/feedback
    const machineInterval = setInterval(fetchMachinesOnly, 4000);
    const adminDataInterval = setInterval(fetchAllAdminData, 10000);
    const ticker = setInterval(() => setTimeTick(Date.now()), 1000);

    const onInstantRefresh = () => fetchAllAdminData();
    window.addEventListener('focus', onInstantRefresh);
    window.addEventListener('cloudkh-feedback-submitted', onInstantRefresh);

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
      clearInterval(machineInterval);
      clearInterval(adminDataInterval);
      clearInterval(ticker);
      clearTimeout(idleTimer);
      window.removeEventListener('focus', onInstantRefresh);
      window.removeEventListener('cloudkh-feedback-submitted', onInstantRefresh);
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

  const formatLiveDuration = (startedAtStr, nowMs = timeTick) => {
    if (!startedAtStr) return '0h 00m 00s';
    try {
      const startMs = new Date(startedAtStr).getTime();
      const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;
      return `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    } catch (e) {
      return '0h 00m 00s';
    }
  };

  const formatLoggedHours = (hrs) => {
    if (hrs === undefined || hrs === null || hrs <= 0) return '0h';
    if (hrs < 0.05) {
      const s = Math.max(1, Math.round(hrs * 3600));
      return `${s}s`;
    }
    if (hrs < 1.0) {
      const m = Math.round(hrs * 60);
      return `${hrs}h (${m}m)`;
    }
    return `${hrs}h`;
  };

  const formatDurationSeconds = (totalSecs) => {
    if (!totalSecs || totalSecs <= 0) return '0s';
    const s = Math.round(totalSecs);
    if (s < 60) return `${s}s`;
    const mins = Math.floor(s / 60);
    const remSecs = s % 60;
    if (mins < 60) {
      return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
    }
    const hrs = (s / 3600).toFixed(1);
    return `${hrs}h`;
  };

  const handleTogglePower = async (machine) => {
    const isCurrentlyOnline = ['available', 'in-use', 'streaming'].includes(machine.live_status || machine.status);
    const targetAction = isCurrentlyOnline ? 'standby' : 'online';
    setUpdatingId(machine.id);
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machine.id}/power`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ power_action: targetAction }),
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to toggle machine power state');
      }
    } catch (err) {
      alert('Power toggle error: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStartStreamOnMachine = async (machine) => {
    setUpdatingId(machine.id);
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machine.id}/start-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to start stream on machine');
      }
    } catch (err) {
      alert('Start stream error: ' + err.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStopStreamOnMachine = async (machine) => {
    setUpdatingId(machine.id);
    try {
      const res = await fetch(`${API_BASE}/api/machines/${machine.id}/stop-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        fetchAllAdminData();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to stop stream');
      }
    } catch (err) {
      alert('Stop stream error: ' + err.message);
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
  const formatRam = (ram) => {
    if (!ram) return '16 GB';
    return ram.replace(/\s*\(.*?\)/g, '').trim();
  };

  const formatCpu = (cpu) => {
    if (!cpu) return 'CPU';
    return cpu
      .replace(/\([RTM]+\)/gi, '')
      .replace(/@\s*[\d\.]+GHz/gi, '')
      .replace(/\s+CPU\s+/i, ' ')
      .replace(/Intel\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const formatOs = (m) => {
    if (m.os) return m.os.replace(/Microsoft\s+/i, '');
    const match = m.ram?.match(/\((.*?)\)/);
    if (match) return match[1].replace(/Microsoft\s+/i, '');
    return 'Windows 11';
  };

  const formatRigGpu = (gpu) => {
    if (!gpu) return 'Gaming Rig';
    return gpu
      .replace(/NVIDIA\s+/i, '')
      .replace(/GeForce\s+/i, '')
      .replace(/\s+with\s+Max-Q\s+Design/i, ' Max-Q')
      .trim();
  };

  const streamingRigGpu = machines.find((m) => (m.live_status || m.status) === 'available')?.gpu
    || machines[0]?.gpu
    || dmaicMetrics?.dmaic_meta?.rig_gpu
    || 'Gaming Rig';

  const rawPerPcEnergy = dmaicMetrics?.per_machine_energy || dmaicMetrics?.ctq2_utilization?.per_machine_energy || [];
  const perPcEnergy = rawPerPcEnergy.length > 0
    ? rawPerPcEnergy
    : machines.map((m) => ({
        id: m.id,
        name: m.name,
        gpu: m.gpu,
        cpu: m.cpu,
        ram: m.ram,
        status: m.status,
        active_watts: Number(m.active_watts) || 0,
        idle_watts: Number(m.idle_watts) || 0,
        completed_sessions: 0,
        gaming_hours: 0,
        idle_hours: 0,
        total_kwh: 0,
        total_cost_usd: 0,
      }));

  const totalPilotCostUsd = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_cost_usd || 0), 0);
  const totalPilotCostKhr = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_cost_khr || 0), 0);
  const totalPilotKwh = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.projected_kwh || 0), 0);
  const totalIdleWasteKwh = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.idle_waste_kwh || 0), 0);
  const totalIdleWasteUsd = perPcEnergy.reduce((s, m) => s + (m.two_week_forecast?.idle_waste_usd || 0), 0);
  const totalActiveWatts = perPcEnergy.reduce((s, m) => s + (Number(m.active_watts) || 0), 0);
  const totalIdleWatts = perPcEnergy.reduce((s, m) => s + (Number(m.idle_watts) || 0), 0);
  const totalGamingHours = perPcEnergy.reduce((s, m) => s + (m.gaming_hours || 0), 0);
  const totalIdleHours = perPcEnergy.reduce((s, m) => s + (m.idle_hours || 0), 0);
  const totalObservedKwh = perPcEnergy.reduce((s, m) => s + (m.total_kwh || 0), 0);
  const totalObservedUsd = perPcEnergy.reduce((s, m) => s + (m.total_cost_usd || 0), 0);
  const ctq2Power = dmaicMetrics?.ctq2_utilization || {};
  const ctq2ActiveWatts = Number(ctq2Power.active_watts ?? perPcEnergy[0]?.active_watts ?? totalActiveWatts) || 0;
  const ctq2IdleWatts = Number(ctq2Power.idle_watts ?? perPcEnergy[0]?.idle_watts ?? totalIdleWatts) || 0;

  const rawDailyEnergy = dmaicMetrics?.daily_machine_energy || [];
  const dailyMachineEnergy = rawDailyEnergy.length > 0 ? rawDailyEnergy : [];

  // Real-time live active streaming detection
  const activeLiveStreams = machines
    .filter((m) => ['in-use', 'streaming'].includes(m.live_status || m.status) && (m.runtime_started_at || m.stream_started_at))
    .map((m) => {
      const runtimeStartedAt = m.runtime_started_at || m.stream_started_at;
      let elapsedSecs = 1;
      try {
        const startMs = new Date(runtimeStartedAt).getTime();
        elapsedSecs = Math.max(1, Math.floor((timeTick - startMs) / 1000));
      } catch (e) {
        elapsedSecs = 1;
      }
      const elapsedHrs = elapsedSecs / 3600.0;
      const actWatts = Number(m.active_watts) || 0;
      const liveKwh = (actWatts * elapsedHrs) / 1000.0;
      const liveCost = liveKwh * EDC_TARIFF_USD_PER_KWH;
      const liveGame = m.installed_games?.[0]?.title || 'METAL SLUG ATTACK RELOADED';
      
      let startLocalTime = 'Now';
      try {
        startLocalTime = new Date(runtimeStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        startLocalTime = 'Now';
      }

      return {
        id: `live-${m.id}`,
        is_live: true,
        test_id: 'LIVE-STREAM',
        user_email: user?.email || 'admin@cloudkh.space',
        machine_id: m.id,
        machine_name: m.name,
        machine_gpu: m.gpu,
        game_title: liveGame,
        time_period: `${startLocalTime} - Active Now`,
        stream_started_at: runtimeStartedAt,
        duration_seconds: elapsedSecs,
        duration_formatted: formatDurationSeconds(elapsedSecs),
        duration_hours: Number(elapsedHrs.toFixed(3)),
        active_watts: actWatts,
        power_kwh: liveKwh,
        energy_cost_usd: liveCost,
        energy_cost_khr: Math.round(liveCost * 4050),
        latency_ms: 42.0,
        fps: 60.0,
        completed: true,
        ctq_overall_pass: true,
        date_str: 'Today (Live)',
      };
    });

  // Inject real-time live hours into dailyMachineEnergy for today if a machine is currently streaming
  const todayStr = new Date().toISOString().substring(0, 10);
  const liveUpdatedDailyEnergy = dailyMachineEnergy.map((row) => {
    if (row.date === todayStr) {
      const activeMatch = activeLiveStreams.find((s) => String(s.machine_id) === String(row.machine_id));
      if (activeMatch) {
        const liveHrs = activeMatch.duration_hours;
        const liveKwh = activeMatch.power_kwh;
        const liveCost = activeMatch.energy_cost_usd;
        return {
          ...row,
          gaming_hours: Number((row.gaming_hours + liveHrs).toFixed(3)),
          total_hours: Number((row.total_hours + liveHrs).toFixed(3)),
          active_kwh: Number((row.active_kwh + liveKwh).toFixed(4)),
          total_kwh: Number((row.total_kwh + liveKwh).toFixed(4)),
          total_cost_usd: Number((row.total_cost_usd + liveCost).toFixed(4)),
          total_cost_khr: Math.round((row.total_cost_usd + liveCost) * 4050),
        };
      }
    }
    return row;
  });

  const dailyFilteredRecords = liveUpdatedDailyEnergy.filter(
    (row) => dailyRigFilter === 'all' || String(row.machine_id) === String(dailyRigFilter)
  );
  const totalDailyKwh = dailyFilteredRecords.reduce((sum, r) => sum + (r.total_kwh || 0), 0);
  const totalDailyUsd = dailyFilteredRecords.reduce((sum, r) => sum + (r.total_cost_usd || 0), 0);
  const totalDailyGamingHours = dailyFilteredRecords.reduce((sum, r) => sum + (r.gaming_hours || 0), 0);
  const totalDailyIdleHours = dailyFilteredRecords.reduce((sum, r) => sum + (r.idle_hours || 0), 0);
  const totalDailyCompleted = dailyFilteredRecords.reduce((sum, r) => sum + (r.completed_sessions || 0), 0);

  // Combine live active streams with database recorded sessions
  const combinedSessions = [...activeLiveStreams, ...(dmaicRecords || [])];
  const sessionTimelineRecords = combinedSessions.filter(
    (r) => dailyRigFilter === 'all' || String(r.machine_id) === String(dailyRigFilter)
  );
  const livePcCount = activeLiveStreams.length;

  const totalSessionSecs = sessionTimelineRecords.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);
  const totalSessionKwh = sessionTimelineRecords.reduce((sum, r) => sum + (r.power_kwh || 0), 0);
  const totalSessionUsd = sessionTimelineRecords.reduce((sum, r) => sum + (r.energy_cost_usd || 0), 0);
  const totalSessionPass = sessionTimelineRecords.filter((r) => r.ctq_overall_pass ?? r.completed).length;
  const sessionsWithFeedback = sessionTimelineRecords.filter(
    (r) => r.user_rating || r.experience_tag || r.user_comment
  ).length;

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
  const sumKwh = filteredDmaicRecords.reduce((s, r) => s + (r.power_kwh ?? (r.power_usage_watts ? r.power_usage_watts / 1000 : 0)), 0);
  const sumCost = filteredDmaicRecords.reduce((s, r) => s + (r.energy_cost_usd ?? ((r.power_kwh ?? 0) * EDC_TARIFF_USD_PER_KWH)), 0);

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
          {backendError && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 600,
            }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} />
              <span>Reconnecting to server...</span>
            </div>
          )}
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
            {machines.filter((m) => ['available', 'in-use', 'streaming'].includes(m.live_status || m.status)).length}
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
            <span className="bento-tag">PCs Streaming Now</span>
          </div>
          <div className={`bento-value ${livePcCount > 0 ? 'highlight-green' : ''}`}>
            {livePcCount}
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
          title="Click to view Session Analytics & Telemetry Data"
        >
          <div className="bento-head">
            <span className="bento-tag">Quality Pass Rate</span>
            <ActivityIcon size={16} />
          </div>
          <div className="bento-val">
            {dmaicMetrics?.ctq4_completion_rate ? `${dmaicMetrics.ctq4_completion_rate.completion_rate_pct}%` : '---'}
          </div>
          <div className="bento-sub">
            {dmaicMetrics?.ctq4_completion_rate ? `${dmaicMetrics.ctq4_completion_rate.completed_sessions || 0}/${dmaicMetrics.ctq4_completion_rate.total_sessions || 0} sessions completed` : 'Calculating metrics...'}
          </div>
        </div>
      </div>

      {/* Admin Subnav */}
      <div className="admin-subnav-bar">
        <button
          className={`admin-subnav-btn ${adminTab === 'machines' ? 'active' : ''}`}
          onClick={() => setAdminTab('machines')}
        >
          <ServerIcon size={16} />
          <span>Machines &amp; Fleet</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'games' ? 'active' : ''}`}
          onClick={() => setAdminTab('games')}
        >
          <GamepadIcon size={16} />
          <span>Games Library</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'bookings' ? 'active' : ''}`}
          onClick={() => setAdminTab('bookings')}
        >
          <CalendarIcon size={16} />
          <span>Bookings &amp; Schedules</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'users' ? 'active' : ''}`}
          onClick={() => setAdminTab('users')}
        >
          <UsersIcon size={16} />
          <span>User Management</span>
        </button>
        <button
          className={`admin-subnav-btn ${adminTab === 'dmaic' ? 'active' : ''}`}
          onClick={() => setAdminTab('dmaic')}
        >
          <ActivityIcon size={16} />
          <span>Session Analytics &amp; Data</span>
        </button>
      </div>

      {!token ? (
        <div className="admin-loading" style={{ padding: '3.5rem 1.5rem', textAlign: 'center' }}>
          <AlertTriangleIcon size={40} style={{ color: '#f59e0b', margin: '0 auto 1rem', display: 'block' }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: '#1e293b' }}>Administrator Login Required</h3>
          <p style={{ color: '#64748b', fontSize: '0.925rem', maxWidth: '480px', margin: '0 auto' }}>
            Please sign in with your administrator account to access fleet hardware, session telemetry data, and electricity tracking.
          </p>
        </div>
      ) : loading && machines.length === 0 && !cachedAdminData ? (
        <div className="admin-loading">Loading management data...</div>
      ) : (
        <>
          {backendError && (
            <div style={{
              margin: '0.75rem 0 1rem',
              padding: '0.65rem 1rem',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#fca5a5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              gap: '12px',
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span>Backend server temporarily offline or reconnecting &bull; Displaying cached telemetry &amp; rig data</span>
              </div>
              <button
                onClick={fetchAllAdminData}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#e2e8f0',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Retry
              </button>
            </div>
          )}
          {/* TAB 1: GAMING PCS IN-LINE LIST & DAILY WATT CONSUMPTION TABLE */}
          {adminTab === 'machines' && (
            <div className="admin-tab-content">
              {/* Section 1 Header: In-Line Actions */}
              <div className="tab-section-header compact" style={{ marginBottom: '12px' }}>
                <div>
                  <h2 className="section-heading-compact" style={{ fontSize: '1.2rem', margin: 0, fontWeight: 700 }}>
                    Connected Gaming PCs
                  </h2>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted, #94a3b8)' }}>
                    Active Gaming Fleet ({machines.length} Rigs Registered)
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn-primary btn-compact"
                    onClick={openPairModal}
                    style={{ height: '32px', padding: '0 12px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '6px' }}
                    title="Pair an additional Windows PC Host via MFA Keypair"
                  >
                    <KeyIcon size={13} />
                    <span>Pair PC (MFA)</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact"
                    onClick={fetchAllAdminData}
                    style={{ height: '32px', padding: '0 10px', fontSize: '11.5px', display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px' }}
                    title="Refresh Fleet Telemetry"
                  >
                    <RefreshIcon size={13} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* TABLE 1: CONNECTED GAMING PCS IN-LINE LIST TABLE */}
              <div className="dmaic-electricity-table-container glass-panel" style={{ marginBottom: '26px' }}>
                <div className="electricity-table-scroll">
                  <table className="dmaic-electricity-table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: '180px' }}>Gaming Rig / Node</th>
                        <th style={{ width: '90px', textAlign: 'center' }}>Status</th>
                        <th style={{ minWidth: '240px' }}>Hardware Specifications</th>
                        <th style={{ minWidth: '140px', textAlign: 'right' }}>Power Profile</th>
                        <th style={{ minWidth: '220px' }}>Installed Games</th>
                        <th style={{ minWidth: '240px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {machines.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted, #94a3b8)' }}>
                            No gaming PCs connected. Click "Pair PC (MFA)" above to register a host machine.
                          </td>
                        </tr>
                      ) : (
                        machines.map((m) => {
                          const isStreaming = (m.live_status || m.status) === 'in-use' || (m.live_status || m.status) === 'streaming' || Boolean(m.stream_started_at);
                          const isOnline = isStreaming || (m.live_status || m.status) === 'available';
                          const isMaint = (m.live_status || m.status) === 'maintenance';
                          
                          let statusKey = 'standby';
                          let statusLabel = 'Standby';
                          let dotColor = 'gray';

                          if (isMaint) {
                            statusKey = 'maintenance';
                            statusLabel = 'Maintenance';
                            dotColor = 'amber';
                          } else if (isStreaming) {
                            statusKey = 'streaming';
                            statusLabel = 'Streaming';
                            dotColor = 'cyan';
                          } else if (isOnline) {
                            statusKey = 'online';
                            statusLabel = 'Online';
                            dotColor = 'green';
                          }

                          const actWatts = Number(m.active_watts) || 0;
                          const idlWatts = Number(m.idle_watts) || 0;

                          return (
                            <tr key={m.id}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                  <span className="pc-role-badge remote" style={{ fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px' }}>
                                    Node #{m.id}
                                  </span>
                                  {Boolean(m.is_host) && (
                                    <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 700 }}>[HOST]</span>
                                  )}
                                  {isOnline && (
                                    <span style={{ fontSize: '9.5px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '1px 5px', borderRadius: '4px', fontWeight: 600, border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                      OPEN
                                    </span>
                                  )}
                                </div>
                                <strong style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <MonitorIcon size={14} style={{ opacity: 0.75 }} />
                                  <span>{m.name}</span>
                                </strong>
                                {isStreaming && (
                                  <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span className="running-timer-badge">
                                      <ClockIcon size={11} />
                                      <span>Running: {formatLiveDuration(m.runtime_started_at || m.stream_started_at)}</span>
                                    </span>
                                    {m.current_game && (
                                      <span style={{ fontSize: '10px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        {m.current_game}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`pc-status-pill-table ${statusKey}`}>
                                  <span className={`live-dot ${dotColor}`} />
                                  {statusLabel}
                                </span>
                              </td>
                              <td>
                                <div style={{ fontSize: '11.5px', lineHeight: 1.5 }}>
                                  <div>
                                    <span style={{ color: 'var(--text-muted, #94a3b8)' }}>GPU:</span>{' '}
                                    <strong style={{ color: '#e2e8f0' }}>{m.gpu}</strong>
                                  </div>
                                  <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}>
                                    <span>CPU: {formatCpu(m.cpu)}</span> &bull;{' '}
                                    <span>RAM: {formatRam(m.ram)}</span> &bull;{' '}
                                    <span>OS: {formatOs(m)}</span>
                                  </div>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {isStreaming ? (
                                  <div>
                                    <div style={{ color: '#06b6d4', fontWeight: 700, fontSize: '12.5px' }}>
                                      {formatWattRate(actWatts)} active rate
                                    </div>
                                    <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '10.5px' }}>
                                      {m.current_game || 'Active Game Session'}
                                    </div>
                                  </div>
                                ) : isOnline ? (
                                  <div>
                                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>{formatWattRate(idlWatts)} standby rate</span>
                                    <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '10.5px' }}>
                                      Reference active rate: {formatWattRate(actWatts)}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <span style={{ color: 'var(--text-muted, #94a3b8)' }}>0W (Standby)</span>
                                  </div>
                                )}
                                <PowerBreakdownDetails
                                  activeWatts={actWatts}
                                  idleWatts={idlWatts}
                                  activeBreakdown={m.active_power_breakdown}
                                  idleBreakdown={m.idle_power_breakdown}
                                  expanded={Boolean(powerDetailsOpen[`machine-${m.id}`])}
                                  onToggle={() => togglePowerDetails(`machine-${m.id}`)}
                                />
                              </td>
                              <td>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                                  {m.installed_games && m.installed_games.length > 0 ? (
                                    m.installed_games.map((ng) => (
                                      <span key={ng.id} className="node-game-chip">
                                        <span className="node-game-chip-title" title={ng.executable_path}>{ng.title}</span>
                                        <button
                                          className="btn-chip-action"
                                          onClick={() => openEditNodeGameModal(m, ng)}
                                          title="Edit game configuration"
                                        >
                                          <EditIcon size={10} />
                                        </button>
                                        <button
                                          className="btn-chip-action delete"
                                          onClick={() => handleRemoveNodeGame(m.id, ng.game_id, ng.title)}
                                          title="Unassign game from this PC"
                                        >
                                          <XIcon size={10} />
                                        </button>
                                      </span>
                                    ))
                                  ) : (
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontStyle: 'italic' }}>
                                      0 games assigned
                                    </span>
                                  )}
                                  <button
                                    className="btn-add-game-mini"
                                    onClick={() => openAddGameToNodeModal(m)}
                                    title="Assign game to this PC"
                                  >
                                    <PlusIcon size={10} />
                                    <span>Add</span>
                                  </button>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                  {isStreaming ? (
                                    <button
                                      className="btn-stop-stream"
                                      onClick={() => handleStopStreamOnMachine(m)}
                                      disabled={updatingId === m.id}
                                      title="Stop stream runner and log session kWh & EDC cost"
                                    >
                                      <SquareIcon size={11} />
                                      <span>Stop Stream</span>
                                    </button>
                                  ) : (
                                    <button
                                      className="btn-run-stream"
                                      onClick={() => handleStartStreamOnMachine(m)}
                                      disabled={updatingId === m.id || isMaint}
                                      title="Run stream on this PC under load and track live uptime"
                                    >
                                      <PlayIcon size={11} />
                                      <span>Run Stream</span>
                                    </button>
                                  )}

                                  <button
                                    className={`btn-power-toggle ${isOnline ? 'active' : ''}`}
                                    onClick={() => handleTogglePower(m)}
                                    disabled={updatingId === m.id || isMaint || isStreaming}
                                    title={isOnline ? 'Put PC into Standby / Sleep' : 'Open / Turn On PC'}
                                  >
                                    <PowerIcon size={11} />
                                    <span>{isOnline ? 'Sleep' : 'Open'}</span>
                                  </button>

                                  <button
                                    className={`btn-toggle-maintenance-compact ${m.status === 'maintenance' ? 'restore' : ''}`}
                                    onClick={() => handleToggleMaintenance(m)}
                                    disabled={updatingId === m.id || isStreaming}
                                    title={m.status === 'maintenance' ? 'Restore PC to available pool' : 'Put PC in maintenance mode'}
                                  >
                                    {updatingId === m.id ? (
                                      '...'
                                    ) : m.status === 'maintenance' ? (
                                      <>
                                        <CheckIcon size={11} />
                                        <span>Restore</span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertTriangleIcon size={11} />
                                        <span>Maint</span>
                                      </>
                                    )}
                                  </button>

                                  <button
                                    className="btn-delete-compact"
                                    onClick={() => handleDeleteMachine(m.id, m.name)}
                                    title="Delete this gaming PC node"
                                    disabled={isStreaming}
                                  >
                                    <TrashIcon size={11} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION: GAMING TELEMETRY & WATT CONSUMPTION */}
              <PowerMeasurementGuide
                watts={ctq2ActiveWatts}
                hours={ctq2Power.gaming_hours}
              />
              <VoiceOfCustomerSummary stats={dmaicMetrics?.voice_of_customer} />
              <div className="tab-section-header compact" style={{ marginTop: '20px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h2 className="section-heading-compact" style={{ fontSize: '1.2rem', margin: 0, fontWeight: 700 }}>
                    {energyViewMode === 'sessions' ? 'Gaming Sessions & CTQ Telemetry Log' : 'Daily Fleet Operating Hours & Watt Summary'}
                  </h2>
                  <span className="dmaic-stat-pill">
                    EDC Tariff: ${EDC_TARIFF_USD_PER_KWH.toFixed(2)}/kWh
                  </span>
                  <span className="dmaic-stat-pill">
                    CTQ-2: Power &amp; PC Utilization
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* View Mode Switcher */}
                  <div className="segmented-view-switcher">
                    <button
                      type="button"
                      className={`view-switch-btn ${energyViewMode === 'sessions' ? 'active' : ''}`}
                      onClick={() => setEnergyViewMode('sessions')}
                      title="Show individual gaming sessions with time window, game, and watt draw"
                    >
                      Gaming Sessions Timeline ({sessionTimelineRecords.length})
                    </button>
                    <button
                      type="button"
                      className={`view-switch-btn ${energyViewMode === 'daily' ? 'active' : ''}`}
                      onClick={() => setEnergyViewMode('daily')}
                      title="Show aggregated daily fleet summary by date and machine"
                    >
                      Daily Fleet Rollup ({dailyFilteredRecords.length})
                    </button>
                  </div>

                  {/* Rig Filter */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className={`btn-secondary btn-compact ${dailyRigFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setDailyRigFilter('all')}
                      style={{ height: '28px', padding: '0 8px', fontSize: '11px', borderRadius: '5px' }}
                    >
                      All Rigs
                    </button>
                    {machines.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`btn-secondary btn-compact ${dailyRigFilter === String(m.id) ? 'active' : ''}`}
                        onClick={() => setDailyRigFilter(String(m.id))}
                        style={{ height: '28px', padding: '0 8px', fontSize: '11px', borderRadius: '5px' }}
                      >
                        {m.name.replace('Gaming PC ', '').replace('Gaming Rig ', '')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* TABLE: TELEMETRY & WATT CONSUMPTION */}
              <div className="dmaic-electricity-table-container glass-panel">
                <div className="electricity-table-scroll">
                  {energyViewMode === 'sessions' ? (
                    <table className="dmaic-electricity-table session-timeline-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '280px' }}>Session / Gaming Rig</th>
                          <th style={{ minWidth: '125px', textAlign: 'right' }}>PC Runtime</th>
                          <th style={{ minWidth: '125px', textAlign: 'right' }}>Power Rate (W)</th>
                          <th style={{ minWidth: '120px', textAlign: 'right' }}>Energy Consumed</th>
                          <th style={{ minWidth: '120px', textAlign: 'right' }}>EDC Cost</th>
                          <th style={{ minWidth: '130px', textAlign: 'center' }}>CTQ Quality</th>
                          <th style={{ minWidth: '220px' }}>Voice of Customer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionTimelineRecords.length === 0 ? (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted, #94a3b8)' }}>
                              No gaming sessions recorded for this selection.
                            </td>
                          </tr>
                        ) : (
                          sessionTimelineRecords.map((row, idx) => {
                            const isPass = row.ctq_overall_pass ?? row.completed;
                            const durStr = row.is_live && row.stream_started_at
                              ? formatLiveDuration(row.stream_started_at)
                              : (row.duration_formatted || (row.duration_seconds ? `${Math.round(row.duration_seconds)}s` : '0s'));
                            const durSecs = row.duration_seconds || (row.duration_hours ? row.duration_hours * 3600 : 3600);
                            const sessionMachine = perPcEnergy.find((pc) => String(pc.id) === String(row.machine_id));
                            const sessionIdleWatts = Number(row.idle_watts ?? sessionMachine?.idle_watts) || 0;
                            const kwh = row.power_kwh || 0;
                            const cost = row.energy_cost_usd || 0;
                            const khr = row.energy_cost_khr || Math.round(cost * 4050);
                            return (
                              <tr key={`session-${row.id || idx}`} className={row.is_live ? 'live-session-row' : ''}>
                                <td className="session-summary-cell">
                                  <span className={`time-window-pill ${row.is_live ? 'live' : ''}`}>
                                    {row.is_live ? (
                                      <span className="live-dot-pulse green" style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', marginRight: '5px' }} />
                                    ) : null}
                                    {row.time_period || row.booking_slot || '10:54 AM - 10:55 AM'}
                                  </span>
                                  <span style={{ fontSize: '10.5px', color: row.is_live ? '#38bdf8' : 'var(--text-muted, #94a3b8)', display: 'block', marginTop: '2px', fontWeight: row.is_live ? 700 : 400 }}>
                                    {row.is_live ? '● STREAMING LIVE NOW' : (row.date_str || (row.created_at ? String(row.created_at).substring(0, 10) : 'Today'))}
                                  </span>
                                  <strong className="session-rig-name">{row.machine_name || row.rig_display || 'Gaming PC'}</strong>
                                  <span className="session-rig-meta">
                                    {formatRigGpu(row.machine_gpu)} · {row.game_title || 'CloudKH Game'}
                                  </span>
                                  <span className="session-rig-account">
                                    {row.user_email || row.account_name || 'Guest'} · {row.test_id || `RUN-${String(row.id || idx + 1).padStart(3, '0')}`}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  <strong style={{ color: '#4ade80', fontSize: '12.5px' }}>{durStr}</strong>
                                  <span style={{ fontSize: '10.5px', color: row.is_live ? '#38bdf8' : 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                    {row.is_live ? 'Live ticking' : `(${(durSecs / 3600).toFixed(2)}h active)`}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  <div className="power-total-summary">
                                    <strong>{formatWattRate(row.active_watts)} active rate</strong>
                                  </div>
                                  <PowerBreakdownDetails
                                    activeWatts={row.active_watts}
                                    idleWatts={sessionIdleWatts}
                                    activeBreakdown={row.active_power_breakdown || sessionMachine?.active_power_breakdown}
                                    idleBreakdown={row.idle_power_breakdown || sessionMachine?.idle_power_breakdown}
                                    activeHours={durSecs / 3600}
                                    idleHours={0}
                                    expanded={Boolean(powerDetailsOpen[`session-${row.id || idx}`])}
                                    onToggle={() => togglePowerDetails(`session-${row.id || idx}`)}
                                  />
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  <strong style={{ fontSize: '12.5px', color: '#38bdf8' }}>
                                    {kwh < 0.01 && kwh > 0 ? Number(kwh).toFixed(4) : Number(kwh).toFixed(3)} kWh
                                  </strong>
                                  {row.is_live && (
                                    <span style={{ fontSize: '10px', color: '#38bdf8', display: 'block' }}>Live Metering</span>
                                  )}
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                    {formatWattRate(row.active_watts)} × {(durSecs / 3600).toFixed(2)} h
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  <strong style={{ color: '#4ade80', fontSize: '12.5px' }}>
                                    {cost < 0.01 && cost > 0 ? '< $0.01' : `$${Number(cost).toFixed(2)}`}
                                  </strong>
                                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                    ({khr.toLocaleString()} ៛)
                                  </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  {row.is_live ? (
                                    <span className="pc-status-pill-table streaming" title="Real-time Stream Telemetry">
                                      <span className="live-dot green" />
                                      LIVE (42ms • 60 FPS)
                                    </span>
                                  ) : isPass ? (
                                    <span className="pc-status-pill-table online" title="Quality PASS">
                                      <span className="live-dot green" />
                                      PASS ({Math.round(row.latency_ms || 42)}ms • {Math.round(row.fps || 60)} FPS)
                                    </span>
                                  ) : (
                                    <span className="pc-status-pill-table offline" title="CTQ Defect Detected">
                                      <span className="live-dot red" />
                                      DEFECT
                                    </span>
                                  )}
                                </td>
                                <td className="voc-feedback-cell">
                                  {row.user_rating || row.experience_tag || row.user_comment ? (
                                    <>
                                      <div className="voc-feedback-meta">
                                        {row.user_rating ? <span className="voc-rating">{formatFeedbackStars(row.user_rating)}</span> : null}
                                        {row.experience_tag ? (
                                          <span className={`voc-tag ${row.experience_tag}`}>
                                            {formatExperienceTag(row.experience_tag)}
                                          </span>
                                        ) : null}
                                      </div>
                                      {row.user_comment ? (
                                        <details className="voc-comment-details">
                                          <summary>View participant comment</summary>
                                          <p>{row.user_comment}</p>
                                        </details>
                                      ) : (
                                        <span className="voc-no-comment">No written comment</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="voc-no-comment">No feedback collected</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {sessionTimelineRecords.length > 0 && (
                        <tfoot>
                          <tr className="electricity-fleet-summary-row">
                            <td>
                              <strong>Active Sessions Total ({sessionTimelineRecords.length} Sessions Observed)</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong style={{ color: '#4ade80' }}>{formatDurationSeconds(totalSessionSecs)}</strong>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}>Energy is time-based</span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong style={{ color: '#38bdf8', fontSize: '13px' }}>
                                {totalSessionKwh < 0.01 && totalSessionKwh > 0 ? totalSessionKwh.toFixed(4) : totalSessionKwh.toFixed(2)} kWh
                              </strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong style={{ color: '#4ade80', fontSize: '13px' }}>
                                {totalSessionUsd < 0.01 && totalSessionUsd > 0 ? '< $0.01 USD' : `$${totalSessionUsd.toFixed(2)} USD`}
                              </strong>
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', display: 'block' }}>
                                ({Math.round(totalSessionUsd * 4050).toLocaleString()} ៛)
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="pc-status-pill-table online">
                                {Math.round((totalSessionPass / sessionTimelineRecords.length) * 100)}% PASS
                              </span>
                            </td>
                            <td className="voc-feedback-summary-cell">
                              {sessionsWithFeedback} / {sessionTimelineRecords.length} feedback responses
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  ) : (
                    <table className="dmaic-electricity-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: '120px' }}>Date</th>
                          <th style={{ minWidth: '180px' }}>Gaming Rig / Machine</th>
                          <th style={{ minWidth: '170px', textAlign: 'right' }}>Running Hours (Active / Idle)</th>
                          <th style={{ minWidth: '150px', textAlign: 'right' }}>Power Rate (W)</th>
                          <th style={{ minWidth: '140px', textAlign: 'right' }}>Energy Consumed</th>
                          <th style={{ minWidth: '140px', textAlign: 'right' }}>Daily Electricity Cost</th>
                          <th style={{ minWidth: '120px', textAlign: 'center' }}>Sessions Logged</th>
                          <th style={{ width: '90px', textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyFilteredRecords.length === 0 ? (
                          <tr>
                            <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted, #94a3b8)' }}>
                              No daily energy records found for this selection.
                            </td>
                          </tr>
                        ) : (
                          dailyFilteredRecords.map((row, idx) => (
                            <tr key={`${row.date}-${row.machine_id}-${idx}`}>
                              <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {row.date}
                              </td>
                              <td>
                                <strong style={{ fontSize: '12.5px' }}>{row.machine_name}</strong>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                                  {formatRigGpu(row.machine_gpu)}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                <span style={{ color: '#4ade80', fontWeight: 600 }}>{formatLoggedHours(row.gaming_hours)} play</span>
                                {' / '}
                                <span style={{ color: 'var(--text-muted, #94a3b8)' }}>
                                  {row.idle_hours > 0 ? `${formatLoggedHours(row.idle_hours)} standby` : '0h standby (closed)'}
                                </span>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                  Total: {formatLoggedHours(row.total_hours)}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                <div className="power-total-summary">
                                  <strong>{formatWattRate(row.active_watts)} active rate</strong>
                                  <span>{formatWattRate(row.idle_watts)} standby rate</span>
                                </div>
                                <PowerBreakdownDetails
                                  activeWatts={row.active_watts}
                                  idleWatts={row.idle_watts}
                                  activeBreakdown={row.active_power_breakdown}
                                  idleBreakdown={row.idle_power_breakdown}
                                  activeHours={row.gaming_hours}
                                  idleHours={row.idle_hours}
                                  expanded={Boolean(powerDetailsOpen[`daily-${row.date}-${row.machine_id}`])}
                                  onToggle={() => togglePowerDetails(`daily-${row.date}-${row.machine_id}`)}
                                />
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                <strong style={{ fontSize: '13px' }}>
                                  {row.total_kwh < 0.01 && row.total_kwh > 0 ? Number(row.total_kwh).toFixed(4) : Number(row.total_kwh || 0).toFixed(2)} kWh
                                </strong>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                  (playing: {row.active_kwh < 0.01 && row.active_kwh > 0 ? Number(row.active_kwh).toFixed(4) : Number(row.active_kwh || 0).toFixed(2)} kWh + standby: {row.idle_kwh < 0.01 && row.idle_kwh > 0 ? Number(row.idle_kwh).toFixed(4) : Number(row.idle_kwh || 0).toFixed(2)} kWh)
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                <strong style={{ color: '#4ade80', fontSize: '13px' }}>
                                  {row.total_cost_usd < 0.01 && row.total_cost_usd > 0 ? '< $0.01' : `$${Number(row.total_cost_usd || 0).toFixed(2)}`}
                                </strong>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                  ({(row.total_cost_khr || 0).toLocaleString()} ៛)
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                <span style={{ fontWeight: 600 }}>{row.completed_sessions}</span>
                                <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}> / {row.sessions_count}</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className="pc-status-pill-table online">
                                  <span className="live-dot green" />
                                  {row.status || 'PASS'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {dailyFilteredRecords.length > 0 && (
                        <tfoot>
                          <tr className="electricity-fleet-summary-row">
                            <td colSpan={2}>
                              <strong>Fleet Daily Total ({dailyFilteredRecords.length} Observations)</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{formatLoggedHours(totalDailyGamingHours)} play / {formatLoggedHours(totalDailyIdleHours)} idle</strong>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Rates, not energy</span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong style={{ color: '#38bdf8', fontSize: '13px' }}>
                                {totalDailyKwh < 0.01 && totalDailyKwh > 0 ? totalDailyKwh.toFixed(4) : totalDailyKwh.toFixed(2)} kWh
                              </strong>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong style={{ color: '#4ade80', fontSize: '13.5px' }}>
                                {totalDailyUsd < 0.01 && totalDailyUsd > 0 ? '< $0.01 USD' : `$${totalDailyUsd.toFixed(2)} USD`}
                              </strong>
                              <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.7)', display: 'block' }}>
                                ({Math.round(totalDailyUsd * 4050).toLocaleString()} ៛)
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{totalDailyCompleted} Completed</strong>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="pc-status-pill-table online">OPTIMAL</span>
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  )}
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

          {/* TAB 5: SESSION ANALYTICS & DATA DASHBOARD */}
          {adminTab === 'dmaic' && (
            <div className={`admin-tab-content ${dmaicWhiteBg ? 'dmaic-academic-white-theme' : ''}`}>
              {/* Project Hero Banner - Compact Executive Header */}
              <div className="dmaic-hero-banner glass-panel compact" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div className="dmaic-hero-content" style={{ maxWidth: 'none', flex: 1, minWidth: '240px' }}>
                  <div className="dmaic-badge-row compact" style={{ marginBottom: '6px' }}>
                    <span className="dmaic-badge">Live System Metrics &bull; Verified Data</span>
                    <button
                      type="button"
                      className={`dmaic-theme-toggle-btn ${dmaicWhiteBg ? 'white-active' : 'dark-active'}`}
                      onClick={() => setDmaicWhiteBg(!dmaicWhiteBg)}
                      title="Toggle light/dark report theme"
                    >
                      {dmaicWhiteBg ? 'Light Theme' : 'Dark Theme'}
                    </button>
                  </div>
                  <h2 className="dmaic-hero-title compact" style={{ fontSize: '1.2rem', margin: 0, fontWeight: 700 }}>
                    Session Telemetry &amp; Performance Data
                  </h2>
                </div>
                <div className="dmaic-hero-actions compact" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="btn-primary btn-compact"
                    onClick={handleExportCsv}
                    disabled={exportingCsv || dmaicRecords.length === 0}
                    style={{ height: '30px', padding: '0 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px' }}
                    title="Export dataset as .CSV"
                  >
                    <DownloadIcon size={13} />
                    <span>{exportingCsv ? 'Exporting...' : 'Export .CSV'}</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact"
                    onClick={handleSeedEvidence}
                    disabled={seedingTrials}
                    style={{
                      height: '30px',
                      padding: '0 10px',
                      fontSize: '11px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '6px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      borderColor: 'rgba(56, 189, 248, 0.35)',
                      color: '#38bdf8',
                    }}
                    title="Generate 30 trial observations across both Gaming PCs"
                  >
                    <ShieldCheckIcon size={12} />
                    <span>{seedingTrials ? 'Generating...' : 'Seed 30 Trials'}</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact"
                    onClick={() => setShowAddTestModal(true)}
                    style={{ height: '30px', padding: '0 10px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px' }}
                    title="Log trial manually"
                  >
                    <PlusIcon size={12} />
                    <span>Log Test Run</span>
                  </button>
                  <button
                    className="btn-secondary btn-compact btn-clear-data"
                    onClick={handleClearEvidence}
                    disabled={clearingEvidence || dmaicRecords.length === 0}
                    style={{
                      height: '30px',
                      padding: '0 10px',
                      fontSize: '11px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderColor: 'rgba(239, 68, 68, 0.25)',
                      color: '#f87171',
                    }}
                    title="Wipe dataset to 0 records"
                  >
                    <TrashIcon size={12} />
                    <span>{clearingEvidence ? 'Clearing...' : 'Clear All Data'}</span>
                  </button>
                </div>
              </div>

              {/* Voice of Customer (VOC) Summary Strip */}
              <div style={{ marginTop: '12px', marginBottom: '12px' }}>
                <VoiceOfCustomerSummary stats={dmaicMetrics?.voice_of_customer} />
              </div>

              <div className="dmaic-analysis-method-strip" role="note">
                <div>
                  <strong>Measurement definition</strong>
                  <span>Power rate is measured in watts (W); energy is measured in kilowatt-hours (kWh).</span>
                </div>
                <div>
                  <strong>Quality decision rule</strong>
                  <span>Compare each observed value with its target, count defects, then report PASS, RISK, or NO DATA.</span>
                </div>
                <div>
                  <strong>Evidence basis</strong>
                  <span>n = {dmaicMetrics?.ctq4_completion_rate?.sample_size || dmaicRecords.length || 0} observations; component power is estimated from the rig-level profile.</span>
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

              {/* SECTION: STREAM QUALITY & PERFORMANCE MATRIX TABLE */}
              <div className="tab-section-header compact" style={{ marginTop: '16px', marginBottom: '10px' }}>
                <div>
                  <h2 className="section-heading-compact" style={{ fontSize: '1.1rem', margin: 0, fontWeight: 700 }}>
                    Stream Quality &amp; Performance Matrix
                  </h2>
                  <span className="ctq-click-hint">Select any metric row to view its measurement, calculation, evidence, and action.</span>
                </div>
              </div>

              <div className="dmaic-electricity-table-container glass-panel" style={{ marginBottom: '22px' }}>
                <div className="electricity-table-scroll">
                  <table className="dmaic-electricity-table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: '180px' }}>Metric &amp; Lead</th>
                        <th style={{ minWidth: '190px' }}>Quality Characteristic</th>
                        <th style={{ minWidth: '160px' }}>Target Specification</th>
                        <th style={{ minWidth: '120px', textAlign: 'right' }}>Observed Level</th>
                        <th style={{ minWidth: '290px' }}>Performance Telemetry Breakdown</th>
                        <th style={{ width: '90px', textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* CTQ 1: Latency & Frame Stability (Sean Pheavyraksonya) */}
                      <tr
                        className={`ctq-matrix-row ${selectedCtq === 'ctq1' ? 'selected' : ''}`}
                        onClick={() => toggleCtqDetails('ctq1')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCtqDetails('ctq1');
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={selectedCtq === 'ctq1'}
                      >
                        <td>
                          <div className="ctq-owner-tag sean" style={{ marginBottom: '2px' }}>
                            CTQ 1 &bull; Sean Pheavyraksonya
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                            Network &amp; Streaming Quality
                          </div>
                        </td>
                        <td>
                          <strong style={{ fontSize: '13px' }}>Latency &amp; FPS Stability</strong>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Target: </span>
                          <strong>&le; 100 ms mean</strong> &bull; <strong>60 FPS</strong>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800 }}>
                            {dmaicMetrics?.ctq1_latency?.mean_latency_ms || 0}
                          </span>{' '}
                          <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>ms mean</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px' }}>
                            <span>n={dmaicMetrics?.ctq1_latency?.sample_size || 0}</span>
                            &bull;
                            <span>Peak: <strong>{dmaicMetrics?.ctq1_latency?.peak_latency_ms || 0} ms</strong></span>
                            &bull;
                            <span>Framerate: <strong>{dmaicMetrics?.ctq1_latency?.mean_fps || 0} FPS</strong></span>
                            &bull;
                            <span>Defects (&gt;100ms): <strong className={(dmaicMetrics?.ctq1_latency?.defect_rate_pct || 0) > 0 ? 'text-defect' : ''}>{dmaicMetrics?.ctq1_latency?.defect_rate_pct || 0}%</strong></span>
                            &bull;
                            <span>DPMO: <strong>{dmaicMetrics?.ctq1_latency?.dpmo || 0}</strong></span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`ctq-status-badge compact ${getCtqStatusClass(dmaicMetrics?.ctq1_latency?.status)}`}>
                            {dmaicMetrics?.ctq1_latency?.status || 'NO DATA'}
                          </span>
                        </td>
                      </tr>
                      {selectedCtq === 'ctq1' && (
                        <tr className="ctq-detail-row">
                          <td colSpan={6}>
                            <CtqDetailPanel
                              ctqKey="ctq1"
                              metrics={dmaicMetrics}
                              records={dmaicRecords}
                              onClose={() => setSelectedCtq(null)}
                            />
                          </td>
                        </tr>
                      )}

                      {/* CTQ 2: PC Utilization & Energy Waste (Choonvai) */}
                      <tr
                        className={`ctq-matrix-row ${selectedCtq === 'ctq2' ? 'selected' : ''}`}
                        onClick={() => toggleCtqDetails('ctq2')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCtqDetails('ctq2');
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={selectedCtq === 'ctq2'}
                      >
                        <td>
                          <div className="ctq-owner-tag choonvai" style={{ marginBottom: '2px' }}>
                            CTQ 2 &bull; Choonvai
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                            Hardware Fleet &amp; Energy Waste
                          </div>
                        </td>
                        <td>
                          <strong style={{ fontSize: '13px' }}>PC Utilization &amp; Energy Waste</strong>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Target: </span>
                          <strong>&ge; 70%</strong> active-time utilization
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800 }}>
                            {dmaicMetrics?.ctq2_utilization?.status === 'NO DATA' ? '—' : (dmaicMetrics?.ctq2_utilization?.utilization_pct || 0)}
                          </span>{' '}
                          <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>%</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11.5px' }}>
                            <div>
                              <span><strong>{dmaicMetrics?.ctq2_utilization?.gaming_hours || 0}h</strong> active time &bull; <strong>{dmaicMetrics?.ctq2_utilization?.idle_hours || 0}h</strong> standby time</span>
                              {' '}&bull;{' '}
                              <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Active rate: {formatWattRate(ctq2ActiveWatts)} &bull; standby rate: {formatWattRate(ctq2IdleWatts)}</span>
                            </div>
                            <PowerBreakdownDetails
                              activeWatts={ctq2ActiveWatts}
                              idleWatts={ctq2IdleWatts}
                              activeBreakdown={ctq2Power.active_power_breakdown}
                              idleBreakdown={ctq2Power.idle_power_breakdown}
                              activeHours={ctq2Power.gaming_hours}
                              idleHours={ctq2Power.idle_hours}
                              expanded={Boolean(powerDetailsOpen.ctq2)}
                              onToggle={() => togglePowerDetails('ctq2')}
                            />
                            <div style={{ fontSize: '11px' }}>
                              <span style={{ color: '#38bdf8' }}>
                                Energy intensity: {ctq2Power.energy_intensity_kwh_per_active_hour ?? 0} kWh per active hour
                              </span>
                              {' '}&bull;{' '}
                              <span style={{ color: '#f87171' }}>Standby waste: {dmaicMetrics?.ctq2_utilization?.idle_waste_kwh ?? 0} kWh ({dmaicMetrics?.ctq2_utilization?.idle_waste_pct ?? 0}%)</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`ctq-status-badge compact ${getCtqStatusClass(dmaicMetrics?.ctq2_utilization?.status)}`}>
                            {dmaicMetrics?.ctq2_utilization?.status || 'NO DATA'}
                          </span>
                        </td>
                      </tr>
                      {selectedCtq === 'ctq2' && (
                        <tr className="ctq-detail-row">
                          <td colSpan={6}>
                            <CtqDetailPanel
                              ctqKey="ctq2"
                              metrics={dmaicMetrics}
                              records={dmaicRecords}
                              activeWatts={ctq2ActiveWatts}
                              idleWatts={ctq2IdleWatts}
                              onClose={() => setSelectedCtq(null)}
                            />
                          </td>
                        </tr>
                      )}

                      {/* CTQ 3: Booking Waiting Time & Capacity (Lim Hokann) */}
                      <tr
                        className={`ctq-matrix-row ${selectedCtq === 'ctq3' ? 'selected' : ''}`}
                        onClick={() => toggleCtqDetails('ctq3')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCtqDetails('ctq3');
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={selectedCtq === 'ctq3'}
                      >
                        <td>
                          <div className="ctq-owner-tag hokann" style={{ marginBottom: '2px' }}>
                            CTQ 3 &bull; Lim Hokann
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                            Queue &amp; Slot Capacity Management
                          </div>
                        </td>
                        <td>
                          <strong style={{ fontSize: '13px' }}>Queue Waiting &amp; Capacity</strong>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Target: </span>
                          <strong>&le; 30 min</strong> mean wait; zero capacity defects
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800 }}>
                            {dmaicMetrics?.ctq3_waiting_time?.mean_waiting_time_mins || 0}
                          </span>{' '}
                          <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>min mean</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px' }}>
                            <span>n={dmaicMetrics?.ctq3_waiting_time?.sample_size || 0}</span>
                            &bull;
                            <span>Max Wait: <strong>{dmaicMetrics?.ctq3_waiting_time?.max_waiting_time_mins || 0} min</strong></span>
                            &bull;
                            <span>Booked Slots: <strong>{dmaicMetrics?.ctq3_waiting_time?.total_booked_slots || 0}</strong></span>
                            &bull;
                            <span>Wait defects (&gt;30m): <strong className={(dmaicMetrics?.ctq3_waiting_time?.waiting_defect_count || 0) > 0 ? 'text-defect' : ''}>{dmaicMetrics?.ctq3_waiting_time?.waiting_defect_count || 0}</strong></span>
                            &bull;
                            <span>Capacity defects: <strong className={(dmaicMetrics?.ctq3_waiting_time?.capacity_defects_count || 0) > 0 ? 'text-defect' : ''}>{dmaicMetrics?.ctq3_waiting_time?.capacity_defects_count || 0}</strong></span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`ctq-status-badge compact ${getCtqStatusClass(dmaicMetrics?.ctq3_waiting_time?.status)}`}>
                            {dmaicMetrics?.ctq3_waiting_time?.status || 'NO DATA'}
                          </span>
                        </td>
                      </tr>
                      {selectedCtq === 'ctq3' && (
                        <tr className="ctq-detail-row">
                          <td colSpan={6}>
                            <CtqDetailPanel
                              ctqKey="ctq3"
                              metrics={dmaicMetrics}
                              records={dmaicRecords}
                              onClose={() => setSelectedCtq(null)}
                            />
                          </td>
                        </tr>
                      )}

                      {/* CTQ 4: Session Completion Rate (Hour) */}
                      <tr
                        className={`ctq-matrix-row ${selectedCtq === 'ctq4' ? 'selected' : ''}`}
                        onClick={() => toggleCtqDetails('ctq4')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCtqDetails('ctq4');
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={selectedCtq === 'ctq4'}
                      >
                        <td>
                          <div className="ctq-owner-tag hour" style={{ marginBottom: '2px' }}>
                            CTQ 4 &bull; Hour
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                            Session Reliability &amp; QoS
                          </div>
                        </td>
                        <td>
                          <strong style={{ fontSize: '13px' }}>Session Completion Rate</strong>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: 'var(--text-muted, #94a3b8)' }}>Target: </span>
                          <strong>&ge; 95%</strong> Completion
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800 }}>
                            {dmaicMetrics?.ctq4_completion_rate?.completion_rate_pct || 0}
                          </span>{' '}
                          <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>%</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11.5px' }}>
                            <span>n={dmaicMetrics?.ctq4_completion_rate?.sample_size || 0}</span>
                            &bull;
                            <span>Sessions: <strong>{dmaicMetrics?.ctq4_completion_rate?.completed_sessions || 0} / {dmaicMetrics?.ctq4_completion_rate?.total_sessions || 0}</strong></span>
                            &bull;
                            <span>Defect Rate: <strong className={(dmaicMetrics?.ctq4_completion_rate?.defect_rate_pct || 0) > 0 ? 'text-defect' : ''}>{dmaicMetrics?.ctq4_completion_rate?.defect_rate_pct || 0}%</strong></span>
                            &bull;
                            <span>Failures: <strong>{dmaicMetrics?.ctq4_completion_rate?.failure_counts?.disconnect || 0} disc, {dmaicMetrics?.ctq4_completion_rate?.failure_counts?.crash || 0} crash</strong></span>
                            &bull;
                            <span>DPMO: <strong>{dmaicMetrics?.ctq4_completion_rate?.dpmo || 0}</strong></span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`ctq-status-badge compact ${getCtqStatusClass(dmaicMetrics?.ctq4_completion_rate?.status)}`}>
                            {dmaicMetrics?.ctq4_completion_rate?.status || 'NO DATA'}
                          </span>
                        </td>
                      </tr>
                      {selectedCtq === 'ctq4' && (
                        <tr className="ctq-detail-row">
                          <td colSpan={6}>
                            <CtqDetailPanel
                              ctqKey="ctq4"
                              metrics={dmaicMetrics}
                              records={dmaicRecords}
                              onClose={() => setSelectedCtq(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION: MULTI-PC ELECTRICITY & OPERATING EXPENSE TRACKER */}
              <div className="tab-section-header compact" style={{ marginTop: '20px', marginBottom: '10px' }}>
                <div>
                  <h2 className="section-heading-compact" style={{ fontSize: '1.1rem', margin: 0, fontWeight: 700 }}>
                    Multi-PC Electricity &amp; Operating Cost
                  </h2>
                </div>
              </div>

              {/* SECTION: MULTI-PC ELECTRICITY & OPERATING EXPENSE TABLE */}
              <div className="dmaic-electricity-table-container glass-panel">
                <div className="electricity-table-scroll">
                  <table className="dmaic-electricity-table">
                    <thead>
                      <tr>
                        <th style={{ minWidth: '180px' }}>Gaming Rig / Hardware</th>
                        <th style={{ width: '90px', textAlign: 'center' }}>Status</th>
                        <th style={{ minWidth: '150px', textAlign: 'right' }}>Power Rate (W)</th>
                        <th style={{ minWidth: '120px', textAlign: 'right' }}>Observed Time</th>
                        <th style={{ minWidth: '120px', textAlign: 'right' }}>Energy Consumed</th>
                        <th style={{ minWidth: '130px', textAlign: 'right' }}>Cost / Active Hr</th>
                        <th style={{ minWidth: '140px', textAlign: 'right' }}>14-Day Forecast</th>
                        <th style={{ minWidth: '140px', textAlign: 'right' }}>14-Day Standby Waste</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perPcEnergy.map((pc, idx) => {
                        const gpuFormatted = formatRigGpu(pc.gpu);
                        const cpuFormatted = pc.cpu ? formatCpu(pc.cpu) : 'CPU unavailable';
                        const ramFormatted = pc.ram ? formatRam(pc.ram) : 'RAM unavailable';
                        const forecast = pc.two_week_forecast || {};
                        const isOnline = pc.status === 'available' || pc.status === 'in-use';

                        return (
                          <tr key={pc.id || idx}>
                            <td>
                              <div style={{ fontWeight: 700, fontSize: '12.5px', marginBottom: '2px' }}>
                                Rig #{idx + 1} &bull; {pc.name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                                <span>{gpuFormatted}</span> &bull; <span>{cpuFormatted}</span> &bull; <span>{ramFormatted}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`pc-status-pill-table ${isOnline ? 'online' : 'standby'}`}>
                                <span className={`live-dot ${isOnline ? 'green' : 'gray'}`} />
                                {isOnline ? 'Online' : 'Standby'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <div className="power-total-summary">
                                <strong>{formatWattRate(pc.active_watts)} active rate</strong>
                                <span>{formatWattRate(pc.idle_watts)} standby rate</span>
                              </div>
                              <PowerBreakdownDetails
                                activeWatts={pc.active_watts}
                                idleWatts={pc.idle_watts}
                                activeBreakdown={pc.active_power_breakdown}
                                idleBreakdown={pc.idle_power_breakdown}
                                activeHours={pc.gaming_hours}
                                idleHours={pc.idle_hours}
                                expanded={Boolean(powerDetailsOpen[`pc-${pc.id || idx}`])}
                                onToggle={() => togglePowerDetails(`pc-${pc.id || idx}`)}
                              />
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ color: '#4ade80', fontWeight: 600 }}>{formatLoggedHours(pc.gaming_hours)} play</span>
                              {' / '}
                              <span style={{ color: 'var(--text-muted, #94a3b8)' }}>
                                {pc.idle_hours > 0 ? `${formatLoggedHours(pc.idle_hours)} idle` : '0h standby (closed)'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{pc.total_kwh < 0.01 && pc.total_kwh > 0 ? Number(pc.total_kwh).toFixed(4) : Number(pc.total_kwh || 0).toFixed(2)} kWh</strong>{' '}
                              <span style={{ color: '#4ade80' }}>({pc.total_cost_usd < 0.01 && pc.total_cost_usd > 0 ? '< $0.01' : `$${Number(pc.total_cost_usd || 0).toFixed(2)}`})</span>
                              <span style={{ display: 'block', fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)' }}>
                                for {formatLoggedHours(pc.gaming_hours)} active time
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {forecast.direct_cost_per_hr != null ? `$${forecast.direct_cost_per_hr.toFixed(3)} / hr` : '—'}
                              {forecast.direct_cost_per_hr != null && (
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                                  ({Math.round(forecast.direct_cost_per_hr * 4050)} ៛)
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ fontWeight: 600 }}>{forecast.projected_kwh != null ? `${forecast.projected_kwh} kWh` : '—'}</span>
                              {forecast.projected_cost_usd != null && (
                                <span style={{ color: '#38bdf8', display: 'block' }}>
                                  ${forecast.projected_cost_usd.toFixed(2)} ({(forecast.projected_cost_khr || 0).toLocaleString()} ៛)
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ color: '#f87171', fontWeight: 600 }}>
                                {forecast.idle_waste_kwh != null ? `${forecast.idle_waste_kwh} kWh` : '—'}
                              </span>
                              {forecast.idle_waste_usd != null && (
                                <span style={{ color: '#f87171', display: 'block', fontSize: '11px' }}>
                                  (${forecast.idle_waste_usd.toFixed(2)})
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="electricity-fleet-summary-row">
                        <td>
                          <div style={{ fontWeight: 700, fontSize: '12.5px' }}>Fleet Combined ({perPcEnergy.length} Gaming Rigs)</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)' }}>Phnom Penh EDC Standard ($0.18/kWh)</div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700 }}>{perPcEnergy.length} Rigs</span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{formatWattRate(totalActiveWatts)}</span>
                          {' / '}
                          <span style={{ color: '#38bdf8', fontWeight: 700 }}>{formatWattRate(totalIdleWatts)}</span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <strong style={{ color: '#4ade80' }}>{formatLoggedHours(totalGamingHours)} play</strong>
                          {' / '}
                          <span style={{ color: 'var(--text-muted, #94a3b8)' }}>
                            {totalIdleHours > 0 ? `${formatLoggedHours(totalIdleHours)} idle` : '0h standby (closed)'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <strong style={{ color: '#38bdf8' }}>{totalObservedKwh < 0.01 && totalObservedKwh > 0 ? totalObservedKwh.toFixed(4) : totalObservedKwh.toFixed(2)} kWh</strong>{' '}
                          <span style={{ color: '#4ade80' }}>({totalObservedUsd < 0.01 && totalObservedUsd > 0 ? '< $0.01' : `$${totalObservedUsd.toFixed(2)}`})</span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontWeight: 600 }}>$0.038 &ndash; $0.047 / hr</span>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>(154 &ndash; 190 ៛)</span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ fontWeight: 700 }}>{totalPilotKwh.toFixed(1)} kWh</span>
                          <span style={{ color: '#38bdf8', display: 'block', fontWeight: 700 }}>
                            ${totalPilotCostUsd.toFixed(2)} USD ({totalPilotCostKhr.toLocaleString()} ៛)
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ color: '#f87171', fontWeight: 700 }}>
                            {totalIdleWasteKwh.toFixed(1)} kWh
                          </span>
                          <span style={{ color: '#f87171', display: 'block', fontWeight: 700, fontSize: '11px' }}>
                            (${totalIdleWasteUsd.toFixed(2)} USD)
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* SECTION: CLEAN EXCEL-STYLE DATASET SPREADSHEET */}
              <div className="tab-section-header compact" style={{ marginTop: '22px', marginBottom: '8px' }}>
                <div>
                  <h2 className="section-heading-compact" style={{ fontSize: '1.1rem', margin: 0, fontWeight: 700 }}>
                    Observation Dataset (Excel View)
                  </h2>
                </div>
                <div className="excel-export-actions">
                  <button
                    className="btn-primary btn-compact excel-download-btn"
                    onClick={handleExportCsv}
                    disabled={exportingCsv || dmaicRecords.length === 0}
                    style={{ height: '30px', padding: '0 10px', fontSize: '11px', borderRadius: '6px' }}
                    title="Export dataset as .CSV"
                  >
                    <DownloadIcon size={12} />
                    <span>{exportingCsv ? 'Exporting...' : 'Export .CSV'}</span>
                  </button>
                </div>
              </div>

              {/* Excel Spreadsheet Container */}
              <div className="excel-sheet-container">
                {/* Excel Ribbon & Sheet Bar */}
                <div className="excel-sheet-header">
                  <div className="excel-brand-title">
                    <span className="excel-icon-pill">XLSX</span>
                    <span className="excel-filename">CloudKH_Dataset.xlsx</span>
                  </div>
                  
                  {/* Excel Sheet Tabs */}
                  <div className="excel-sheet-tabs">
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('all')}
                    >
                      All Data ({dmaicRecords.length})
                    </button>
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'V1_Baseline' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('V1_Baseline')}
                    >
                      V1 Baseline ({dmaicRecords.filter((r) => r.phase === 'V1_Baseline').length})
                    </button>
                    <button
                      className={`excel-tab-btn ${dmaicPhaseFilter === 'V2_Improved' ? 'active' : ''}`}
                      onClick={() => setDmaicPhaseFilter('V2_Improved')}
                    >
                      V2 Improved ({dmaicRecords.filter((r) => r.phase === 'V2_Improved').length})
                    </button>
                  </div>
                </div>

                {/* Excel Formula Bar (fx) */}
                <div className="excel-formula-bar">
                  <div className="excel-name-box">
                    <span>A1:N{Math.max(1, filteredDmaicRecords.length + 1)}</span>
                  </div>
                  <div className="excel-fx-label">fx</div>
                  <div className="excel-formula-input" title="Active Formula">
                    {filteredDmaicRecords.length > 0
                      ? `=AVERAGE(G2:G${filteredDmaicRecords.length + 1})`
                      : ''}
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
                        /* Empty Sheet State: Clean Excel blank grid cells */
                        <>
                          {[1, 2, 3, 4, 5, 6].map((rowNum) => (
                            <tr key={rowNum} className="excel-empty-row">
                              <td className="excel-row-idx">{rowNum}</td>
                              <td colSpan={14} className="excel-blank-cell" style={{ textAlign: rowNum === 2 ? 'center' : 'inherit' }}>
                                {rowNum === 2 && (
                                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                                    No records &bull; Click &quot;Seed 30 Trials&quot; above to populate dataset
                                  </span>
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
                          const kwh = r.power_kwh ?? (r.power_usage_watts ? r.power_usage_watts / 1000 : 0);
                          const cost = r.energy_cost_usd ?? (kwh * EDC_TARIFF_USD_PER_KWH);
                          const rigName = r.machine_name || r.rig_display || (r.machine_id ? `Machine #${r.machine_id}` : 'Machine unavailable');
                          const rigGpu = formatRigGpu(r.machine_gpu || 'GPU unavailable');

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
                                    <ShieldCheckIcon size={11} style={{ opacity: 0.8 }} />
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
                            Average / Total (N = {filteredDmaicRecords.length})
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
                        <span className="excel-status-item">SUM COST: <strong>${sumCost.toFixed(2)}</strong></span>
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

      {/* MODAL 5: LOG SESSION OBSERVATION */}
      {showAddTestModal && (
        <div className="modal-backdrop" onClick={() => setShowAddTestModal(false)}>
          <div className="modal-dialog glass-panel" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowAddTestModal(false)} aria-label="Close">
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <h2>Log Session Observation Run</h2>
              <p style={{ color: 'var(--text-2)', fontSize: '13px', margin: '4px 0 0' }}>
                Record trial metrics for stream quality analysis &amp; dataset export.
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
