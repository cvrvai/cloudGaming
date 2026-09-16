import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SERVER_IP, API_BASE } from './config';
import Navbar from './components/Navbar';
import AuthModal from './components/AuthModal';
import GamesView from './components/GamesView';
import MyBookingsView from './components/MyBookingsView';
import AdminDashboard from './components/AdminDashboard';
import ProfileSettingsView from './components/ProfileSettingsView';
import BookingModal from './components/BookingModal';
import CloudStreamPlayer from './components/CloudStreamPlayer';
import SessionFeedbackModal from './components/SessionFeedbackModal';
import './App.css';
import './CloudKH.css';

function CloudKHPlatform() {
  const { token, user, openAuth } = useAuth();
  const [activeTab, setActiveTab] = useState('games'); // games | bookings | profile | admin | stream
  const [activeSession, setActiveSession] = useState(null);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const [selectedGameForBooking, setSelectedGameForBooking] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedbackSession, setFeedbackSession] = useState(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [bookingsRefreshKey, setBookingsRefreshKey] = useState(0);

  // Poll for active bookings to display badge in navbar
  useEffect(() => {
    if (!token) {
      setActiveBookingsCount(0);
      return;
    }
    const checkActive = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/bookings/my`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setActiveBookingsCount(data.active ? data.active.length : 0);
        }
      } catch (err) {
        console.error('Error fetching booking count:', err);
      }
    };
    checkActive();
    const interval = setInterval(checkActive, 10000);
    return () => clearInterval(interval);
  }, [token]);

  // Session launcher gatekeeper (FR-05, User Story 2)
  const handleLaunchSession = async (booking) => {
    try {
      const res = await fetch(`${API_BASE}/api/session/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ booking_id: booking.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || 'Access Denied: You do not have an active slot right now.');
        return;
      }
      setActiveSession(data);
      setActiveTab('stream');
    } catch (err) {
      alert('Verification error: ' + err.message);
    }
  };

  const handleSessionEnd = () => {
    const stoppingSession = activeSession;
    // Synchronously exit the stream player immediately (0ms delay) to prevent showing desktop
    setActiveSession(null);
    setActiveTab('bookings');

    // Prompt user for feedback on the dashboard cleanly without video lag
    if (stoppingSession?.booking_id) {
      setFeedbackSession(stoppingSession);
    }

    // Run backend teardown and booking release asynchronously in the background
    if (token) {
      fetch(`${API_BASE}/api/session/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch((e) => console.warn('Failed to notify session stop:', e));

      if (stoppingSession?.booking_id) {
        fetch(`${API_BASE}/api/bookings/${stoppingSession.booking_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch((e) => console.warn('Failed to release booking:', e));
      }
    }
  };

  const handleFeedbackSubmit = async (feedbackData) => {
    setFeedbackSubmitting(true);
    try {
      if (token && feedbackSession) {
        const bId = feedbackSession.booking_id || feedbackSession.id;
        await fetch(`${API_BASE}/api/session/telemetry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            booking_id: bId,
            user_rating: feedbackData.user_rating,
            experience_tag: feedbackData.experience_tag,
            user_comment: feedbackData.user_comment,
            avg_latency_ms: 42,
            max_latency_ms: 48,
            avg_fps: 60,
            packet_loss_pct: 0.0,
            completed: true,
            duration_seconds: 60,
          }),
        });
        setBookingsRefreshKey((k) => k + 1);
        try {
          sessionStorage.removeItem('cloudkh_admin_data_v1');
        } catch {}
        window.dispatchEvent(new CustomEvent('cloudkh-feedback-submitted'));
      }
    } catch (e) {
      console.warn('Feedback submit error:', e);
    } finally {
      setFeedbackSubmitting(false);
      setFeedbackSession(null);
    }
  };

  return (
    <div className="w-[100dvw] h-[100dvh] min-h-[100dvh] flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,_#18233c_0%,_#0d111a_60%,_#080a10_100%)] text-slate-100 font-sans select-none">
      {activeTab === 'stream' && activeSession ? (
        <CloudStreamPlayer
          sessionData={activeSession}
          onSessionEnd={handleSessionEnd}
          apiBase={API_BASE}
          serverIP={SERVER_IP}
        />
      ) : (
        <>
          <Navbar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            activeBookingsCount={activeBookingsCount}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />

          <main className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4 pb-12 max-w-[1400px] w-full mx-auto box-border [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {activeTab === 'games' && (
              <GamesView
                onSelectGame={(game) => {
                  if (!token) {
                    openAuth?.('login');
                    return;
                  }
                  setSelectedGameForBooking(game);
                }}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            )}

            {activeTab === 'bookings' && (
              <MyBookingsView
                key={bookingsRefreshKey}
                onLaunchSession={handleLaunchSession}
                onBrowseGames={() => setActiveTab('games')}
                onRateSession={(booking) => setFeedbackSession(booking)}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileSettingsView
                onNavigateToBookings={() => setActiveTab('bookings')}
                onNavigateToGames={() => setActiveTab('games')}
              />
            )}

            {activeTab === 'admin' && <AdminDashboard />}
          </main>


          {selectedGameForBooking && (
            <BookingModal
              game={selectedGameForBooking}
              onClose={() => setSelectedGameForBooking(null)}
              onBookingSuccess={(booking, bookingMode) => {
                if (bookingMode === 'schedule') {
                  setActiveTab('bookings');
                }
              }}
              onLaunchNow={(booking) => {
                handleLaunchSession(booking);
              }}
            />
          )}

          <AuthModal />

          {feedbackSession && (
            <SessionFeedbackModal
              sessionData={feedbackSession}
              onSubmit={handleFeedbackSubmit}
              onSkip={() => setFeedbackSession(null)}
              submitting={feedbackSubmitting}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CloudKHPlatform />
    </AuthProvider>
  );
}
