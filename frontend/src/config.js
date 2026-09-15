// Server connection config.
//
// Normal operation uses Vite's same-origin proxy. This is important when the
// app is served through an HTTPS domain: browsers will otherwise block the
// insecure http:// and ws:// connections to the backend. `?server=` remains
// available for the legacy direct-LAN connection flow.
const urlParams = new URLSearchParams(window.location.search);

const server = urlParams.get('server') || import.meta.env.VITE_SERVER_IP;
const port = urlParams.get('port') || import.meta.env.VITE_API_PORT || 8000;
const apiBaseOverride = urlParams.get('api') || import.meta.env.VITE_API_BASE;
const httpScheme = window.location.protocol === 'https:' ? 'https:' : 'http:';
const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const SERVER_IP = server || window.location.hostname;
export const API_PORT = port;

export const API_BASE = apiBaseOverride || (server ? `${httpScheme}//${server}:${port}` : '');
export const INPUT_WS_URL = apiBaseOverride
  ? `${apiBaseOverride.replace(/^http/, 'ws')}/ws/input`
  : (server
      ? `${wsScheme}//${server}:${port}/ws/input`
      : `${wsScheme}//${window.location.host}/ws/input`);

/**
 * Format machine/rig display name for player-facing UI.
 * Strips raw internal computer names, DESKTOP-XXXX codes, and parenthesized hardware tags.
 */
export function formatRigName(machineName) {
  if (!machineName) return 'Cloud Gaming Rig';
  let cleaned = machineName.replace(/\s*\([dD][eE][sS][kK][tT][oO][pP][^)]*\)/g, '');
  cleaned = cleaned.replace(/[dD][eE][sS][kK][tT][oO][pP]-[A-Za-z0-9]+/gi, '').trim();
  cleaned = cleaned.replace(/[()]/g, '').trim();
  cleaned = cleaned.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  return cleaned || 'Cloud Gaming Rig';
}

