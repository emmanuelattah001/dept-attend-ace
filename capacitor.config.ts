import type { CapacitorConfig } from '@capacitor/cli';

// Set CAPACITOR_SERVER_URL to load the hosted web app inside the Android shell.
// Set it to an EMPTY string (CAPACITOR_SERVER_URL=) to bundle the built `dist/` into the app instead
// (recommended for Play Store release). HTTPS only: cleartext traffic is disabled.
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? 'https://smart-attendance-hub-auo.vercel.app/';

const config: CapacitorConfig = {
  appId: 'com.emmytech.attendance',
  appName: 'Smart Attendance',
  webDir: 'dist',
  ...(serverUrl ? { server: { url: serverUrl, cleartext: false } } : {}),
};

export default config;
