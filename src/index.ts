// import express, { Request, Response } from "express";
// import bodyParser from "body-parser";
// import axios from "axios";

// const app = express();
// const PORT = 5001;

// // Telegram config
// const BOT_TOKEN = "8309180494:AAEcLBk2natbM-jaIiQFey_Za8mf6xGt3J8";
// const CHAT_ID = "8058699757"; // fixed chat ID

// app.use(bodyParser.json());

// // Send message to Telegram
// async function sendToTelegram(message: string) {
//   try {
//     await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
//       chat_id: CHAT_ID,
//       text: message,
//       parse_mode: "HTML",
//     });
//   } catch (err) {
//     console.error("❌ Telegram send error:", err);
//   }
// }

// // Format and send each project
// async function processVollnaEvent(projects: any) {
//     if (!Array.isArray(projects) || projects.length === 0) {
//         console.log("no data!!!!!!!!!!!!!!!!!!!!!!!!!")
//         return;
//       }
    
//     for (const project of projects) {
//         const msg = `<b>${project.title}</b>\n<b>Budget:</b> ${project.budget} (${project.budget_type})`;
//         await sendToTelegram(msg);
//     }
// }

// // Vollna webhook endpoint
// app.post("/webhook/vollna", async (req: Request, res: Response) => {
//   const dataFromVollna = req.body.projects;
//   console.log("📩 Incoming data from Vollna:", dataFromVollna);
//   console.log("========================================================")
//   console.log( dataFromVollna.length )
//   console.log(typeof(dataFromVollna))
//   console.log("========================================================")


//   await processVollnaEvent(dataFromVollna);

//   res.status(200).send({ message: "Webhook received and forwarded to Telegram" });
// });

// // Health check
// app.get("/", (req: Request, res: Response) => {
//   res.send("✅ Vollna Webhook Listener is running!");
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server listening on http://localhost:${PORT}`);
// });
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { format } from "date-fns-tz";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN!;
const PORT = Number(process.env.PORT) || 5001;
const KEYWORDS = process.env.KEYWORDS || "web|wordpress|javascript";
const keywordRegex = new RegExp(KEYWORDS, "i");

if (!BOT_TOKEN) throw new Error("BOT_TOKEN not found in .env");

const USERS_FILE = path.join(__dirname, "users.txt");

// ✅ Ensure users.txt exists
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "");
  console.log("🆕 Created users.txt file");
}

// ✅ Load known users into memory
const knownUsers = new Set(
  fs
    .readFileSync(USERS_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("|")[0].trim())
);

// ✅ Start Telegram bot (polling mode — no webhook needed)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🤖 Telegram bot started (polling mode)");

// 🕒 Helper to get current Tokyo time
function getTokyoTime(): string {
  return format(new Date(), "yyyy-MM-dd HH:mm:ssXXX", { timeZone: "Asia/Tokyo" });
}

// 💾 Save a new Telegram user
function saveUser(username: string | undefined, chatId: number): boolean {
  if (!username) username = `id_${chatId}`;

  if (!knownUsers.has(username)) {
    knownUsers.add(username);
    const dateStr = getTokyoTime();
    fs.appendFileSync(USERS_FILE, `${username} | ${chatId} | ${dateStr}\n`);
    console.log(`✅ Added new user: ${username} (${chatId}) at ${dateStr}`);
    return true;
  }
  return false;
}

// 📤 Send a message to all users
async function broadcastToAllUsers(text: string) {
  const lines = fs.readFileSync(USERS_FILE, "utf-8").split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.warn("⚠️ No users to send to.");
    return;
  }

  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    const chatId = Number(parts[1]);
    if (!chatId) continue;

    try {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
      console.log(`📨 Sent message to ${chatId}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${chatId}:`, err);
    }
  }
}

// 💬 Handle Telegram messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from?.username;
  const fullName = `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim() || "there";
  const isNewUser = saveUser(username, chatId);

  // /stop command → unsubscribe
  if (msg.text?.startsWith("/stop")) {
    const lines = fs
      .readFileSync(USERS_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.includes(String(chatId)));
    fs.writeFileSync(USERS_FILE, lines.join("\n") + "\n");
    knownUsers.delete(username || `id_${chatId}`);
    await bot.sendMessage(chatId, "❌ You have been unsubscribed from Vollna alerts.");
    console.log(`🗑️ Removed user: ${chatId}`);
    return;
  }

  // /start or any first message
  if (isNewUser) {
    await bot.sendMessage(chatId, `👋 Dear ${fullName}, you are now subscribed to Vollna project alerts!`);
  } else {
    await bot.sendMessage(chatId, `Hi again, ${fullName}! You’re still subscribed ✅`);
  }
});

//
// ===== Express Server for Vollna Webhook =====
//
const app = express();
app.use(bodyParser.json());

// 📨 Vollna webhook endpoint
app.post("/webhook/vollna", async (req: Request, res: Response) => {
  const data = req.body.projects;

  if (!Array.isArray(data) || data.length === 0) {
    console.log("⚠️ No project data received");
    return res.status(400).send({ error: "Invalid or empty data" });
  }

  console.log(`📩 Received ${data.length} new projects`);
  let jobIndex = 1;
  await broadcastToAllUsers('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟');
  for (const project of data) {
    // Combine searchable fields
    const combinedText = `${project.title || ""} ${project.description || ""} ${project.skills || ""}`;

    // 🔍 Filter using keywords from .env
    if (!keywordRegex.test(combinedText)) {
      console.log(`⏩ Skipped (no keyword match): ${project.title}`);
      continue;
    }

    // Format message (now includes description)
    const msg = `
🌟🌟🌟<b>#${jobIndex} ${KEYWORDS}</b>🌟🌟🌟
    <b>${project.title}</b>
💰 <b>Budget:</b> ${project.budget} (${project.budget_type})
💼 <b>Skills:</b> ${project.skills || "N/A"}
🌍 <b>Country:</b> ${project.client_details?.country?.name || "Unknown"}
⭐️ <b>Client Rank:</b> ${project.client_details.rank || "N/A"}
💳 <b>Payment Verified:</b> ${project.client_details.payment_method_verified ? "✅ Yes" : "❌ No"}
👥 <b>Total Hires:</b> ${project.client_details.total_hires ?? "N/A"}
💸 <b>Total Spent:</b> ${project.client_details.total_spent ?? "N/A"}
⏱️ <b>Avg Hourly Rate Paid:</b> ${project.client_details.avg_hourly_rate_paid ?? "N/A"}
🌟 <b>Rating:</b> ${project.client_details.rating ?? "N/A"}
💬 <b>Reviews:</b> ${project.client_details.reviews ?? "N/A"}
🕐 <b>Registered:</b> ${project.client_details.registered_at ?? "Unknown"}
🧠 <b>Description:</b>
${project.description?.slice(0, 2000) || "No description provided."}

🔗 <a href="${project.url || "#"}">View Project</a>`;

    console.log("-----------------------------------------------------------------------");
    console.log(project);

    await broadcastToAllUsers(msg);
    jobIndex++;
  }

  res.status(200).send({ message: "Projects sent to Telegram subscribers" });
});

// ✅ Health check
app.get("/", (_, res) => res.send("✅ Vollna Webhook Listener + Telegram Bot is running!"));

// 🚀 Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://103.179.45.85:${PORT}`);
  console.log(`🔍 Active keyword filter: ${KEYWORDS}`);
});
