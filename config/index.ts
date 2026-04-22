interface Config {
  telegramToken: string;
  supabase: {
    url: string;
    serviceRoleKey: string;
    anonKey: string;
  };
  geminiApiKey: string;
  appUrl: string;
  port: number;
}

const nodeEnv = process.env.NODE_ENV || 'staging';

// Load .env only in local dev (neither staging nor production)
if (nodeEnv !== 'production' && nodeEnv !== 'staging') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
    console.log('[CONFIG] Local development environment detected. Loaded .env');
  } catch (err) {
    console.warn('[CONFIG] Failed to load .env. Proceeding with existing environment variables.');
  }
}

import staging from './staging.ts';
import production from './production.ts';

const configs: Record<string, any> = {
  staging,
  production,
};

const config = configs[nodeEnv] || configs.staging;

console.log(`[CONFIG] Loaded ${nodeEnv} configuration.`);
if (process.env.DEBUG_CONFIG === 'true') {
  console.log('[CONFIG] Details:', JSON.stringify({
    ...config,
    telegramToken: config.telegramToken ? 'Present' : 'Missing',
    supabase: {
      ...config.supabase,
      serviceRoleKey: config.supabase.serviceRoleKey ? 'Present' : 'Missing',
      anonKey: config.supabase.anonKey ? 'Present' : 'Missing',
    },
    geminiApiKey: config.geminiApiKey ? 'Present' : 'Missing',
  }, null, 2));
}

export default config;
export type { Config };
