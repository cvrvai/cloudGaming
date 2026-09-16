import { useState, useEffect } from 'react';
import { API_BASE } from '../config';
import { SparkleIcon, PlayIcon, GamepadIcon, CalendarIcon } from './Icons';

let cachedGames = null;
try {
  const stored = typeof window !== 'undefined' ? localStorage.getItem('cloudkh_cached_games') : null;
  if (stored) cachedGames = JSON.parse(stored);
} catch (e) {}

let lastGamesFetchTime = 0;
const CACHE_TTL_MS = 60000; // 60s cache

export default function GamesView({ onSelectGame, searchQuery = '', onSearchChange }) {
  const [games, setGames] = useState(() => (Array.isArray(cachedGames) && cachedGames.length > 0 ? cachedGames : []));
  const [loading, setLoading] = useState(() => !(Array.isArray(cachedGames) && cachedGames.length > 0));
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [heroIndex, setHeroIndex] = useState(0);

  const fetchGames = async (force = false) => {
    const now = Date.now();
    if (!force && cachedGames && cachedGames.length > 0 && now - lastGamesFetchTime < CACHE_TTL_MS) {
      setGames(cachedGames);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/games`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          cachedGames = data;
          lastGamesFetchTime = Date.now();
          setGames(data);
          try {
            localStorage.setItem('cloudkh_cached_games', JSON.stringify(data));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error('Failed to load games:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGames();
    const handleUpdate = () => fetchGames(true);
    window.addEventListener('cloudkh-games-updated', handleUpdate);
    return () => {
      window.removeEventListener('cloudkh-games-updated', handleUpdate);
    };
  }, []);

  // Show all catalog games (ready nodes show green 'Available', offline nodes show 'Rig Offline' / 'Reserve')
  const availableGames = games;
  const featuredGames = availableGames.slice(0, 5);
  const activeHero = featuredGames[heroIndex] || featuredGames[0] || null;

  const genres = ['All', ...new Set(availableGames.map((g) => g.genre).filter(Boolean))];

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredGames = availableGames.filter((g) => {
    const matchesSearch =
      !q ||
      g.title.toLowerCase().includes(q) ||
      (g.genre && g.genre.toLowerCase().includes(q));
    const matchesGenre = selectedGenre === 'All' || g.genre === selectedGenre;
    return matchesSearch && matchesGenre;
  });

  const isSearching = q.length > 0;

  // Auto-cycle hero every 7 seconds when not searching
  useEffect(() => {
    if (featuredGames.length <= 1 || isSearching) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % featuredGames.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [featuredGames.length, isSearching]);

  const getGenreCount = (genre) => {
    if (genre === 'All') return availableGames.length;
    return availableGames.filter((g) => g.genre === genre).length;
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto px-4 py-4 md:py-6 pb-20 animate-[fadeIn_0.2s_ease-out] select-none">
      {/* 1. Luna-Inspired Hero Billboard */}
      {!isSearching && activeHero && (
        <div
          className="relative rounded-2xl overflow-hidden min-h-[230px] md:min-h-[290px] bg-cover bg-center flex items-center p-6 md:p-10 shadow-[0_16px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(0,82,255,0.15)] border border-cyan-400/20 text-white"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(18, 19, 43, 0.98) 0%, rgba(18, 19, 43, 0.85) 45%, rgba(18, 19, 43, 0.25) 100%), url(${activeHero.cover_url})`,
          }}
        >
          <div className="flex flex-col gap-2 max-w-xl z-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 bg-blue-600/30 border border-cyan-400/50 text-cyan-300 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                <SparkleIcon size={10} /> FEATURED
              </span>
              {activeHero.genre && (
                <span className="bg-white/10 border border-white/20 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  {activeHero.genre}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white m-0 tracking-tight leading-tight drop-shadow-lg">
              {activeHero.title}
            </h1>

            {activeHero.description && (
              <p className="text-xs md:text-sm text-white/80 line-clamp-2 leading-relaxed m-0 drop-shadow">
                {activeHero.description}
              </p>
            )}

            <div className="mt-2">
              <button
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white font-black text-xs md:text-sm px-6 py-2.5 rounded-xl cursor-pointer shadow-[0_6px_20px_rgba(0,82,255,0.5),0_0_16px_rgba(0,210,255,0.35)] hover:shadow-[0_10px_28px_rgba(0,210,255,0.7)] hover:-translate-y-0.5 transition-all border-0 w-fit"
                onClick={() => onSelectGame(activeHero)}
              >
                <span>
                  {activeHero.ready_nodes_count > 0 ? <PlayIcon size={12} /> : <CalendarIcon size={14} />}
                </span>
                {activeHero.ready_nodes_count > 0 ? ' Play Now' : ' Reserve Slot'}
              </button>
            </div>

            {/* Luna Slider Indicator Dots */}
            {featuredGames.length > 1 && (
              <div className="flex items-center gap-2 mt-3">
                {featuredGames.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`h-2 rounded-full transition-all duration-300 cursor-pointer border-0 p-0 ${
                      idx === heroIndex ? 'w-6 bg-cyan-400 shadow-[0_0_8px_#00d2ff]' : 'w-2 bg-white/25 hover:bg-white/50'
                    }`}
                    onClick={() => setHeroIndex(idx)}
                    aria-label={`Featured game ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Top Games Spotlight Carousel (Only shown when there are ready available games) */}
      {!isSearching && availableGames.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-lg md:text-xl font-black text-white m-0 tracking-tight">Top Games</h2>
            <span className="text-[11px] font-extrabold text-indigo-300/70 uppercase tracking-wider">Trending on CloudKH</span>
          </div>

          <div className="flex items-stretch gap-4 overflow-x-auto pb-4 pt-1 snap-x scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {availableGames.slice(0, 8).map((game, idx) => (
              <div
                key={game.id}
                className="shrink-0 w-48 md:w-52 h-64 md:h-72 rounded-2xl cursor-pointer snap-start transition-all duration-300 hover:-translate-y-2 hover:scale-[1.02] relative group"
                onClick={() => onSelectGame(game)}
                title={`Play ${game.title}`}
              >
                <div
                  className="w-full h-full rounded-2xl bg-cover bg-center relative overflow-hidden border border-cyan-400/25 group-hover:border-cyan-400 shadow-[0_14px_35px_rgba(0,0,0,0.75),0_0_15px_rgba(0,82,255,0.2)] group-hover:shadow-[0_20px_45px_rgba(0,0,0,0.85),0_0_25px_rgba(0,210,255,0.55)] flex flex-col justify-between p-3 bg-[#1d1e45] transition-all"
                  style={{ backgroundImage: `url(${game.cover_url})` }}
                >
                  <div className="self-start inline-flex items-center gap-0.5 bg-gradient-to-r from-blue-600 to-cyan-400 text-white px-2.5 py-1 rounded-lg font-black text-xs shadow-[0_4px_14px_rgba(0,82,255,0.6)] border border-white/30 z-10">
                    <span className="text-[10px] opacity-80">#</span>
                    <span className="text-xs font-black">{idx + 1}</span>
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e0f24] via-[#0e0f24]/80 to-transparent flex flex-col justify-end p-3.5 z-[1]">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-cyan-400 mb-1">{game.genre}</span>
                    <h3 className="text-sm font-black text-white truncate m-0 mb-2 drop-shadow-md">{game.title}</h3>
                    <div className="flex items-center">
                      <span className="inline-flex items-center gap-1.5 bg-white/10 group-hover:bg-gradient-to-r group-hover:from-blue-600 group-hover:to-cyan-400 border border-white/20 group-hover:border-cyan-400 text-white text-[11px] font-bold px-3 py-1 rounded-md backdrop-blur-md transition-all">
                        <PlayIcon size={11} /> Play Now
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Catalog Section with Genre Filters */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-base md:text-lg font-extrabold text-white m-0">
            {isSearching
              ? `Results for "${searchQuery}" (${filteredGames.length})`
              : 'All Games'}
          </h2>
          {isSearching && (
            <button
              className="bg-transparent border border-cyan-400/30 text-cyan-400 text-xs font-bold px-2.5 py-1 rounded-md cursor-pointer hover:bg-cyan-400/15 transition-colors"
              onClick={() => {
                if (onSearchChange) onSearchChange('');
                setSelectedGenre('All');
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Minimalist Sliding Segmented Bar */}
        {!loading && availableGames.length > 0 && genres.length > 1 && (
          <div className="flex items-center w-full overflow-x-auto pb-2 mb-2 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex items-center shrink-0 min-w-max gap-1 p-1 bg-[#141932]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-inner" role="tablist" aria-label="Game Genres">
              {genres.map((genre) => {
                const count = getGenreCount(genre);
                const isActive = selectedGenre === genre;
                return (
                  <button
                    key={genre}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border-0 ${
                      isActive
                        ? 'text-white bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_4px_14px_rgba(0,82,255,0.42)]'
                        : 'text-white/70 hover:text-white hover:bg-white/[0.08] bg-transparent'
                    }`}
                    onClick={() => setSelectedGenre(genre)}
                  >
                    <span>{genre === 'All' ? 'All Games' : genre}</span>
                    <span className={`inline-flex items-center justify-center min-w-[18px] h-4 px-1.5 rounded-full text-[10px] font-bold ${
                      isActive ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70'
                    }`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-white/50 gap-3 text-xs">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 animate-spin" />
            <p>Loading catalog...</p>
          </div>
        ) : availableGames.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-[#12132b]/80 border border-white/10 text-white/60 text-xs">
            <p>No games available.</p>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="p-8 text-center rounded-xl bg-[#12132b]/80 border border-white/10 text-white/60 text-xs">
            <p>No games found matching "{searchQuery}".</p>
            <button
              className="mt-3 px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold text-xs cursor-pointer transition-colors border-0"
              onClick={() => {
                if (onSearchChange) onSearchChange('');
                setSelectedGenre('All');
              }}
            >
              Reset Search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 md:gap-4">
            {filteredGames.map((game) => (
              <div
                key={game.id}
                className="rounded-xl overflow-hidden cursor-pointer bg-[#162541]/90 hover:bg-[#1c2e50] border border-cyan-400/20 hover:border-cyan-400 flex flex-col transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_12px_32px_rgba(0,82,255,0.35),0_0_0_1px_rgba(0,210,255,1)] relative shadow-lg group"
                onClick={() => onSelectGame(game)}
                title={game.title}
              >
                <div
                  className="h-32 sm:h-36 bg-cover bg-center relative bg-[#142138] overflow-hidden"
                  style={{ backgroundImage: `url(${game.cover_url})` }}
                >
                  <div className="absolute top-2 left-2 z-10">
                    <span className="bg-blue-600/80 backdrop-blur-md text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">{game.genre}</span>
                  </div>
                </div>

                <div className="p-3 flex flex-col flex-1 justify-between gap-2">
                  <h3 className="text-xs sm:text-sm font-extrabold text-white truncate m-0">{game.title}</h3>

                  <div className="flex items-center justify-between mt-auto">
                    {game.ready_nodes_count > 0 ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold text-cyan-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#00d2ff]" /> Available
                        </span>
                        <button
                          className="bg-gradient-to-r from-blue-600 to-cyan-400 hover:from-blue-500 hover:to-cyan-300 text-white text-[11px] font-black px-3 py-1 rounded-md border-0 cursor-pointer shadow-sm hover:shadow-md transition-all"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectGame(game);
                          }}
                        >
                          Play
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Rig Offline
                        </span>
                        <button
                          className="bg-white/10 text-slate-400 text-[11px] font-bold px-3 py-1 rounded-md border-0 cursor-not-allowed"
                          title="Gaming rig is offline. Start stream_node.py on your host PC."
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectGame(game);
                          }}
                        >
                          Offline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
