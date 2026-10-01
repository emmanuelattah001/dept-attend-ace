import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emmytech.attendance',
  appName: 'attendance',
  webDir: 'dist',
  server: {
    url: 'https://smart-attendance-hub-auo.vercel.app/',
    cleartext: true,
  },
};

export default config;
