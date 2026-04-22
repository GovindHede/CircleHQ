import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import cron from "node-cron";
import config from "./config/index.ts";
import { 
  generateSemanticSummary, 
  generateEmbedding, 
  getConciergeResponse,
  generateIntroduction,
  analyzeFeedback,
  extractSearchParams,
  explainMatch,
  detectIntent,
  generateMatchReasons,
  getAI
} from "./src/services/agents.ts";

// Log configuration status
console.log(`[CircleHQ] Runtime Environment: ${process.env.NODE_ENV || 'development'}`);
if (process.env.DEBUG_CONFIG === 'true') {
  console.log("- Telegram Token:", config.telegramToken ? "Present" : "MISSING");
  console.log("- Supabase URL:", config.supabase.url ? "Present" : "MISSING");
}


const formatEmbedding = (emb: any) => Array.isArray(emb) ? `[${emb.join(',')}]` : emb;

// Helper functions for logging
async function logMessage(telegramId: string, direction: 'incoming' | 'outgoing', content: string) {
  try {
    const { error } = await supabase.from('messages').insert([{
      telegram_id: telegramId,
      direction,
      content
    }]);
    if (error) {
      if (error.code === '42P01') {
        console.warn('Warning: "messages" table does not exist. Please run the updated supabase_schema.sql');
      } else {
        console.error('Error logging message:', JSON.stringify(error, null, 2));
      }
    }
  } catch (e) {
    console.error('Exception logging message:', e);
  }
}

async function logAgentAction(userId: string, action: string, details: string) {
  try {
    const { error } = await supabase.from('agent_log').insert([{
      user_id: userId,
      action,
      details
    }]);
    if (error) {
      if (error.code === '42P01') {
        console.warn('Warning: "agent_log" table does not exist. Please run the updated supabase_schema.sql');
      } else {
        console.error('Error logging agent action:', JSON.stringify(error, null, 2));
      }
    }
  } catch (e) {
    console.error('Exception logging agent action:', e);
  }
}

// Wrapper for bot.sendMessage to log outgoing messages
async function safeSendMessage(chatId: number | string, text: string, options?: any) {
  if (!bot) return;
  try {
    const msg = await bot.sendMessage(chatId, text, options);
    // Log outgoing message
    await logMessage(chatId.toString(), 'outgoing', text);
    return msg;
  } catch (e) {
    console.error(`Error sending message to ${chatId}:`, e);
  }
}

// In-memory match queue removed for production persistence. 
// We use the match_queue table in Supabase instead.

async function formatMatchMessage(profile: any, candidate: any, mutualConnections: string[] = [], isWeekly = false) {
  const reasons = await generateMatchReasons(profile, candidate, mutualConnections);
  const bio = candidate.bio || candidate.working_on || candidate.semantic_summary || "A great connection.";
  
  const title = isWeekly ? "🎲 CircleHQ Weekly Match" : "🤝 CircleHQ Match";
  
  const text = `${title}\n\nMeet ${candidate.name}\n\n${bio}\n\nWhy you should connect:\n• ${reasons[0]}\n• ${reasons[1]}\n• ${reasons[2]}\n\nWould you like an introduction?`;
  
  return {
    text,
    photo_file_id: candidate.photo_file_id
  };
}

// Initialize Supabase
const supabaseUrl = config.supabase.url;
const supabaseKey = config.supabase.serviceRoleKey;
const supabase = createClient(supabaseUrl, supabaseKey);

/*
SQL SCHEMA FOR SUPABASE (Run this in Supabase SQL Editor):

-- Enable pgvector
create extension if not exists vector;

-- Profiles table
create table profiles (
  id uuid primary key default uuid_generate_v4(),
  telegram_id text unique not null,
  name text,
  location text,
  working_on text,
  interests text[],
  looking_for text,
  onboarding_step text default 'name',
  semantic_summary text,
  embedding vector(768),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Connections table
create table connections (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  connection_strength float default 0,
  source text,
  created_at timestamp with time zone default now()
);

-- Introductions table
create table introductions (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  intro_text text,
  feedback_score int,
  created_at timestamp with time zone default now()
);

-- Matches table (to prevent repeated introductions)
create table matches (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  similarity_score float,
  introduced_at timestamp with time zone default now()
);

-- Match Queue table (For curated one-by-one matchmaking)
create table match_queue (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  candidate_user_id uuid references profiles(id),
  rank int,
  shown boolean default false,
  accepted boolean default false,
  created_at timestamp with time zone default now()
);

-- Skipped Matches table
create table skipped_matches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  candidate_user_id uuid references profiles(id),
  skipped_at timestamp with time zone default now()
);

-- User Interactions table (Social Graph Memory)
create table user_interactions (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  interaction_type text,
  strength float default 1.0,
  created_at timestamp with time zone default now()
);

-- Matching function
create or replace function match_profiles(query_embedding vector(768), match_threshold float, match_count int)
returns table (
  id uuid,
  name text,
  semantic_summary text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    profiles.id,
    profiles.name,
    profiles.semantic_summary,
    1 - (profiles.embedding <=> query_embedding) as similarity
  from profiles
  where 1 - (profiles.embedding <=> query_embedding) > match_threshold
  order by profiles.embedding <=> query_embedding
  limit match_count;
end;
$$;
*/

const app = express();
app.use(cors());
app.use(express.json());

const PORT = config.port;
const TELEGRAM_TOKEN = config.telegramToken;

let bot: TelegramBot | null = null;

if (TELEGRAM_TOKEN) {
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log("Telegram Bot initialized with CircleHQ AI Concierge");

  bot.on("polling_error", (error: any) => {
    if (error.code === "ETELEGRAM" && error.message.includes("409 Conflict")) {
      console.warn("Telegram polling conflict detected. Another instance might be running.");
    } else {
      console.error("Telegram polling error:", error);
    }
  });

  // Set bot commands for better UX
  bot.setMyCommands([
    { command: "start", description: "Start your networking journey" },
    { command: "search", description: "Search for people semantically (e.g. /search founders in Pune)" },
    { command: "previous_matches", description: "View previously skipped matches" },
    { command: "status", description: "Check bot and system health" },
    { command: "reset", description: "Reset your profile and start over" },
    { command: "help", description: "Get help on how to use CircleHQ" }
  ]);

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const telegramId = msg.from?.id.toString();

    if (!telegramId) return;
    if (!text && !msg.photo) return;
    
    // Log incoming message
    await logMessage(telegramId, 'incoming', text || '[photo]');

    try {
      // Get or create profile
      let { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();

      if (!profile) {
        // Start onboarding
        const username = msg.from?.username || "";
        const { data: newProfile, error: createError } = await supabase
          .from("profiles")
          .insert([{ telegram_id: telegramId, username: username, onboarding_step: "name" }])
          .select()
          .single();
        
        profile = newProfile;
        safeSendMessage(chatId, "Welcome to CircleHQ! I'm your AI networking concierge. Let's get started. What's your name?");
        return;
      }

      // Handle /reset command globally
      if (text.toLowerCase().trim() === "/reset" || text.toLowerCase().trim() === "reset") {
        const { error } = await supabase.from("profiles").update({
          name: null,
          location: null,
          working_on: null,
          interests: [],
          looking_for: null,
          photo_file_id: null,
          bio: null,
          onboarding_step: "name"
        }).eq("telegram_id", telegramId);
        
        if (error) {
          console.error("Reset error:", JSON.stringify(error, null, 2));
          safeSendMessage(chatId, `Sorry, I couldn't reset your profile right now. Error: ${error.message || JSON.stringify(error)}`);
          return;
        }
        
        safeSendMessage(chatId, "Your profile has been reset. Let's start over! What's your name?");
        return;
      }

        // Handle Onboarding
        if (profile.onboarding_step !== "completed") {
          const updates: any = { updated_at: new Date().toISOString() };
          let nextMessage = "";

          switch (profile.onboarding_step) {
            case "name":
              if (!text) return;
              updates.name = text;
              updates.onboarding_step = "location";
              nextMessage = `Nice to meet you, ${text}! Where are you based?`;
              break;
            case "location":
              if (!text) return;
              updates.location = text;
              updates.onboarding_step = "working_on";
              nextMessage = "Got it. What are you currently working on? (e.g. 'A fintech startup', 'Learning AI')";
              break;
            case "working_on":
              if (!text) return;
              updates.working_on = text;
              updates.onboarding_step = "interests";
              nextMessage = "Great! What are your professional interests? You can send them one by one or as a list. Send 'done' when you're finished.";
              break;
            case "interests":
              if (!text) return;
              if (text.toLowerCase().trim() === "done") {
                if (!profile.interests || profile.interests.length === 0) {
                  nextMessage = "Please add at least one interest before continuing!";
                  updates.onboarding_step = "interests";
                } else {
                  updates.onboarding_step = "looking_for";
                  nextMessage = "Perfect. Who are you looking to connect with? (e.g. 'Cofounders', 'Investors', 'Mentors')";
                }
              } else {
                const newInterests = text.split(',').map(i => i.trim()).filter(i => i.length > 0);
                const currentInterests = profile.interests || [];
                updates.interests = [...new Set([...currentInterests, ...newInterests])];
                updates.onboarding_step = "interests";
                nextMessage = `Added: ${newInterests.join(', ')}. Any more? Send 'done' to continue.`;
              }
              break;
            case "looking_for":
              if (!text) return;
              updates.looking_for = text;
              updates.onboarding_step = "photo";
              nextMessage = "Almost done! 📸 Please upload a profile photo. Or just send 'skip' and I'll automatically use your Telegram profile photo.";
              break;
            case "photo":
              const photoText = text ? text.toLowerCase().trim() : "";
              if (msg.photo && msg.photo.length > 0) {
                // Get medium size photo (not the biggest to save bandwidth)
                const photoSize = msg.photo.length > 1 ? msg.photo[msg.photo.length - 2] : msg.photo[0];
                updates.photo_file_id = photoSize.file_id;
              } else {
                // Try to fetch user's Telegram profile photo (whether they said 'skip' or anything else)
                try {
                  const userProfilePhotos = await bot.getUserProfilePhotos(msg.from?.id || 0, { limit: 1 });
                  if (userProfilePhotos.total_count > 0 && userProfilePhotos.photos.length > 0) {
                    const photos = userProfilePhotos.photos[0];
                    const photoSize = photos.length > 1 ? photos[photos.length - 2] : photos[0];
                    updates.photo_file_id = photoSize.file_id;
                    safeSendMessage(chatId, "I've automatically used your Telegram profile photo for your CircleHQ profile! ✨");
                  } else {
                    updates.photo_file_id = null;
                    safeSendMessage(chatId, "I couldn't find a Telegram profile photo, so I'll use a default placeholder for now. You can always update it later!");
                  }
                } catch (e) {
                  console.error("Failed to fetch user profile photo:", e);
                  updates.photo_file_id = null;
                  safeSendMessage(chatId, "I couldn't fetch your Telegram profile photo, so I'll use a default placeholder for now.");
                }
              }
              
              updates.onboarding_step = "completed";
              bot?.sendChatAction(chatId, "typing");
              
              console.log("Finalizing onboarding for user:", profile.telegram_id);
              try {
                // Generate Bio
                const ai = getAI();
                const bioPrompt = `
                  Write a concise 1–2 line professional bio for a networking introduction.
                  Focus on what the person is building and their interests.
                  Keep it natural and engaging.
                  
                  Working on: ${profile.working_on}
                  Interests: ${(profile.interests || []).join(', ')}
                  Looking for: ${profile.looking_for}
                  
                  Example output:
                  "DevOps engineer building automation tools for cloud infrastructure, passionate about Kubernetes and scalable systems."
                `;
                const bioResponse = await ai.models.generateContent({
                  model: "gemini-3-flash-preview",
                  contents: bioPrompt,
                });
                updates.bio = bioResponse.text?.trim() || "";

                // Generate Semantic Summary
                const summary = await generateSemanticSummary({
                  name: profile.name,
                  location: profile.location,
                  working_on: profile.working_on,
                  interests: profile.interests || [],
                  looking_for: profile.looking_for
                });
                
                if (summary) {
                  const embedding = await generateEmbedding(summary);
                  updates.semantic_summary = summary;
                  updates.embedding = formatEmbedding(embedding);
                  console.log("Successfully generated summary and embedding for", profile.telegram_id);
                  await logAgentAction(profile.id, 'generate_profile_summary', 'Successfully generated semantic summary and embedding during onboarding.');
                }
                
                nextMessage = "Onboarding complete! I've built your AI profile. I'll start looking for meaningful connections for you. Feel free to ask me anything!";
              } catch (aiError: any) {
                console.error("AI Processing Error during onboarding:", aiError);
                nextMessage = "Onboarding complete! I've saved your profile. I'll start looking for connections for you!";
              }
              break;
          }

          const { error: updateError } = await supabase.from("profiles").update(updates).eq("telegram_id", telegramId);
          if (updateError) {
            console.error("Supabase update error:", updateError);
          }
          safeSendMessage(chatId, nextMessage);
          return;
        }

        // Handle /repair command
        if (text.startsWith("/repair")) {
          safeSendMessage(chatId, "Repairing your profile's semantic data...");
          try {
            const summary = await generateSemanticSummary({
              name: profile.name,
              location: profile.location,
              working_on: profile.working_on,
              interests: profile.interests || [],
              looking_for: profile.looking_for
            });
            if (summary) {
              const embedding = await generateEmbedding(summary);
              const { error: repairError } = await supabase.from("profiles").update({
                semantic_summary: summary,
                embedding: formatEmbedding(embedding)
              }).eq("telegram_id", telegramId);
              if (repairError) {
                console.error("Repair Supabase update error:", JSON.stringify(repairError));
                safeSendMessage(chatId, "Failed to save repaired profile to database.");
              } else {
                safeSendMessage(chatId, "Profile repaired successfully! Your semantic summary and embedding have been updated.");
                await logAgentAction(profile.id, 'repair_profile', 'Successfully repaired semantic summary and embedding.');
              }
            } else {
              safeSendMessage(chatId, "Failed to generate summary.");
            }
          } catch (e: any) {
            safeSendMessage(chatId, `Repair failed: ${e.message}`);
          }
          return;
        }

        // Fallback: If profile is completed but missing semantic data, try to generate it
        if (profile.onboarding_step === "completed" && (!profile.semantic_summary || !profile.embedding)) {
          console.log("Repairing missing semantic data for user:", profile.telegram_id);
          try {
            const summary = await generateSemanticSummary({
              name: profile.name,
              location: profile.location,
              working_on: profile.working_on,
              interests: profile.interests || [],
              looking_for: profile.looking_for
            });
            if (summary) {
              const embedding = await generateEmbedding(summary);
              const { error: fallbackError } = await supabase.from("profiles").update({
                semantic_summary: summary,
                embedding: formatEmbedding(embedding)
              }).eq("telegram_id", telegramId);
              if (fallbackError) {
                console.error("Fallback Supabase update error:", JSON.stringify(fallbackError));
              } else {
                console.log("Repaired semantic data for", profile.telegram_id);
                await logAgentAction(profile.id, 'fallback_repair_profile', 'Automatically repaired missing semantic summary and embedding.');
              }
            }
          } catch (e) {
            console.error("Failed to repair semantic data:", e);
          }
        }

        // Only detect intent for completed profiles to save time/resources
        // Manual check for common commands to save AI calls
        const lowerText = text.toLowerCase().trim();
        let intent = "chat";
        
        if (lowerText.includes("connect") || lowerText.includes("find") || lowerText.includes("match") || lowerText.includes("introduce")) {
          // If it looks like a connection request, we still use AI to be sure, 
          // but we've avoided calling it for simple resets.
          intent = await detectIntent(text);
        } else if (lowerText.length < 3) {
          intent = "chat";
        } else {
          intent = await detectIntent(text);
        }

        console.log(`Detected intent for user ${telegramId}: ${intent}`);

        if (lowerText === "/help" || lowerText === "help") {
          const helpText = `👋 *Welcome to CircleHQ AI!*

CircleHQ is your AI-powered professional networking concierge.

*How to use:*
• Just tell me who you want to meet (e.g., "I'm looking for React developers in Berlin")
• Use /search for specific semantic searches
• Use /previous_matches to see people you skipped
• Use /reset if you want to rebuild your profile
• Use /status to check system health

I'll find your perfect matches based on interests, location, and social graph proximity!`;
          safeSendMessage(chatId, helpText, { parse_mode: "Markdown" });
          return;
        }

        if (lowerText === "/status") {
          const { count: stats } = await supabase.from("profiles").select("id", { count: "exact", head: true });
          const uptime = Math.floor(process.uptime() / 60);
          const statusText = `✅ *CircleHQ Status*
      
• *Bot Instance:* Active
• *Database:* Connected
• *Profiles:* ${stats || 0}
• *Uptime:* ${uptime} mins
• *Version:* 1.2.0-prod`;
          safeSendMessage(chatId, statusText, { parse_mode: "Markdown" });
          return;
        }

        // Handle /previous_matches command
        if (text.startsWith("/previous_matches")) {
          bot?.sendChatAction(chatId, "typing");
          
          try {
            const { data: skippedMatches, error } = await supabase
              .from("skipped_matches")
              .select("candidate_user_id, profiles!skipped_matches_candidate_user_id_fkey(id, name, working_on, looking_for)")
              .eq("user_id", profile.id)
              .order("skipped_at", { ascending: false })
              .limit(5);

            if (error) {
              console.error("Error fetching skipped matches:", error);
              safeSendMessage(chatId, "Sorry, I couldn't fetch your previous matches right now.");
              return;
            }

            if (!skippedMatches || skippedMatches.length === 0) {
              safeSendMessage(chatId, "You haven't skipped any matches yet.");
              return;
            }

            let messageText = "You previously skipped these matches:\n\n";
            const inlineKeyboard = [];

            skippedMatches.forEach((match: any) => {
              const candidate = match.profiles;
              if (candidate) {
                const desc = candidate.working_on || candidate.looking_for || "CircleHQ Member";
                messageText += `${candidate.name} – ${desc}\n`;
                inlineKeyboard.push([
                  { text: `Connect with ${candidate.name}`, callback_data: `accept_previous:${candidate.id}` }
                ]);
              }
            });

            safeSendMessage(chatId, messageText, {
              reply_markup: {
                inline_keyboard: inlineKeyboard
              }
            });
          } catch (error) {
            console.error("Previous matches error:", error);
            safeSendMessage(chatId, "Sorry, I ran into an error. Please try again later.");
          }
          return;
        }

        // Handle /search command
        if (text.startsWith("/search")) {
          const query = text.replace("/search", "").trim();
          if (!query) {
            safeSendMessage(chatId, "Please provide a search query. Example: /search founders in Pune");
            return;
          }

          bot?.sendChatAction(chatId, "typing");
          
          try {
            const [searchEmbedding, searchParams] = await Promise.all([
              generateEmbedding(query),
              extractSearchParams(query)
            ]);

            const { data: matches } = await supabase.rpc("match_profiles", {
              query_embedding: formatEmbedding(searchEmbedding),
              match_threshold: 0.3,
              match_count: 20
            });

            if (!matches || matches.length === 0) {
              safeSendMessage(chatId, "I couldn't find anyone matching that description yet.");
              return;
            }

            // Filter by extracted params if they exist
            let filteredResults = matches.filter((m: any) => m.id !== profile.id);
            
            if (searchParams.location) {
              filteredResults = filteredResults.filter((m: any) => 
                m.location?.toLowerCase().includes(searchParams.location.toLowerCase())
              );
            }
            
            if (searchParams.interests && searchParams.interests.length > 0) {
              filteredResults = filteredResults.filter((m: any) => 
                m.interests?.some((i: string) => 
                  searchParams.interests.some((si: string) => i.toLowerCase().includes(si.toLowerCase()))
                )
              );
            }

            // If filtering was too strict, fallback to original matches
            const finalResults = filteredResults.length > 0 ? filteredResults : matches.filter((m: any) => m.id !== profile.id);

            await logAgentAction(profile.id, 'search', `Searched for: ${query}. Found ${finalResults.length} matches.`);

            const topResults = finalResults.slice(0, 1);
            
            if (topResults.length === 0) {
              safeSendMessage(chatId, "I couldn't find anyone matching that description yet.");
              return;
            }

            for (const r of topResults) {
              // Fetch photo_file_id directly to ensure we have it even if RPC is outdated
              const { data: profileData } = await supabase.from('profiles').select('photo_file_id').eq('id', r.id).single();
              const photoFileId = profileData?.photo_file_id || r.photo_file_id;

              const resultText = `*${r.name}* (${r.location || 'Unknown'})\n\n✨ ${r.semantic_summary || r.bio || r.working_on || 'A great connection.'}`;
              const keyboard = {
                inline_keyboard: [[
                  { text: `🤝 Connect with ${r.name}`, callback_data: `accept_match:${r.id}` }
                ]]
              };
              
              if (photoFileId) {
                try {
                  await bot?.sendPhoto(chatId, photoFileId, {
                    caption: resultText,
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                  });
                } catch (e) {
                  console.error("Failed to send photo_file_id:", photoFileId, e);
                  // Fallback to default placeholder if photo fails
                  await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                    caption: resultText,
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                  });
                }
              } else {
                // Use the default profile picture for users without photos
                await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                  caption: resultText,
                  parse_mode: "Markdown",
                  reply_markup: keyboard
                });
              }
            }
          } catch (error) {
            console.error("Bot search error:", error);
            safeSendMessage(chatId, "Sorry, I ran into an error while searching. Please try again later.");
          }
          return;
        }

      // Handle Conversational AI (Concierge)
      if (intent === "connect") {
        let searchEmbedding = profile.embedding;
        let searchParams = { role: null, location: null, interests: [] };
        
        console.log("Processing connection request:", text);
        
        try {
          [searchEmbedding, searchParams] = await Promise.all([
            generateEmbedding(text),
            extractSearchParams(text)
          ]);
          console.log("Extracted search params:", searchParams);
        } catch (e) {
          console.error("Failed to generate search embedding or extract params, falling back to profile embedding");
        }

        // Fetch more candidates to re-rank
        const { data: matches } = await supabase.rpc("match_profiles", {
          query_embedding: formatEmbedding(searchEmbedding),
          match_threshold: 0.3,
          match_count: 50 // Get more to filter out existing matches
        });

        let skippedNames: string[] = [];
        
        if (matches && matches.length > 0) {
          // Fetch full profiles for re-ranking
          const candidateIds = matches.map((m: any) => m.id).filter((id: string) => id !== profile.id);
          
          const freshCandidateIds: string[] = [];
          
          // Step 2: For each candidate user: Check if match already exists in matches table
          for (const candidateId of candidateIds) {
            const candidate = matches.find((m: any) => m.id === candidateId);
            const { data: existingMatch, error: matchError } = await supabase
              .from("matches")
              .select("id")
              .or(`and(user_a.eq.${profile.id},user_b.eq.${candidateId}),and(user_a.eq.${candidateId},user_b.eq.${profile.id})`)
              .limit(1);
              
            if (matchError) {
              console.error(`Error checking match for ${candidateId}:`, matchError);
              continue; // Skip on error to be safe
            }

            // Step 3: If match exists -> skip candidate
            if (existingMatch && existingMatch.length > 0) {
              console.log(`Skipping candidate ${candidateId} - match already exists.`);
              if (candidate && candidate.name) {
                skippedNames.push(candidate.name);
              }
              continue;
            }
            
            // Step 4: If match does not exist -> select candidate
            freshCandidateIds.push(candidateId);
          }

          console.log(`Found ${freshCandidateIds.length} fresh candidates out of ${candidateIds.length} total candidates.`);

          if (freshCandidateIds.length > 0) {
            const { data: fullProfiles, error: profilesError } = await supabase.from("profiles").select("*").in("id", freshCandidateIds);
            
            if (profilesError) console.error("Error fetching candidate profiles:", profilesError);
            
            if (fullProfiles && fullProfiles.length > 0) {
              // Fetch user's direct connections
              const { data: userRels } = await supabase
                .from('user_interactions')
                .select('user_a, user_b, strength')
                .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`);
              
              const directConnIds = (userRels || []).map(r => r.user_a === profile.id ? r.user_b : r.user_a);
              
              let directProfiles: any[] = [];
              if (directConnIds.length > 0) {
                const { data } = await supabase.from('profiles').select('id, name').in('id', directConnIds);
                directProfiles = data || [];
              }
              
              // Fetch relationships for candidates
              const { data: candidateRelsA } = await supabase.from('user_interactions').select('user_a, user_b, strength').in('user_a', freshCandidateIds);
              const { data: candidateRelsB } = await supabase.from('user_interactions').select('user_a, user_b, strength').in('user_b', freshCandidateIds);
              const allCandidateRels = [...(candidateRelsA || []), ...(candidateRelsB || [])];

              // Multi-signal scoring
              const rankedMatches = fullProfiles.map((candidate: any) => {
                const vectorSim = matches.find((m: any) => m.id === candidate.id)?.similarity || 0;
                
                // 1. Location Match (0.2)
                const locationMatch = (searchParams.location && candidate.location?.toLowerCase().includes(searchParams.location.toLowerCase())) || 
                                      (candidate.location?.toLowerCase() === profile.location?.toLowerCase()) ? 1 : 0;
                
                // 2. Shared Interest Overlap (0.1)
                const userInterests = profile.interests || [];
                const candidateInterests = candidate.interests || [];
                const sharedInterests = userInterests.filter((i: string) => candidateInterests.includes(i));
                const interestOverlap = userInterests.length > 0 ? sharedInterests.length / userInterests.length : 0;
                
                // 3. Social Graph Proximity
                const candidateDirectConnIds = allCandidateRels
                  .filter(r => r.user_a === candidate.id || r.user_b === candidate.id)
                  .map(r => r.user_a === candidate.id ? r.user_b : r.user_a);
                  
                const mutualIds = candidateDirectConnIds.filter(id => directConnIds.includes(id));
                const mutualNames = directProfiles.filter(p => mutualIds.includes(p.id)).map(p => p.name);
                
                const sharedConnectionsScore = mutualIds.length > 0 ? Math.min(mutualIds.length * 0.5, 1.0) : 0;
                
                // Calculate social graph strength (based on interaction strength of mutuals)
                let socialGraphStrength = 0;
                if (mutualIds.length > 0) {
                  const relevantRels = allCandidateRels.filter(r => 
                    (r.user_a === candidate.id && mutualIds.includes(r.user_b)) ||
                    (r.user_b === candidate.id && mutualIds.includes(r.user_a))
                  );
                  const totalStrength = relevantRels.reduce((sum, r) => sum + (r.strength || 1.0), 0);
                  socialGraphStrength = Math.min(totalStrength / mutualIds.length, 1.0);
                }
                
                // 4. Final Score Calculation
                // The prompt specified: 0.45 * vector_similarity + 0.20 * location_match + 0.15 * interest_overlap + 0.10 * social_graph_strength + 0.10 * shared_connections
                const finalScore = (0.45 * vectorSim) + (0.20 * locationMatch) + (0.15 * interestOverlap) + (0.10 * socialGraphStrength) + (0.10 * sharedConnectionsScore);
                
                return { ...candidate, finalScore, vectorSim, mutualNames };
              }).sort((a: any, b: any) => b.finalScore - a.finalScore);

              const topMatches = rankedMatches.filter((m: any) => m.finalScore > 0.4).slice(0, 5);
              
              if (topMatches.length > 0) {
                await logAgentAction(profile.id, 'generate_matches', `Generated ${topMatches.length} matches using multi-signal algorithm.`);
                
                if (skippedNames.length > 0) {
                  safeSendMessage(chatId, `You've already been introduced to ${skippedNames[0].split(' ')[0]}.\nLooking for new matches...`);
                }
                
                // Store in database queue for persistence across restarts
                try {
                  // Clear existing queue for this user first
                  await supabase.from("match_queue").delete().eq("user_id", profile.id);
                  
                  // Insert new queue
                  const queueEntries = topMatches.map((match: any, index: number) => ({
                    user_id: profile.id,
                    candidate_user_id: match.id,
                    rank: index + 1,
                    shown: index === 0,
                    accepted: false
                  }));
                  
                  await supabase.from("match_queue").insert(queueEntries);
                } catch (e) {
                  console.error("Failed to store match queue in DB:", e);
                }
                
                // Show the first match
                const bestMatch = topMatches[0];
                const matchMessage = await formatMatchMessage(profile, bestMatch, bestMatch.mutualNames || []);
                
                const replyMarkup = {
                  inline_keyboard: [
                    [
                      { text: "Introduce Me", callback_data: `accept_match:${bestMatch.id}` },
                      { text: "Skip", callback_data: `skip_match:${bestMatch.id}` }
                    ]
                  ]
                };

                if (matchMessage.photo_file_id) {
                  try {
                    await bot?.sendPhoto(chatId, matchMessage.photo_file_id, {
                      caption: matchMessage.text,
                      reply_markup: replyMarkup
                    });
                  } catch (e) {
                    console.error("Failed to send match photo:", e);
                    await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                      caption: matchMessage.text,
                      reply_markup: replyMarkup
                    });
                  }
                } else {
                  await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                    caption: matchMessage.text,
                    reply_markup: replyMarkup
                  });
                }

                return; // Success!
              }
            }
          }
        }

        // Fallback if no match found
        if (skippedNames.length > 0) {
          safeSendMessage(chatId, `You've already been introduced to ${skippedNames[0].split(' ')[0]}.\nLooking for new matches...`);
        } else {
          safeSendMessage(chatId, "I couldn't find the perfect match yet. I'll notify you when someone joins CircleHQ who matches your interests.");
        }
        return;
      }

      // Fallback to Conversational AI (Concierge) if not a connect intent
      const conciergeResponse = await getConciergeResponse(text, profile);
      safeSendMessage(chatId, conciergeResponse);

    } catch (error: any) {
      console.error("Telegram error:", error);
      if (error?.message?.includes("429") || error?.message?.includes("quota")) {
        safeSendMessage(chatId, "I'm a bit overwhelmed with requests right now! Please try again in a few minutes. (AI Quota reached)");
      } else {
        safeSendMessage(chatId, "Sorry, I encountered an error. Please try again later.");
      }
    }
  });

  bot?.on("callback_query", async (query) => {
    if (!query.data || !query.message) return;
    
    const chatId = query.message.chat.id;
    const telegramId = query.from.id.toString();
    const messageId = query.message.message_id;
    
    // Acknowledge the callback query
    bot?.answerCallbackQuery(query.id);
    
    try {
      // Get user profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("telegram_id", telegramId)
        .single();
        
      if (!profile) return;
      
      const [action, candidateId] = query.data.split(":");
      
      if (action === "accept_match" || action === "accept_previous") {
        // Update database queue
        await supabase.from("match_queue")
          .update({ accepted: true })
          .match({ user_id: profile.id, candidate_user_id: candidateId });
          
        // Fetch candidate profile
        const { data: candidate } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", candidateId)
          .single();
          
        if (candidate) {
          // Generate introduction
          if (action === "accept_match") {
            try {
              await bot?.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
            } catch (e: any) {
              if (e.response && e.response.body && e.response.body.description && e.response.body.description.includes("message is not modified")) {
                // Ignore this specific error
              } else {
                console.error("Error editing message reply markup:", e);
              }
            }
          }
          
          // Calculate mutual connections
          let mutualNames: string[] = [];
          try {
            const { data: userRels } = await supabase
              .from('user_interactions')
              .select('user_a, user_b, strength')
              .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`);
            
            const directConnIds = (userRels || []).map(r => r.user_a === profile.id ? r.user_b : r.user_a);
            
            if (directConnIds.length > 0) {
              const { data: candidateRelsA } = await supabase.from('user_interactions').select('user_a, user_b, strength').eq('user_a', candidate.id);
              const { data: candidateRelsB } = await supabase.from('user_interactions').select('user_a, user_b, strength').eq('user_b', candidate.id);
              const allCandidateRels = [...(candidateRelsA || []), ...(candidateRelsB || [])];
              
              const candidateDirectConnIds = allCandidateRels.map(r => r.user_a === candidate.id ? r.user_b : r.user_a);
              const mutualIds = candidateDirectConnIds.filter(id => directConnIds.includes(id));
              
              if (mutualIds.length > 0) {
                const { data: mutualProfiles } = await supabase.from('profiles').select('name').in('id', mutualIds);
                mutualNames = (mutualProfiles || []).map(p => p.name);
              }
            }
          } catch (e) {
            console.error("Error fetching mutual connections:", e);
          }
          
          const [introTextForA, introTextForB] = await Promise.all([
            generateIntroduction(profile, candidate, mutualNames),
            generateIntroduction(candidate, profile, mutualNames)
          ]);
          
          const messageForA = introTextForA;
          const messageForB = introTextForB;
          
          await logAgentAction(profile.id, 'generate_introduction', `Generated personalized introductions for ${profile.name} and ${candidate.name}.`);
          
          const keyboardForA = {
            inline_keyboard: [[
              { text: "💬 Start Chat with " + candidate.name, url: candidate.username ? "https://t.me/" + candidate.username : "tg://user?id=" + candidate.telegram_id }
            ]]
          };

          const keyboardForB = {
            inline_keyboard: [[
              { text: "💬 Start Chat with " + profile.name, url: profile.username ? "https://t.me/" + profile.username : "tg://user?id=" + profile.telegram_id }
            ]]
          };

          safeSendMessage(chatId, messageForA, { parse_mode: "Markdown", reply_markup: keyboardForA });
          
          // Send introduction message to the other user
          if (candidate.telegram_id) {
            safeSendMessage(candidate.telegram_id, messageForB, { parse_mode: "Markdown", reply_markup: keyboardForB });
          }
          
          // Log introduction and match record
          const results = await Promise.all([
            supabase.from("introductions").insert([{
              user_a: profile.id,
              user_b: candidate.id,
              intro_text: introTextForA // Logging A's intro as the primary one
            }]),
            supabase.from("matches").insert([{
              user_a: profile.id,
              user_b: candidate.id,
              similarity_score: 1
            }]),
            supabase.from("connections").insert([{
              user_a: profile.id,
              user_b: candidate.id,
              connection_strength: 1,
              source: action === "accept_previous" ? "previous_match" : "ai_multi_signal_match"
            }]),
            supabase.from("user_interactions").insert([{
              user_a: profile.id,
              user_b: candidate.id,
              interaction_type: "introduced",
              strength: 1.0
            }]),
            supabase.from("skipped_matches").delete().match({
              user_id: profile.id,
              candidate_user_id: candidate.id
            })
          ]);
          
          results.forEach((res, index) => {
            if (res.error) {
              if (res.error.code === '42P01') {
                console.warn(`Warning: DB operation ${index} failed because a table does not exist. Please run the updated supabase_schema.sql`);
              } else {
                console.error(`Error in DB operation ${index} during accept_match:`, JSON.stringify(res.error, null, 2));
              }
            }
          });
        }
      } else if (action === "skip_match") {
        // Update current match as shown
        try {
          await bot?.deleteMessage(chatId, messageId);
        } catch (e) {
          console.error("Error deleting message:", e);
        }
        safeSendMessage(chatId, "Skipped. Looking for the next match...");
        
        // Mark current candidate as shown in match_queue and also save to skipped_matches
        await supabase.from("match_queue")
          .update({ shown: true })
          .match({ user_id: profile.id, candidate_user_id: candidateId });

        await supabase.from("skipped_matches").insert([{
          user_id: profile.id,
          candidate_user_id: candidateId
        }]);
        
        // Find next candidate in database queue
        const { data: nextMatchQueueItem } = await supabase
          .from("match_queue")
          .select("candidate_user_id")
          .eq("user_id", profile.id)
          .eq("shown", false)
          .order("rank", { ascending: true })
          .limit(1)
          .single();
          
        if (nextMatchQueueItem) {
          const nextCandidateId = nextMatchQueueItem.candidate_user_id;
          
          // Mark as shown immediately
          await supabase.from("match_queue")
            .update({ shown: true })
            .match({ user_id: profile.id, candidate_user_id: nextCandidateId });
            
          // Fetch candidate profile
          const { data: candidate } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", nextCandidateId)
            .single();
            
          if (candidate) {
            const matchMessage = await formatMatchMessage(profile, candidate);
            
            const replyMarkup = {
              inline_keyboard: [
                [
                  { text: "Introduce Me", callback_data: `accept_match:${candidate.id}` },
                  { text: "Skip", callback_data: `skip_match:${candidate.id}` }
                ]
              ]
            };

            if (matchMessage.photo_file_id) {
              try {
                await bot?.sendPhoto(chatId, matchMessage.photo_file_id, {
                  caption: matchMessage.text,
                  reply_markup: replyMarkup
                });
              } catch (e) {
                console.error("Failed to send match photo:", e);
                await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                  caption: matchMessage.text,
                  reply_markup: replyMarkup
                });
              }
            } else {
              await bot?.sendPhoto(chatId, "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", {
                caption: matchMessage.text,
                reply_markup: replyMarkup
              });
            }
          }
        } else {
          safeSendMessage(chatId, "I couldn't find any more perfect matches right now. I'll notify you when someone joins CircleHQ who matches your interests.");
        }
      } else if (action === "feedback_yes" || action === "feedback_no") {
        try {
          await bot?.deleteMessage(chatId, messageId);
        } catch (e) {
          console.error("Error deleting message:", e);
        }
        const score = action === "feedback_yes" ? 1 : -1;
        await supabase.from("introductions").update({ feedback_score: score }).eq("id", candidateId);
        safeSendMessage(chatId, "Thanks for the feedback! This helps me make better matches for you.");
      } else if (action === "find_new_match") {
        try {
          await bot?.deleteMessage(chatId, messageId);
        } catch (e) {
          console.error("Error deleting message:", e);
        }
        safeSendMessage(chatId, "Great! Let me find someone new for you...");
        // Trigger search logic or just tell them to use /search
        safeSendMessage(chatId, "You can use /search to find specific people, or wait for your next serendipity match!");
      } else if (action === "not_now") {
        try {
          await bot?.deleteMessage(chatId, messageId);
        } catch (e) {
          console.error("Error deleting message:", e);
        }
        safeSendMessage(chatId, "No problem. I'll be here when you're ready to network again.");
      }
    } catch (error) {
      console.error("Callback query error:", error);
      safeSendMessage(chatId, "Sorry, I encountered an error. Please try again later.");
    }
  });
}

// API Routes for Dashboard
app.get("/api/stats", async (req, res) => {
  try {
    const { count: profilesCount } = await supabase.from("profiles").select("*", { count: "exact", head: true });
    const { count: connectionsCount } = await supabase.from("connections").select("*", { count: "exact", head: true });
    const { count: introsCount } = await supabase.from("introductions").select("*", { count: "exact", head: true });
    res.json({ profilesCount: profilesCount || 0, connectionsCount: connectionsCount || 0, introsCount: introsCount || 0 });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

app.get("/api/profiles", async (req, res) => {
  try {
    const { q, location, interest } = req.query;
    
    let query = supabase.from("profiles").select("*");

    if (q && typeof q === 'string') {
      const embedding = await generateEmbedding(q);
      const { data, error } = await supabase.rpc("match_profiles", {
        query_embedding: formatEmbedding(embedding),
        match_threshold: 0.3,
        match_count: 50
      });
      if (error) throw error;
      
      let results = data || [];
      
      // Apply additional filters to semantic results if provided
      if (location && typeof location === 'string') {
        results = results.filter((p: any) => p.location?.toLowerCase().includes(location.toLowerCase()));
      }
      if (interest && typeof interest === 'string') {
        results = results.filter((p: any) => p.interests?.some((i: string) => i.toLowerCase().includes(interest.toLowerCase())));
      }
      
      return res.json(results.slice(0, 20));
    }

    // If no semantic query, use standard filters
    if (location && typeof location === 'string') {
      query = query.ilike("location", `%${location}%`);
    }
    if (interest && typeof interest === 'string') {
      query = query.contains("interests", [interest]);
    }

    const { data } = await query.order("created_at", { ascending: false }).limit(20);
    res.json(data || []);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Failed to fetch profiles" });
  }
});

async function runWeeklySerendipityMatch() {
  console.log("Running weekly serendipity match...");
  try {
    const { data: profiles } = await supabase.from("profiles").select("*");
    if (!profiles || profiles.length === 0) return;

    for (const profile of profiles) {
      if (!profile.telegram_id || !profile.embedding) continue;

      // Find candidates
      const { data: matches } = await supabase.rpc("match_profiles", {
        query_embedding: formatEmbedding(profile.embedding),
        match_threshold: 0.3,
        match_count: 20
      });

      if (!matches || matches.length === 0) continue;

      const candidateIds = matches.map((m: any) => m.id).filter((id: string) => id !== profile.id);
      
      let selectedCandidateId = null;
      
      for (const candidateId of candidateIds) {
        const { data: existingMatch } = await supabase
          .from("matches")
          .select("id")
          .or(`and(user_a.eq.${profile.id},user_b.eq.${candidateId}),and(user_a.eq.${candidateId},user_b.eq.${profile.id})`)
          .limit(1);
          
        if (!existingMatch || existingMatch.length === 0) {
          selectedCandidateId = candidateId;
          break;
        }
      }

      if (selectedCandidateId) {
        const { data: candidate } = await supabase.from("profiles").select("*").eq("id", selectedCandidateId).single();
        if (candidate) {
          // Fetch mutual connections
          let mutualNames: string[] = [];
          try {
            const { data: userRels } = await supabase
              .from('user_interactions')
              .select('user_a, user_b, strength')
              .or(`user_a.eq.${profile.id},user_b.eq.${profile.id}`);
            
            const directConnIds = (userRels || []).map(r => r.user_a === profile.id ? r.user_b : r.user_a);
            
            if (directConnIds.length > 0) {
              const { data: candidateRelsA } = await supabase.from('user_interactions').select('user_a, user_b, strength').eq('user_a', candidate.id);
              const { data: candidateRelsB } = await supabase.from('user_interactions').select('user_a, user_b, strength').eq('user_b', candidate.id);
              const allCandidateRels = [...(candidateRelsA || []), ...(candidateRelsB || [])];
              
              const candidateDirectConnIds = allCandidateRels.map(r => r.user_a === candidate.id ? r.user_b : r.user_a);
              const mutualIds = candidateDirectConnIds.filter(id => directConnIds.includes(id));
              
              if (mutualIds.length > 0) {
                const { data: mutualProfiles } = await supabase.from('profiles').select('name').in('id', mutualIds);
                mutualNames = (mutualProfiles || []).map(p => p.name);
              }
            }
          } catch (e) {
            console.error("Error fetching mutual connections for weekly match:", e);
          }

          const matchMessage = await formatMatchMessage(profile, candidate, mutualNames, true);
          
          const replyMarkup = {
            inline_keyboard: [
              [
                { text: "Introduce Me", callback_data: `accept_match:${candidate.id}` },
                { text: "Skip", callback_data: `skip_match:${candidate.id}` }
              ]
            ]
          };

          if (matchMessage.photo_file_id) {
            try {
              await bot?.sendPhoto(profile.telegram_id, matchMessage.photo_file_id, {
                caption: matchMessage.text,
                reply_markup: replyMarkup
              });
            } catch (e) {
              console.error("Failed to send serendipity match photo:", e);
              safeSendMessage(profile.telegram_id, matchMessage.text, {
                reply_markup: replyMarkup
              });
            }
          } else {
            safeSendMessage(profile.telegram_id, matchMessage.text, {
              reply_markup: replyMarkup
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error running weekly serendipity match:", error);
  }
}

// Schedule weekly match (e.g., every Monday at 10:00 AM)
cron.schedule('0 10 * * 1', runWeeklySerendipityMatch);

async function runNudgeSystem() {
  try {
    // 1. Nudge 1 (12 hours)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Fetch intros that are older than 12h but newer than 24h, and haven't been nudged
    const { data: introsToNudge } = await supabase
      .from("introductions")
      .select("*")
      .lt("created_at", twelveHoursAgo)
      .gt("created_at", twentyFourHoursAgo)
      .eq("nudge_1_sent", false);

    if (introsToNudge && introsToNudge.length > 0) {
      for (const intro of introsToNudge) {
        const { data: userA } = await supabase.from("profiles").select("*").eq("id", intro.user_a).single();
        const { data: userB } = await supabase.from("profiles").select("*").eq("id", intro.user_b).single();
        
        if (userA && userB) {
          const nudgeMessage = `👀 Still thinking to reach out to ${userB.name}?\n\nHere's an easy way to start:\n"Hey, we got introduced on CircleHQ — would love to connect!"`;
          const nudgeMessageB = `👀 Still thinking to reach out to ${userA.name}?\n\nHere's an easy way to start:\n"Hey, we got introduced on CircleHQ — would love to connect!"`;

          if (userA.telegram_id) safeSendMessage(userA.telegram_id, nudgeMessage);
          if (userB.telegram_id) safeSendMessage(userB.telegram_id, nudgeMessageB);

          await supabase.from("introductions").update({ nudge_1_sent: true }).eq("id", intro.id);
        }
      }
    }

    // 2. Feedback (24 hours)
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const { data: introsForFeedback } = await supabase
      .from("introductions")
      .select("*")
      .lt("created_at", twentyFourHoursAgo)
      .gt("created_at", fortyEightHoursAgo)
      .eq("feedback_asked", false);

    if (introsForFeedback && introsForFeedback.length > 0) {
      for (const intro of introsForFeedback) {
        const { data: userA } = await supabase.from("profiles").select("*").eq("id", intro.user_a).single();
        const { data: userB } = await supabase.from("profiles").select("*").eq("id", intro.user_b).single();
        
        if (userA && userB) {
          const feedbackMessage = `Did the introduction to ${userB.name} feel useful?`;
          const feedbackMessageB = `Did the introduction to ${userA.name} feel useful?`;

          const keyboardA = {
            inline_keyboard: [[
              { text: "👍 Yes", callback_data: `feedback_yes:${intro.id}` },
              { text: "👎 No", callback_data: `feedback_no:${intro.id}` }
            ]]
          };
          const keyboardB = {
            inline_keyboard: [[
              { text: "👍 Yes", callback_data: `feedback_yes:${intro.id}` },
              { text: "👎 No", callback_data: `feedback_no:${intro.id}` }
            ]]
          };

          if (userA.telegram_id) safeSendMessage(userA.telegram_id, feedbackMessage, { reply_markup: keyboardA });
          if (userB.telegram_id) safeSendMessage(userB.telegram_id, feedbackMessageB, { reply_markup: keyboardB });

          await supabase.from("introductions").update({ feedback_asked: true }).eq("id", intro.id);
        }
      }
    }

    // 3. Nudge 2 (48 hours)
    const { data: introsToNudge2 } = await supabase
      .from("introductions")
      .select("*")
      .lt("created_at", fortyEightHoursAgo)
      .eq("nudge_2_sent", false);

    if (introsToNudge2 && introsToNudge2.length > 0) {
      for (const intro of introsToNudge2) {
        const { data: userA } = await supabase.from("profiles").select("*").eq("id", intro.user_a).single();
        const { data: userB } = await supabase.from("profiles").select("*").eq("id", intro.user_b).single();
        
        if (userA && userB) {
          const nudge2Message = `Want me to find you someone else?`;

          const keyboard = {
            inline_keyboard: [[
              { text: "Find New Match", callback_data: `find_new_match` },
              { text: "Not Now", callback_data: `not_now` }
            ]]
          };

          if (userA.telegram_id) safeSendMessage(userA.telegram_id, nudge2Message, { reply_markup: keyboard });
          if (userB.telegram_id) safeSendMessage(userB.telegram_id, nudge2Message, { reply_markup: keyboard });

          await supabase.from("introductions").update({ nudge_2_sent: true }).eq("id", intro.id);
        }
      }
    }

  } catch (error) {
    console.error("Error running nudge system:", error);
  }
}

// Schedule nudge system (every hour)
cron.schedule('0 * * * *', runNudgeSystem);

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  if (bot) {
    bot.stopPolling();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  if (bot) {
    bot.stopPolling();
  }
  process.exit(0);
});

process.on('SIGUSR2', () => {
  console.log('SIGUSR2 received. Shutting down gracefully...');
  if (bot) {
    bot.stopPolling();
  }
  process.exit(0);
});
