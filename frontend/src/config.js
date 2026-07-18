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
export const INPUT_WS_URL = server
  ? `${wsScheme}//${server}:${port}/ws/input`
  : `${wsScheme}//${window.location.host}/ws/input`;
