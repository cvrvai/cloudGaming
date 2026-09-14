import { useState, useEffect } from 'react';
import { API_BASE } from '../config';
import BookingModal from './BookingModal';
import { GamepadIcon, CpuIcon, RamIcon, ClockIcon } from './Icons';

export default function FleetView({ onBookingSuccess }) {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMachine, setSelectedMachine] = useState(null);

  const fetchMachines = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/machines`);
      if (res.ok) {
        const data = await res.json();
        setMachines(data);
      }
    } catch (err) {
      console.error('Failed to load gaming rigs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMachines();
    const interval = setInterval(fetchMachines, 8000);
    return () => clearInterval(interval);
  }, []);

  const totalCount = machines.length;
  const availableCount = machines.filter((m) => m.live_status === 'available').length;

  return (
    <div className="fleet-view-container">
      <div className="fleet-header-clean">
        <div>
          <h1 className="fleet-page-title">Gaming Machines</h1>
          <p className="fleet-page-subtitle">
            Select an active gaming PC to launch an instant session or schedule a time slot.
          </p>
        </div>
        <div className="fleet-live-counters">
          <div className="counter-pill">
            <span className="counter-val">{availableCount}</span>
            <span className="counter-lbl">Available</span>
          </div>
          <div className="counter-pill">
            <span className="counter-val">{totalCount}</span>
            <span className="counter-lbl">Total Rigs</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="fleet-loading-spinner">Loading machines...</div>
      ) : (
        <div className="rig-cards-grid">
          {machines.map((machine) => {
            const isAvailable = machine.live_status === 'available';
            const isBusy = machine.live_status === 'busy';
            const isMaintenance = machine.status === 'maintenance';

            return (
              <div
                key={machine.id}
                className={`rig-card glass-panel ${machine.is_host === 1 ? 'host-rig' : ''}`}
              >
                <div className="rig-card-header">
                  <div className="rig-card-title-group">
                    {machine.is_host === 1 && (
                      <span className="host-tag-pill">LOCAL HOST PC</span>
                    )}
                    <h3 className="rig-card-title">{machine.name}</h3>
                  </div>
                  <div
                    className={`status-indicator-pill ${
                      isMaintenance ? 'maintenance' : isBusy ? 'busy' : 'available'
                    }`}
                  >
                    <span className="status-dot" />
                    {isMaintenance ? 'Maintenance' : isBusy ? 'In Session' : 'Available'}
                  </div>
                </div>

                <div className="rig-specs-box">
                  <div className="spec-row">
                    <span className="spec-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <GamepadIcon size={14} />
                    </span>
                    <span className="spec-value">{machine.gpu}</span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <CpuIcon size={14} />
                    </span>
                    <span className="spec-value">{machine.cpu}</span>
                  </div>
                  <div className="spec-row">
                    <span className="spec-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <RamIcon size={14} />
                    </span>
                    <span className="spec-value">{machine.ram}</span>
                  </div>
                </div>

                {machine.notes && <p className="rig-notes-text">{machine.notes}</p>}

                {/* Schedule timeline */}
                <div className="rig-schedule-timeline">
                  <span className="schedule-header-label">Today's Schedule:</span>
                  {machine.bookings && machine.bookings.length > 0 ? (
                    <div className="schedule-tags-list">
                      {machine.bookings.slice(0, 3).map((b) => {
                        const s = new Date(b.start_time).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        const e = new Date(b.end_time).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        return (
                          <span key={b.id} className="schedule-slot-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <ClockIcon size={12} />
                            <span>{s} - {e}</span>
                          </span>
                        );
                      })}
                      {machine.bookings.length > 3 && (
                        <span className="schedule-more-tag">
                          +{machine.bookings.length - 3} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="schedule-empty-state">No scheduled bookings. Available now!</div>
                  )}
                </div>

                <div className="rig-card-actions">
                  <button
                    className="btn-primary rig-book-btn"
                    onClick={() => setSelectedMachine(machine)}
                    disabled={isMaintenance}
                  >
                    {isMaintenance ? 'Maintenance Mode' : 'Book Session'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedMachine && (
        <BookingModal
          machine={selectedMachine}
          onClose={() => setSelectedMachine(null)}
          onBookingSuccess={(booking) => {
            fetchMachines();
            onBookingSuccess(booking);
          }}
        />
      )}
    </div>
  );
}
