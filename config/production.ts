import { Config } from './staging';

const config: Config = {
  telegramToken: process.env.PROD_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
  supabase: {
    url: process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "",
    serviceRoleKey: process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    anonKey: process.env.PROD_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
  },
  geminiApiKey: process.env.PROD_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
  appUrl: process.env.PROD_APP_URL || process.env.APP_URL || "",
  port: parseInt(process.env.PORT || "3000", 10),
};

export default config;
