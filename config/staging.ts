export interface Config {
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

const config: Config = {
  telegramToken: process.env.STAGING_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
  supabase: {
    url: process.env.STAGING_SUPABASE_URL || process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.STAGING_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  },
  geminiApiKey: process.env.STAGING_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
  appUrl: process.env.STAGING_APP_URL || process.env.APP_URL || "",
  port: parseInt(process.env.PORT || "3000", 10),
};

export default config;
