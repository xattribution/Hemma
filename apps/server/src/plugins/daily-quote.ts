import type { CoreModule } from "../core/plugin-host.js";

const QUOTES = [
  "A family is a little world created by love.",
  "Teamwork makes the dream work — especially on chore day!",
  "The best things in life are the people we love and the memories we make.",
  "Little moments, big memories.",
  "Home is where your story begins.",
  "Together is our favorite place to be.",
  "Every day may not be good, but there's something good in every day.",
  "Kind words are short to speak, but their echoes are endless.",
  "You're never too old for a family high five.",
  "Do small things with great love.",
];

/**
 * The example plugin — exercises the plugin surface end to end (route,
 * settings, optional/toggleable) and doubles as SDK documentation.
 */
export const dailyQuotePlugin: CoreModule = {
  id: "daily-quote",
  name: "Daily Quote",
  description: "A cheerful quote on the family dashboard, refreshed every day.",
  optional: true,
  register({ app }) {
    app.get("/api/p/daily-quote/today", () => {
      const dayOfYear = Math.floor(
        (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000,
      );
      return { quote: QUOTES[dayOfYear % QUOTES.length] };
    });
  },
};
