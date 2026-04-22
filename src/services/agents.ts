import { GoogleGenAI, Type } from "@google/genai";
import config from "../../config/index.ts";

let aiInstance: GoogleGenAI | null = null;

export function getAI() {
  if (!aiInstance) {
    const apiKey = config.geminiApiKey;
    
    if (!apiKey || apiKey.length < 10) {
      console.error("CRITICAL: GEMINI_API_KEY is missing or too short.");
      throw new Error("Gemini API Key not found. Please add 'GEMINI_API_KEY' to your Secrets in the AI Studio Settings menu (bottom left).");
    }

    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

/**
 * Helper to retry AI calls on 429 (Rate Limit) errors
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const isRateLimit = error?.message?.includes("429") || error?.message?.includes("RESOURCE_EXHAUSTED");
    if (isRateLimit && retries > 0) {
      console.log(`Rate limit hit. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Agent 1: Concierge Agent - Conversational AI
export async function getConciergeResponse(message: string, context: any) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  
  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: message,
    config: {
      systemInstruction: `
        You are the CircleHQ Concierge, a friendly and thoughtful AI networking assistant.
        Your goal is to help users find meaningful connections.
        Be warm, professional, and encouraging.
        Tone: "Hey, I might know someone you should meet." or "Are you looking for collaborators or cofounders?"
        
        Context: ${JSON.stringify(context)}
        
        If the user is asking for a connection and you are about to respond, keep it brief as the system will attempt to find a match.
        If no match is found, you will be the one to follow up.
      `,
    },
  }));

  return response.text?.trim() || "I'm here to help you connect with the right people!";
}

// Agent 0: Intent Agent - Detects what the user wants to do
export async function detectIntent(message: string) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  const prompt = `
    Analyze the user message and determine the intent.
    Message: "${message}"
    
    Intents:
    - "connect": User wants to find a person, match with someone, or be introduced.
    - "chat": General conversation, questions about the bot, or small talk.
    - "reset": User wants to start over or reset their profile.
    
    Return a JSON object: {"intent": "connect" | "chat" | "reset"}
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  }));

  try {
    const res = JSON.parse(response.text || '{"intent": "chat"}');
    return res.intent;
  } catch (e) {
    return "chat";
  }
}

// Agent 2: Identity Agent - Summarizes profile and generates semantic summary
export async function generateSemanticSummary(profileData: any) {
  try {
    const ai = getAI();
    const model = "gemini-3-flash-preview";
    const prompt = `
      Convert the following onboarding answers into a structured professional profile summary.
      Name: ${profileData.name}
      Location: ${profileData.location}
      Working On: ${profileData.working_on}
      Interests: ${Array.isArray(profileData.interests) ? profileData.interests.join(", ") : profileData.interests}
      Looking For: ${profileData.looking_for}

      Output a concise semantic summary (max 2 sentences) that captures their identity, goals, and value proposition.
      Example: "AI founder in Pune building a fintech startup and looking for a technical cofounder."
    `;

    console.log("Generating semantic summary for:", profileData.name);
    const response = await withRetry(() => ai.models.generateContent({
      model,
      contents: prompt,
    }));

    const summary = response.text?.trim() || "";
    console.log("Generated summary:", summary);
    return summary;
  } catch (error) {
    console.error("Error in generateSemanticSummary:", error);
    throw error;
  }
}

// Embedding Service
export async function generateEmbedding(text: string) {
  try {
    if (!text) throw new Error("Text for embedding is empty");
    
    const ai = getAI();
    const model = "gemini-embedding-2-preview"; // Recommended embedding model
    console.log("Generating embedding for text length:", text.length);
    const result = await withRetry(() => ai.models.embedContent({
      model,
      contents: text,
      config: {
        outputDimensionality: 768
      }
    }));
    
    if (!result.embeddings || result.embeddings.length === 0) {
      throw new Error("No embeddings returned from API");
    }
    
    const values = result.embeddings[0].values;
    const arrayValues = Array.from(values);
    console.log("Generated embedding size:", arrayValues.length);
    return arrayValues;
  } catch (error) {
    console.error("Error in generateEmbedding:", error);
    throw error;
  }
}

// Agent 3: Matching Agent (Logic handled in Supabase via pgvector, but we can prepare scoring here if needed)
// The actual search happens in the database.

// Agent 5: Introduction Agent - Generates warm introductions
export async function generateIntroduction(recipient: any, target: any, mutualConnections: string[] = []) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  
  let mutualPrompt = "";
  if (mutualConnections.length > 0) {
    mutualPrompt = `\nCRITICAL: They have mutual connections! One of the bullet points MUST mention this. For example: "You both know ${mutualConnections.join(' and ')}, who connected through CircleHQ."`;
  }
  
  const prompt = `
    Generate a warm, professional introduction for ${recipient.name} about ${target.name}.
    
    Recipient (${recipient.name}):
    Summary: ${recipient.semantic_summary}
    Location: ${recipient.location}
    
    Target (${target.name}):
    Summary: ${target.semantic_summary}
    Location: ${target.location}
    ${mutualPrompt}
    
    You must return a JSON object with two fields:
    1. "reasons": An array of exactly 3 short bullet points explaining why they should connect (e.g. shared interest, location, goal overlap).
    2. "icebreaker": A short, friendly first message ${recipient.name} can send to ${target.name} after this professional networking introduction. Keep it casual and specific based on their shared interests.
    
    Example JSON:
    {
      "reasons": [
        "Both are building AI startups.",
        "Both based in San Francisco.",
        "Complementary skills in design and engineering."
      ],
      "icebreaker": "Hey! Saw you're working on DevOps tools — what kind of infrastructure are you building?"
    }
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  }));

  try {
    const data = JSON.parse(response.text || "{}");
    const reasons = data.reasons || ["Shared professional interests", "Potential for collaboration", "Expanding network"];
    const icebreaker = data.icebreaker || "Hi! CircleHQ suggested we connect. Would love to chat about what you're working on.";
    
    return `🤝 CircleHQ Introduction

${recipient.name} meet ${target.name}

Why you should connect:
• ${reasons[0]}
• ${reasons[1]}
• ${reasons[2]}

💬 Suggested opener:
"${icebreaker}"`;
  } catch (e) {
    console.error("Failed to parse introduction JSON:", e);
    return `🤝 CircleHQ Introduction

${recipient.name} meet ${target.name}

Why you should connect:
• Shared professional interests
• Potential for collaboration
• Expanding network

💬 Suggested opener:
"Hi! CircleHQ suggested we connect. Would love to chat about what you're working on."`;
  }
}

// Agent 6: Learning Agent - Feedback Analysis
export async function analyzeFeedback(feedback: string) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  const prompt = `
    Analyze the following user feedback about an AI-suggested introduction.
    Feedback: "${feedback}"
    
    Determine if the match was successful (1) or unsuccessful (-1).
    Return only the number.
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
  }));

  const score = parseInt(response.text?.trim() || "0");
  return isNaN(score) ? 0 : score;
}

// Agent 7: Search Parameter Extractor
export async function extractSearchParams(query: string) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  const prompt = `
    Extract search parameters from the following networking request:
    "${query}"
    
    Return a JSON object with:
    - role: (string or null) e.g., "DevOps", "Founder", "Designer"
    - location: (string or null) e.g., "Pune", "Mumbai"
    - interests: (array of strings) e.g., ["AI", "Cloud"]
    
    Example: "connect me with devops people in pune interested in startups"
    Output: {"role": "DevOps", "location": "Pune", "interests": ["startups"]}
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  }));

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("Failed to parse search params:", e);
    return { role: null, location: null, interests: [] };
  }
}

// Agent 8: Match Explainer
export async function explainMatch(userA: any, userB: any, query: string) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  const prompt = `
    Explain why these two users are a good match for the request: "${query}"
    
    User A: ${userA.name}, Summary: ${userA.semantic_summary}
    User B: ${userB.name}, Summary: ${userB.semantic_summary}
    
    Keep it very short (1 sentence).
    Focus on the most relevant shared attribute (location, role, or interest).
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
  }));

  return response.text?.trim() || "You have shared interests and goals.";
}

export async function generateMatchReasons(userA: any, userB: any, mutualConnections: string[] = []) {
  const ai = getAI();
  const model = "gemini-3-flash-preview";
  
  let mutualPrompt = "";
  if (mutualConnections.length > 0) {
    mutualPrompt = `\nCRITICAL: They have mutual connections! One of the bullet points MUST mention this. For example: "You both know ${mutualConnections.join(' and ')}, who connected through CircleHQ."`;
  }
  
  const prompt = `
    Given these two user profiles, provide exactly 3 short bullet points explaining why they should connect.
    
    User A:
    Name: ${userA.name}
    Summary: ${userA.semantic_summary}
    
    User B:
    Name: ${userB.name}
    Summary: ${userB.semantic_summary}
    ${mutualPrompt}
    
    Format the output as a JSON array of 3 strings.
    Example: ["Both are building AI startups in NYC.", "Shared interest in machine learning.", "Complementary skills in design and engineering."]
  `;

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json"
    }
  }));

  try {
    const reasons = JSON.parse(response.text || "[]");
    if (Array.isArray(reasons) && reasons.length > 0) {
      return reasons.slice(0, 3);
    }
  } catch (e) {
    console.error("Failed to parse match reasons:", e);
  }
  
  return [
    "You have shared professional interests.",
    "Potential for collaboration or knowledge sharing.",
    "Expanding your network in relevant fields."
  ];
}
