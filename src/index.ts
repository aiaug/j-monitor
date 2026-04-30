import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "5mb" }));
// app.use(express.json());

const PORT = 5000;

const SLACK_WEBHOOK_URL = 
const ENABLED_CATEGORIES = [
  "Accounting & Consulting",
  "Admin Support",
  "Customer Service",
  "Data Science & Analytics",
  "Design & Creative",
  "Engineering & Architecture",
  "IT & Networking",
  "Legal",
  "Sales & Marketing",
  "Translation",
  "Web, Mobile & Software Dev",
  "Writing",
];
const STATS_FILE = path.join(__dirname, "job_stats.txt");

// 🧠 FILTER 1: US location
function filterLocationUS(project: any): string | null {
  const locations = project?.preferred_qualifications?.locations ?? [];
  const usOnlyFlag = project?.us_only;

  const hasUS =
    Array.isArray(locations) &&
    locations.some(
      (loc: string) =>
        typeof loc === "string" &&
        loc.toLowerCase().trim() === "united states"
    );

  const isNotUSOnly = usOnlyFlag !== true;

  if (hasUS && isNotUSOnly) {
    return "US_INCLUDING";
  }

  return null;
}

function filterEnglishNative(project: any): string | null {
  const skill = project?.preferred_qualifications?.pref_english_skill;
  const usOnlyFlag = project?.us_only;

  const isNativeOrBilingual = skill === "Native or Bilingual";
  const isNotUSOnly = usOnlyFlag === false;

  if (isNativeOrBilingual && isNotUSOnly) {
    return "ENGLISH";
  }

  return null;
}

// 🧠 FILTER 3: High-value client
function filterHighPaidClient(project: any): string | null {
  const c = project?.client_details || {};

  const avgRate = c.avg_hourly_rate_paid;
  const spent = c.total_spent;
  const hires = c.total_hires;

  const condition1 = typeof avgRate === "number" && avgRate > 50;

  const condition2 =
    typeof spent === "number" &&
    typeof hires === "number" &&
    hires > 0 &&
    spent / hires > 2000;

  if (condition1 || condition2) {
    return "HIGH_PAID";
  }

  return null;
}

function filterUSOnly(project: any): string | null {
  const usOnlyFlag = project?.us_only;

  if (usOnlyFlag === true) {
    return "ONLY_US";
  }

  return null;
}

function filterLowQualityClient(project: any): string | null {
  const client = project?.client_details || {};

  const rating = client?.rating;
  const categories = project?.categories || [];

  const budgetStr = project?.budget || "";
  const type = project?.budget_type;

  // ⭐ Only Web category now
  const isTechCategory =
    Array.isArray(categories) &&
    categories.some((c: string) =>
      c === "Web, Mobile & Software Dev" ||
      c === "IT & Networking"
    );

  if (!isTechCategory) return null;

  // ⭐ Low rating
  const isLowRating =
    typeof rating === "number" && rating >= 0.5 && rating <= 3.5;

  // ⭐ Extract budget
  const clean = budgetStr.replace(/,/g, "");
  const numbers = (clean.match(/\d+(\.\d+)?/g) || []).map(Number);

  let max = 0;

  if (numbers.length === 1) {
    max = numbers[0];
  } else if (numbers.length >= 2) {
    max = Math.max(...numbers);
  }

  // ⭐ Low budget
  const isLowHourly = type === "hourly" && max <= 10;
  const isLowFixed = type === "fixed" && max <= 20;

  const isLowBudget = isLowHourly || isLowFixed;

  // ✅ FINAL CONDITION (OR logic)
  if (isLowRating || isLowBudget) {
    return "POOR_CLIENT";
  }

  return null;
}

function filterBudgetOrExpert(project: any): string | null {
  const budgetStr = project?.budget || "";
  const type = project?.budget_type;
  const experience = project?.experience_level;

  // ✅ FIX: remove commas before extracting numbers
  const clean = budgetStr.replace(/,/g, "");
  const numbers = (clean.match(/\d+(\.\d+)?/g) || []).map(Number);

  let max = 0;

  if (numbers.length === 1) {
    max = numbers[0];
  } else if (numbers.length >= 2) {
    max = Math.max(...numbers);
  }
  // Condition 1: hourly > 45
  const isHighHourly =
    type === "hourly" && max > 59;

  // Condition 2: fixed > 1999
  const isHighFixed =
    type === "fixed" && max > 1999;

  // Condition 3: fallback (no clear budget + expert)
  // const isExpertFallback =
  //   (!budgetStr || budgetStr === "Not specified" || max === 0) &&
  //   experience === "Expert";

  if (isHighHourly || isHighFixed) {
    return "HIGH_BUDGET";
  }

  return null;
}

function ensureStatsFile() {
  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, "", "utf-8");
  }
}

function readStats(): Record<string, number> {
  ensureStatsFile();

  const data = fs.readFileSync(STATS_FILE, "utf-8");
  const lines = data.split("\n").filter(Boolean);

  const stats: Record<string, number> = {};

  for (const line of lines) {
    const [key, value] = line.split(" : ");
    stats[key] = Number(value) || 0;
  }

  return stats;
}

function writeStats(stats: Record<string, number>) {
  const lines = Object.entries(stats).map(
    ([key, value]) => `${key} : ${value}`
  );

  fs.writeFileSync(STATS_FILE, lines.join("\n"), "utf-8");
}

function updateCategoryStats(project: any) {
  const categories = project?.categories || [];

  if (!Array.isArray(categories) || categories.length === 0) return;

  const key =
    categories.length >= 2
      ? `${categories[0]} → ${categories[1]}`
      : categories[0];

  const stats = readStats();

  stats[key] = (stats[key] || 0) + 1;

  writeStats(stats);
}


// 📤 Slack sender
async function sendToSlack(project: any, tags: string[]) {
  const client = project.client_details || {};

  const countryCode = client.country?.iso_code2 || "";

  const title = project.title || "No title";
  const url = project.url || "#";

  const budget = project?.budget || "Not specified";
  const budgetType = project?.budget_type || "";
  const categories = project?.categories || [];

  const isUSOnly = project?.us_only === true;

  // 🇺🇸 for US-only, otherwise 📌
  // const icon = isUSOnly ? "🔴" : "🔵";

  // convert country code → flag emoji
  function getFlagEmoji(code: string) {
    if (!code) return "🌍";
    return code
      .toUpperCase()
      .replace(/./g, char =>
        String.fromCodePoint(127397 + char.charCodeAt(0))
      );
  }

  const flag = getFlagEmoji(countryCode);

  const categoriesText =
    Array.isArray(categories) && categories.length > 0
      ? categories.join(" → ")
      : "No category";

        // ✅ Low quality marker
  const isLowQuality = tags.includes("POOR_CLIENT");
  const icon = `${isLowQuality ? "⚠️ " : ""} ${isUSOnly ? "🔴" : "🔵"}`;

  // const firstCategory = Array.isArray(categories) ? categories[0] : "";
  // const categoryMark =
  // firstCategory === "Web, Mobile & Software Dev" ||
  // firstCategory === "IT & Networking"
  //   ? "⚡"
  //   : "";

  const totalHires = client?.total_hires;
  const isZeroHire = totalHires === 0;
  const zeroHireMark = isZeroHire ? "❄️" : "";

  const message = {
    text: `
        ${icon} ${flag} ${zeroHireMark} <${url}|${title}>
            ${budget} ${budgetType ? `(${budgetType})` : ""} : ${categoriesText}
            ${tags.join(", ")}
            `.trim(),
  };

  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });
}

// 📨 Webhook endpoint
app.post("/webhook/vollna", async (req: Request, res: Response) => {
  try {
    const projects = req.body?.projects;

    if (!Array.isArray(projects) || projects.length === 0) {
      console.warn("⚠️ No project data received");
      return res.sendStatus(400);
    }

    console.log(`📩 Received ${projects.length} projects`);

    const filters = [
      filterLocationUS,
      filterEnglishNative,
      // filterHighPaidClient,
      // filterBudgetOrExpert,
      filterLowQualityClient,
      filterUSOnly,
    ];

    for (const project of projects) {
      // ✅ CATEGORY CONTROL (ADD HERE)
      const categories = project?.categories || [];
      const isAllowedCategory =
        ENABLED_CATEGORIES.length === 0 ||
        (Array.isArray(categories) &&
          categories.some((c: string) => ENABLED_CATEGORIES.includes(c)));

      if (!isAllowedCategory) {
        continue; // ❌ skip this project early
      }

      const matchedFilters: string[] = [];

      for (const filter of filters) {
        const result = filter(project);
        if (result) matchedFilters.push(result);
      }
      // OR logic: pass if ANY filter matches
      if (matchedFilters.length === 0) {
        console.log("⛔ No filters matched");
        continue;
      }

      await sendToSlack(project, matchedFilters);
      // const isStats = matchedFilters.includes("POOR_CLIENT") || matchedFilters.includes("ENGLISH") || matchedFilters.includes("US_INCLUDING");
      // if (!isStats) {
      //   updateCategoryStats(project);
      // }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error:", err);
    return res.sendStatus(500);
  }
});

// ✅ Health check
app.get("/", (_: Request, res: Response) => {
  res.send("✅ Webhook server running");
});

// 🚀 Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

//pm2 start npx --name jobmonitor -- ts-node src/index.ts   pm2 restart jobmonitor
