import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emmytech.attendance',
  appName: 'com.emmytech.attendance',
  webDir: 'dist',
  server: {
    url: 'https://smart-attendance-hub-ten.vercel.app/',
    cleartext: true,
  },
};

export default config;
