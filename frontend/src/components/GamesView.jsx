import { useState, useEffect } from 'react';
import { API_BASE } from '../config';
import { SparkleIcon, PlayIcon } from './Icons';

export default function GamesView({ onSelectGame, searchQuery = '', onSearchChange }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/games`);
        if (res.ok) {
          setGames(await res.json());
        }
      } catch (err) {
        console.error('Failed to load games:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, []);

  const genres = ['All', ...new Set(games.map((g) => g.genre).filter(Boolean))];

  const q = (searchQuery || '').trim().toLowerCase();
  const filteredGames = games.filter((g) => {
    const matchesSearch =
      !q ||
      g.title.toLowerCase().includes(q) ||
      (g.genre && g.genre.toLowerCase().includes(q));
    const matchesGenre = selectedGenre === 'All' || g.genre === selectedGenre;
    return matchesSearch && matchesGenre;
  });

  const isSearching = q.length > 0;

  // Featured games for Luna-inspired hero carousel
  const featuredGames = games.slice(0, 5);
  const activeHero = featuredGames[heroIndex] || featuredGames[0] || games[0];

  // Auto-cycle hero every 7 seconds when not searching
  useEffect(() => {
    if (featuredGames.length <= 1 || isSearching) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % featuredGames.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [featuredGames.length, isSearching]);

  return (
    <div className="geforce-games-container luna-games-container">
      {/* 1. Luna-Inspired Hero Billboard */}
      {!isSearching && activeHero && (
        <div
          className="luna-hero-banner"
          style={{
            backgroundImage: `linear-gradient(90deg, rgba(18, 19, 43, 0.98) 0%, rgba(18, 19, 43, 0.85) 45%, rgba(18, 19, 43, 0.25) 100%), url(${activeHero.cover_url})`,
          }}
        >
          <div className="luna-hero-content">
            <div className="luna-hero-tag-row">
              <span className="luna-hero-tag">
                <SparkleIcon size={10} /> FEATURED
              </span>
              {activeHero.genre && <span className="luna-hero-genre">{activeHero.genre}</span>}
            </div>

            <h1 className="luna-hero-title">{activeHero.title}</h1>

            {activeHero.description && (
              <p className="luna-hero-tagline">{activeHero.description}</p>
            )}

            <div className="luna-hero-actions">
              <button
                className="luna-hero-play-btn"
                onClick={() => onSelectGame(activeHero)}
              >
                <span className="play-triangle">▶</span> Play Now
              </button>
            </div>

            {/* Luna Slider Indicator Dots */}
            {featuredGames.length > 1 && (
              <div className="luna-hero-dots">
                {featuredGames.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`luna-dot ${idx === heroIndex ? 'active' : ''}`}
                    onClick={() => setHeroIndex(idx)}
                    aria-label={`Featured game ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Top Games Spotlight Carousel (Redesigned & Substantially Larger) */}
      {!isSearching && games.length > 0 && (
        <section className="luna-ranked-section">
          <div className="luna-section-header">
            <h2 className="luna-section-title">Top Games</h2>
            <span className="luna-section-sub">Trending on CloudKH</span>
          </div>

          <div className="luna-ranked-track">
            {games.slice(0, 8).map((game, idx) => (
              <div
                key={game.id}
                className="luna-top-card"
                onClick={() => onSelectGame(game)}
                title={`Play ${game.title}`}
              >
                <div
                  className="luna-top-poster"
                  style={{ backgroundImage: `url(${game.cover_url})` }}
                >
                  <div className="luna-rank-badge">
                    <span className="rank-hash">#</span>
                    <span className="rank-num">{idx + 1}</span>
                  </div>

                  <div className="luna-top-overlay">
                    <span className="luna-top-genre">{game.genre}</span>
                    <h3 className="luna-top-title">{game.title}</h3>
                    <div className="luna-top-action-row">
                      <span className="luna-top-play-pill">
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
      <section className="luna-catalog-section">
        <div className="catalog-header-row">
          <h2 className="luna-section-title">
            {isSearching
              ? `Results for "${searchQuery}" (${filteredGames.length})`
              : 'All Games'}
          </h2>
          {isSearching && (
            <button
              className="btn-clear-filter"
              onClick={() => {
                if (onSearchChange) onSearchChange('');
                setSelectedGenre('All');
              }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Genre Filter Pills */}
        <div className="genre-filter-scroll">
          {genres.map((genre) => (
            <button
              key={genre}
              className={`genre-filter-btn ${selectedGenre === genre ? 'active' : ''}`}
              onClick={() => setSelectedGenre(genre)}
            >
              {genre === 'All' ? 'All Games' : genre}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="loading-games-state">
            <div className="spinner-geforce" />
            <p>Loading...</p>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="empty-catalog-state glass-panel">
            <p>No games found matching "{searchQuery}".</p>
            <button
              className="btn-secondary"
              onClick={() => {
                if (onSearchChange) onSearchChange('');
                setSelectedGenre('All');
              }}
            >
              Reset Search
            </button>
          </div>
        ) : (
          <div className="geforce-posters-grid">
            {filteredGames.map((game) => (
              <div
                key={game.id}
                className="game-poster-tile glass-panel"
                onClick={() => onSelectGame(game)}
                title={game.title}
              >
                <div
                  className="poster-art-box"
                  style={{ backgroundImage: `url(${game.cover_url})` }}
                >
                  <div className="poster-top-badges">
                    <span className="poster-genre-pill">{game.genre}</span>
                  </div>
                </div>

                <div className="poster-details-box">
                  <h3 className="poster-title">{game.title}</h3>

                  <div className="poster-footer-row">
                    <span className="poster-stream-ready">
                      <span className="mini-green-dot" /> Ready
                    </span>
                    <button
                      className="btn-tile-play"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectGame(game);
                      }}
                    >
                      Play
                    </button>
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
