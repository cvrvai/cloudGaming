import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../config';
import {
  RefreshIcon,
  DownloadIcon,
  AlertTriangleIcon,
  SearchIcon,
  ClockIcon,
  GamepadIcon,
  ServerIcon,
  UserIcon,
} from './Icons';

export default function AdminFeedbackView({ token }) {
  const [feedbackData, setFeedbackData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [exportingExcel, setExportingExcel] = useState(false);

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

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const res = await fetch(`${API_BASE}/api/voc/export-excel`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Excel export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CloudKH_Voice_of_Customer_Presentation_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Excel Export Error: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
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
            Student player complaints and fleet capacity bottleneck feedback ({records.length} records).
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <button
            onClick={handleExportExcel}
            disabled={exportingExcel || records.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.3)] border border-emerald-400/40 disabled:opacity-50 active:scale-95"
            title="Download complete Voice of Customer dataset as Microsoft Excel (.xlsx) presentation workbook"
          >
            <DownloadIcon size={15} className={exportingExcel ? 'animate-bounce' : ''} />
            <span>{exportingExcel ? 'Exporting...' : 'Export to Excel'}</span>
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-all cursor-pointer disabled:opacity-50"
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
    </div>
  );
}
