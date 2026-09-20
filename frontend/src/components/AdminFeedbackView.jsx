import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../config';
import {
  RefreshIcon,
  DownloadIcon,
  AlertTriangleIcon,
  CheckIcon,
  SearchIcon,
  ClockIcon,
  GamepadIcon,
  ServerIcon,
  UserIcon,
  XIcon,
  SparkleIcon,
  ChartIcon,
} from './Icons';

export default function AdminFeedbackView({ token }) {
  const [feedbackData, setFeedbackData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);
  const [batchSuccessMsg, setBatchSuccessMsg] = useState(null);
  const [error, setError] = useState(null);

  // Batch Generation Modal State
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchCount, setBatchCount] = useState(100);
  const [clearExisting, setClearExisting] = useState(true);

  // Filters & Pagination
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSentiment, setSelectedSentiment] = useState('all');
  const [selectedRating, setSelectedRating] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);

  const fetchFeedback = async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.append('category', selectedCategory);
      if (selectedSentiment !== 'all') params.append('sentiment', selectedSentiment);
      if (selectedRating !== 'all') params.append('rating', selectedRating);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      params.append('limit', '300');

      const res = await fetch(`${API_BASE}/api/voc/feedback?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to load VOC feedback (${res.status})`);
      }

      const data = await res.json();
      setFeedbackData(data);
    } catch (err) {
      console.error('Error loading VOC feedback:', err);
      setError(err.message || 'Could not load feedback data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
    setCurrentPage(1);
  }, [selectedCategory, selectedSentiment, selectedRating, searchQuery]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchFeedback();
  };

  const handleSeedData = async () => {
    if (!window.confirm('Reset and re-seed the authentic Voice of Customer (VOC) dataset (30 entries)?')) return;
    try {
      setSeeding(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/voc/seed`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        throw new Error('Failed to seed VOC data');
      }
      setSeedSuccess(true);
      setTimeout(() => setSeedSuccess(false), 3500);
      await fetchFeedback();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  };

  const handleGenerateBatch = async () => {
    try {
      setSeeding(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/voc/generate-batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          count: Number(batchCount),
          clear_existing: clearExisting,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to generate batch VOC records');
      }

      setShowBatchModal(false);
      setBatchSuccessMsg(`Successfully generated ${data.count} Voice of Customer records!`);
      setTimeout(() => setBatchSuccessMsg(null), 4500);
      setCurrentPage(1);
      await fetchFeedback();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  };

  const handleExportCsv = () => {
    window.open(`${API_BASE}/api/voc/export-csv?token=${token}`, '_blank');
  };

  const summary = feedbackData?.summary || {};
  const records = feedbackData?.records || [];

  // Client-side pagination
  const totalRecords = records.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return records.slice(start, start + pageSize);
  }, [records, currentPage, pageSize]);

  // Pareto distribution calculation
  const paretoStats = useMemo(() => {
    const cats = summary.categories || {};
    const total = summary.total_feedback || 1;
    const rig = cats.rig_capacity || 0;
    const queue = cats.queue_waiting || 0;
    const session = cats.session_limit || 0;
    const stream = cats.stream_quality || 0;

    const rigPct = Math.round((rig / total) * 1000) / 10;
    const queuePct = Math.round((queue / total) * 1000) / 10;
    const sessionPct = Math.round((session / total) * 1000) / 10;
    const streamPct = Math.round((stream / total) * 1000) / 10;

    const capacityTotalPct = Math.round(((rig + queue) / total) * 1000) / 10;

    return {
      rig,
      rigPct,
      queue,
      queuePct,
      session,
      sessionPct,
      stream,
      streamPct,
      capacityTotalPct,
    };
  }, [summary]);

  const renderStars = (rating) => {
    return (
      <div className="flex items-center gap-0.5 text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={`text-sm ${star <= rating ? 'text-amber-400' : 'text-slate-600'}`}
          >
            ★
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full text-white">
      {/* Header & Control Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111633]/80 border border-white/10 rounded-2xl p-5 backdrop-blur-xl shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_10px_#f43f5e]" />
            <h2 className="text-xl font-black tracking-tight text-white m-0">
              Voice of Customer (VOC) &amp; Customer Feedback
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1 m-0">
            Player complaints, satisfaction ratings, and fleet capacity bottleneck analysis (Lean Six Sigma DMAIC CTQ 3).
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {batchSuccessMsg && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
              <CheckIcon size={14} /> {batchSuccessMsg}
            </span>
          )}

          {seedSuccess && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
              <CheckIcon size={14} /> Seeded 30 VOC Records!
            </span>
          )}

          <button
            onClick={() => setShowBatchModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(147,51,234,0.3)] border border-purple-400/40"
            title="Generate 50, 100, or 200 VOC complaints for Six Sigma analysis"
          >
            <SparkleIcon size={13} />
            <span>Generate Dataset ({summary.total_feedback || 0})</span>
          </button>

          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 hover:border-cyan-400/60 font-bold text-xs transition-all cursor-pointer shadow-[0_0_15px_rgba(0,210,255,0.1)]"
            title="Export CSV for Jamovi / Excel Six Sigma analysis"
          >
            <DownloadIcon size={14} />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleSeedData}
            disabled={seeding}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
            title="Reset to default 30 seed complaints"
          >
            <RefreshIcon size={14} className={seeding ? 'animate-spin' : ''} />
            <span>Reset Baseline (30)</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer disabled:opacity-50"
            title="Refresh feedback"
          >
            <RefreshIcon size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2">
          <AlertTriangleIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Top 4 KPI Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: CSAT Rating */}
        <div className="p-4 rounded-2xl bg-[#111736]/90 border border-white/10 flex flex-col gap-2 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400">
            <span>Overall Player CSAT</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
              {summary.csat_status || 'CRITICAL'}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white tracking-tight">
              {summary.avg_rating ? `${summary.avg_rating}` : '1.5'}
            </span>
            <span className="text-sm text-slate-400 font-bold">/ 5.0 ★</span>
          </div>
          <div className="flex items-center gap-1">
            {renderStars(Math.round(summary.avg_rating || 2))}
            <span className="text-[11px] text-slate-400 ml-1">Target ≥ 3.5 ★</span>
          </div>
        </div>

        {/* Card 2: 1-PC Rig Bottleneck */}
        <div className="p-4 rounded-2xl bg-[#111736]/90 border border-rose-500/30 flex flex-col gap-2 relative overflow-hidden shadow-lg shadow-rose-950/20">
          <div className="flex items-center justify-between text-xs font-bold text-rose-300">
            <span>#1 Core Bottleneck</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
              CTQ 3 Defect
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-rose-400 tracking-tight">
              {summary.bottleneck_complaints_pct ? `${summary.bottleneck_complaints_pct}%` : '85.0%'}
            </span>
            <span className="text-xs text-rose-300/80 font-bold">of Complaints</span>
          </div>
          <span className="text-[11px] text-slate-300 truncate font-medium">
            1-Computer Limit (1 User at a time)
          </span>
        </div>

        {/* Card 3: Reported Queue Wait Time */}
        <div className="p-4 rounded-2xl bg-[#111736]/90 border border-amber-500/30 flex flex-col gap-2 relative overflow-hidden shadow-lg shadow-amber-950/20">
          <div className="flex items-center justify-between text-xs font-bold text-amber-300">
            <span>Avg Reported Wait</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Excessive
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-400 tracking-tight">
              {summary.avg_reported_wait_mins ? `${summary.avg_reported_wait_mins}m` : '73.7m'}
            </span>
            <span className="text-xs text-slate-400 font-bold">
              (Max: {summary.max_reported_wait_mins || 120}m)
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            Six Sigma Limit: &le; 30 mins
          </span>
        </div>

        {/* Card 4: Total Submissions */}
        <div className="p-4 rounded-2xl bg-[#111736]/90 border border-white/10 flex flex-col gap-2 relative overflow-hidden shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400">
            <span>Total VOC Records</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              N = {summary.total_feedback || records.length}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white tracking-tight">
              {summary.total_feedback || records.length}
            </span>
            <span className="text-xs text-slate-400 font-bold">Submissions</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {summary.sentiments?.negative_pct || 91.7}% Negative / {summary.sentiments?.neutral_pct || 5.0}% Neutral
          </span>
        </div>
      </div>

      {/* Six Sigma Pareto Defect Distribution Bar */}
      <div className="p-5 rounded-2xl bg-[#111633]/90 border border-white/10 backdrop-blur-xl shadow-xl flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ChartIcon size={16} className="text-cyan-400" />
            <span className="text-xs font-black uppercase tracking-wider text-white">
              Lean Six Sigma Pareto Defect Analysis (80/20 Principle)
            </span>
          </div>
          <span className="text-xs text-rose-300 font-bold">
            Hardware Capacity &amp; Queue = {paretoStats.capacityTotalPct}% of all defects
          </span>
        </div>

        {/* Segmented Pareto Bar */}
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-white/5 border border-white/10">
          <div
            style={{ width: `${paretoStats.rigPct}%` }}
            className="bg-rose-500 h-full transition-all duration-500"
            title={`Rig Capacity Bottleneck: ${paretoStats.rigPct}%`}
          />
          <div
            style={{ width: `${paretoStats.queuePct}%` }}
            className="bg-amber-500 h-full transition-all duration-500"
            title={`Queue Waiting Time: ${paretoStats.queuePct}%`}
          />
          <div
            style={{ width: `${paretoStats.sessionPct}%` }}
            className="bg-purple-500 h-full transition-all duration-500"
            title={`Session Limit & Handover: ${paretoStats.sessionPct}%`}
          />
          <div
            style={{ width: `${paretoStats.streamPct}%` }}
            className="bg-cyan-500 h-full transition-all duration-500"
            title={`Stream Latency & Thermal: ${paretoStats.streamPct}%`}
          />
        </div>

        {/* Pareto Legend */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 shrink-0" />
            <span className="text-slate-300 truncate">
              <strong>1-PC Bottleneck:</strong> {paretoStats.rig} ({paretoStats.rigPct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 shrink-0" />
            <span className="text-slate-300 truncate">
              <strong>Queue &amp; Curfew:</strong> {paretoStats.queue} ({paretoStats.queuePct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 shrink-0" />
            <span className="text-slate-300 truncate">
              <strong>Session Handover:</strong> {paretoStats.session} ({paretoStats.sessionPct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 shrink-0" />
            <span className="text-slate-300 truncate">
              <strong>Stream &amp; Heat:</strong> {paretoStats.stream} ({paretoStats.streamPct}%)
            </span>
          </div>
        </div>
      </div>

      {/* Six Sigma Root Cause Analysis Callout Box */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-rose-950/40 via-[#181333] to-[#111633] border border-rose-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 shrink-0 mt-0.5">
            <AlertTriangleIcon size={20} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-rose-400">
                DMAIC Define &amp; Measure Insight · CTQ 3 Capacity Bottleneck
              </span>
              <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Single Host Monopolization
              </span>
            </div>
            <p className="text-xs text-slate-300 m-0 leading-relaxed max-w-4xl">
              <strong>Core Root Cause:</strong> Because only 1 gaming rig is online (<code className="text-rose-300 bg-rose-950/60 px-1.5 py-0.5 rounded">Gaming PC (DESKTOP-BR6FNPB)</code>), only <strong>1 user can play at a time across the entire platform</strong>. Even when players want to play completely different catalog titles (e.g. <em>Hades II</em> vs <em>Stardew Valley</em> vs <em>Minecraft</em>), they are cross-blocked and must wait in a sequential queue.
            </p>
            <p className="text-[11px] text-cyan-300/80 m-0 mt-1">
              💡 <strong>Recommended Countermeasure:</strong> Launch Node #2 (Gaming PC Choonvai) to enable concurrent multi-user streaming.
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Filter Bar */}
      <div className="flex flex-col gap-3 p-4 bg-[#111633]/70 border border-white/10 rounded-2xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              type="text"
              placeholder="Search feedback text, player name, email, game..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50 transition-all"
            />
          </div>

          {/* View Mode & Page Size Switchers */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Show:</span>
              {[24, 48, 96].map((sz) => (
                <button
                  key={sz}
                  onClick={() => {
                    setPageSize(sz);
                    setCurrentPage(1);
                  }}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                    pageSize === sz
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/10 rounded-xl">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-[0_0_10px_rgba(0,210,255,0.2)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Cards ({totalRecords})
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 shadow-[0_0_10px_rgba(0,210,255,0.2)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Table View
              </button>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Category:</span>
          {[
            { id: 'all', label: `All (${summary.total_feedback || 0})` },
            { id: 'rig_capacity', label: `🖥️ 1-PC Rig Bottleneck (${summary.categories?.rig_capacity || 0})` },
            { id: 'queue_waiting', label: `⏳ Queue & Wait (${summary.categories?.queue_waiting || 0})` },
            { id: 'session_limit', label: `⏱️ Handover Cutoff (${summary.categories?.session_limit || 0})` },
            { id: 'stream_quality', label: `⚡ Thermal & Quality (${summary.categories?.stream_quality || 0})` },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 shadow-[0_0_10px_rgba(0,210,255,0.15)]'
                  : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
              }`}
            >
              {cat.label}
            </button>
          ))}

          <div className="w-px h-4 bg-white/10 mx-1 hidden sm:block" />

          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Sentiment:</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'negative', label: `😡 Complaints (${summary.sentiments?.negative || 0})` },
            { id: 'neutral', label: `😐 Neutral (${summary.sentiments?.neutral || 0})` },
            { id: 'positive', label: `😊 Positive (${summary.sentiments?.positive || 0})` },
          ].map((sent) => (
            <button
              key={sent.id}
              onClick={() => setSelectedSentiment(sent.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedSentiment === sent.id
                  ? sent.id === 'negative'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                  : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 border border-transparent'
              }`}
            >
              {sent.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback Items Section */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs font-semibold flex items-center justify-center gap-2">
          <RefreshIcon size={16} className="animate-spin text-cyan-400" />
          <span>Loading Voice of Customer feedback records...</span>
        </div>
      ) : records.length === 0 ? (
        <div className="p-12 text-center bg-[#111633]/60 border border-white/10 rounded-2xl">
          <p className="text-slate-400 text-sm font-semibold m-0">No VOC feedback matching your filters.</p>
          <button
            onClick={() => {
              setSelectedCategory('all');
              setSelectedSentiment('all');
              setSelectedRating('all');
              setSearchQuery('');
            }}
            className="mt-3 text-xs text-cyan-400 hover:underline cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      ) : viewMode === 'cards' ? (
        /* Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paginatedRecords.map((item) => {
            const isNegative = item.rating <= 2;
            const isNeutral = item.rating === 3;
            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between gap-3.5 transition-all hover:translate-y-[-2px] shadow-lg ${
                  isNegative
                    ? 'bg-[#141838]/90 border-rose-500/25 hover:border-rose-500/50 hover:shadow-rose-950/20'
                    : isNeutral
                    ? 'bg-[#141838]/90 border-amber-500/25 hover:border-amber-500/50'
                    : 'bg-[#141838]/90 border-cyan-500/25 hover:border-cyan-500/50'
                }`}
              >
                {/* Header: User & Rating */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                      {item.user_name ? item.user_name.charAt(0).toUpperCase() : 'P'}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white leading-tight">{item.user_name}</span>
                      <span className="text-[10px] text-slate-400 truncate max-w-[150px]">
                        {item.user_email}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {renderStars(item.rating)}
                    <span
                      className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        isNegative
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : isNeutral
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {item.experience_tag || (isNegative ? 'Bottleneck' : 'Satisfied')}
                    </span>
                  </div>
                </div>

                {/* Complaint Comment Quote */}
                <div className="p-3 rounded-xl bg-black/25 border border-white/5 relative">
                  <span className="text-xl text-slate-600 leading-none absolute top-1 left-2 select-none font-serif">“</span>
                  <p className="text-xs text-slate-200 m-0 pl-3 leading-relaxed italic">
                    {item.comment}
                  </p>
                </div>

                {/* Metadata Badges: Game, Reported Wait Time, Machine */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.game_title && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 text-slate-300 font-semibold text-[10.5px]">
                        <GamepadIcon size={12} /> {item.game_title}
                      </span>
                    )}
                    {item.waiting_time_minutes > 0 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 font-semibold text-[10.5px] border border-amber-500/20">
                        <ClockIcon size={12} /> Waited {item.waiting_time_minutes}m
                      </span>
                    )}
                  </div>

                  <span className="text-[9.5px] text-slate-500 shrink-0 font-medium">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Recent'}
                  </span>
                </div>

                {/* Six Sigma CTQ Classification */}
                <div className="text-[9.5px] font-semibold text-rose-300/70 truncate flex items-center gap-1">
                  <span>Defect Tag:</span>
                  <span className="text-slate-300 truncate">{item.ctq_defect_category}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#111633]/80 backdrop-blur-xl shadow-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                <th className="p-3.5 pl-4">Player</th>
                <th className="p-3.5">Rating</th>
                <th className="p-3.5">Game Title</th>
                <th className="p-3.5">Reported Wait</th>
                <th className="p-3.5">Verbatim Complaint / Voice of Customer</th>
                <th className="p-3.5">CTQ Classification</th>
                <th className="p-3.5 pr-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {paginatedRecords.map((item) => (
                <tr key={item.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-3.5 pl-4 font-semibold text-white whitespace-nowrap">
                    <div>{item.user_name}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{item.user_email}</div>
                  </td>
                  <td className="p-3.5 whitespace-nowrap">
                    {renderStars(item.rating)}
                    <div className="text-[9.5px] text-slate-400 mt-0.5">{item.experience_tag}</div>
                  </td>
                  <td className="p-3.5 whitespace-nowrap font-medium text-slate-200">
                    {item.game_title || 'Hades II'}
                  </td>
                  <td className="p-3.5 whitespace-nowrap">
                    {item.waiting_time_minutes > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-bold">
                        {item.waiting_time_minutes} min
                      </span>
                    ) : (
                      <span className="text-slate-500">0 min</span>
                    )}
                  </td>
                  <td className="p-3.5 max-w-md">
                    <p className="m-0 text-slate-200 leading-relaxed italic">
                      "{item.comment}"
                    </p>
                  </td>
                  <td className="p-3.5 whitespace-nowrap text-[10.5px] text-rose-300 font-semibold">
                    {item.ctq_defect_category}
                  </td>
                  <td className="p-3.5 pr-4 whitespace-nowrap text-[10px] text-slate-400">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Recent'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-[#111633]/60 border border-white/10 text-xs text-slate-400">
          <div>
            Showing <strong className="text-white">{(currentPage - 1) * pageSize + 1}</strong> to{' '}
            <strong className="text-white">{Math.min(currentPage * pageSize, totalRecords)}</strong> of{' '}
            <strong className="text-white">{totalRecords}</strong> records
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold disabled:opacity-40 disabled:hover:bg-white/5 transition-all cursor-pointer"
            >
              Previous
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = idx + 1;
              } else if (currentPage <= 3) {
                pageNum = idx + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + idx;
              } else {
                pageNum = currentPage - 2 + idx;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-8 h-8 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                    currentPage === pageNum
                      ? 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(0,210,255,0.4)]'
                      : 'bg-white/5 text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold disabled:opacity-40 disabled:hover:bg-white/5 transition-all cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Batch Generation Modal */}
      {showBatchModal && (
        <div className="modal-backdrop" onClick={() => setShowBatchModal(false)}>
          <div
            className="modal-dialog glass-panel"
            style={{ maxWidth: '480px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close-btn"
              onClick={() => setShowBatchModal(false)}
              aria-label="Close"
            >
              <XIcon size={16} />
            </button>

            <div className="auth-header">
              <div className="flex items-center gap-2">
                <SparkleIcon size={18} className="text-purple-400" />
                <h2 className="text-lg font-black text-white m-0">Generate Six Sigma VOC Dataset</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1 m-0">
                Generate a statistically significant dataset of Voice of Customer feedback highlighting the single-PC limitation.
              </p>
            </div>

            <div className="flex flex-col gap-4 mt-5">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-300">Select Dataset Size:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { count: 50, label: '50 Records', desc: 'Quick sample' },
                    { count: 100, label: '100 Records', desc: 'Recommended for Six Sigma' },
                    { count: 150, label: '150 Records', desc: 'Multi-week analysis' },
                    { count: 200, label: '200 Records', desc: 'Large monthly dataset' },
                  ].map((preset) => (
                    <button
                      key={preset.count}
                      type="button"
                      onClick={() => setBatchCount(preset.count)}
                      className={`p-3 rounded-xl border text-left flex flex-col gap-0.5 transition-all cursor-pointer ${
                        batchCount === preset.count
                          ? 'bg-purple-500/20 border-purple-400 text-white shadow-[0_0_15px_rgba(168,85,247,0.25)]'
                          : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20'
                      }`}
                    >
                      <span className="text-xs font-bold">{preset.label}</span>
                      <span className="text-[10px] text-slate-400">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-black/20 border border-white/5 flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-300">Dataset Characteristics:</span>
                <ul className="m-0 pl-4 text-[11px] text-slate-400 space-y-1">
                  <li><strong>~85% Rig Bottleneck:</strong> Complaints about 1 PC shared across Hades, Minecraft, Stardew, Spiritfarer.</li>
                  <li><strong>Peak Hours Focus:</strong> 6:00 PM – 11:00 PM queues (45m to 120m wait times).</li>
                  <li><strong>25+ Student Personas:</strong> Hour, Lihour, Hokann, Neakleng, Choonvai, etc.</li>
                  <li><strong>Jamovi-Ready:</strong> Quantitative Six Sigma binary defect flags in CSV export.</li>
                </ul>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={clearExisting}
                  onChange={(e) => setClearExisting(e.target.checked)}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                />
                <span>Replace previous VOC records with this new dataset</span>
              </label>

              <button
                type="button"
                onClick={handleGenerateBatch}
                disabled={seeding}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-950/40 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshIcon size={14} className={seeding ? 'animate-spin' : ''} />
                <span>{seeding ? 'Generating VOC Records...' : `Generate ${batchCount} VOC Records`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
