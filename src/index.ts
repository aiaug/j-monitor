import express, { Request, Response } from "express";

const app = express();
app.use(express.json());

const PORT = 5000;

const SLACK_WEBHOOK_URL =
  "";

// 🧠 FILTER 1: US location
function filterLocationUS(project: any): string | null {
  const locations = project?.preferred_qualifications?.locations || [];

  const isUSOnly =
    Array.isArray(locations) &&
    locations.length === 1 &&
    locations[0]?.toLowerCase() === "united states";

  return isUSOnly ? "location_us_only" : null;
}

// 🧠 FILTER 2: English skill
function filterEnglishNative(project: any): string | null {
  const skill = project?.preferred_qualifications?.pref_english_skill;

  if (skill === "Native or Bilingual") {
    return "english_native_or_bilingual";
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
    return "high_paid_client";
  }

  return null;
}

function filterBudgetOrExpert(project: any): string | null {
  const budgetStr = project?.budget || "";
  const type = project?.budget_type;
  const experience = project?.experience_level;

  // Extract numbers from string (e.g. "25 - 60 USD" → [25, 60])
  const numbers = (budgetStr.match(/\d+/g) || []).map(Number);

  let max = 0;

  if (numbers.length === 1) {
    max = numbers[0];
  } else if (numbers.length >= 2) {
    max = Math.max(...numbers);
  }

  // Condition 1: hourly > 50
  const isHighHourly =
    type === "hourly" && max > 50;

  // Condition 2: fixed > 2000
  const isHighFixed =
    type === "fixed" && max > 2000;

  // Condition 3: fallback (no clear budget + expert)
  const isExpertFallback =
    (!budgetStr || budgetStr === "Not specified" || max === 0) &&
    experience === "Expert";

  if (isHighHourly || isHighFixed || isExpertFallback) {
    return "highbudget_or_expert";
  }

  return null;
}

// 📤 Slack sender
async function sendToSlack(project: any, tags: string[]) {
  const client = project.client_details || {};

  const country = client.country?.name || "Unknown";
  const title = project.title || "No title";
  const url = project.url || "#";

  const message = {
    text: `
🌍 *${country}* 🔥 ${tags.join(", ")} 
📌 <${url}|${title}>
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
      filterHighPaidClient,
      filterBudgetOrExpert,
    ];

    for (const project of projects) {
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

      console.log(
        `✅ Matched: ${matchedFilters.join(", ")} | ${project.title}`
      );

      await sendToSlack(project, matchedFilters);
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


