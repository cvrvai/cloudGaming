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
import './App.css';
import './CloudKH.css';

function CloudKHPlatform() {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState('games'); // games | bookings | profile | admin | stream
  const [activeSession, setActiveSession] = useState(null);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const [selectedGameForBooking, setSelectedGameForBooking] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  const handleSessionEnd = async () => {
    try {
      if (token) {
        await fetch(`${API_BASE}/api/session/stop`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch (e) {
      console.warn('Failed to notify session stop:', e);
    }
    setActiveSession(null);
    setActiveTab('bookings');
  };

  return (
    <div className="app-container">
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

          <main className="cloudkh-main-content">
            {activeTab === 'games' && (
              <GamesView
                onSelectGame={(game) => setSelectedGameForBooking(game)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            )}

            {activeTab === 'bookings' && (
              <MyBookingsView
                onLaunchSession={handleLaunchSession}
                onBrowseGames={() => setActiveTab('games')}
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
              onBookingSuccess={(booking) => {
                setActiveTab('bookings');
              }}
              onLaunchNow={(booking) => {
                handleLaunchSession(booking);
              }}
            />
          )}

          <AuthModal />
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
