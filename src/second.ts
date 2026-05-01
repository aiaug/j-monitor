import express, { Request, Response } from "express";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = 5000;
const SLACK_WEBHOOK_URL =

/* =========================
   CONFIG
========================= */

// 🌍 GLOBAL category whitelist
const GLOBAL_ALLOWED_CATEGORIES = [
  "Web, Mobile & Software Dev",
  "IT & Networking",
  "Data Science & Analytics",
  "Branding & Logo Design",
  "Product Design",
  // "Design & Creative",
];

// 🇺🇸 US excluded categories (ONLY for US jobs)
const US_EXCLUDED_CATEGORIES = [
  "Video & Animation"
];

// 🌍 global countries filter
const ALLOWED_COUNTRIES: string[] = [
  "United States"
];

/* =========================
   PRICE CONFIG (SEPARATE)
========================= */

// 🌍 GLOBAL PRICE RULES
const GLOBAL_PRICE = {
  hourlyMin: 35,
  fixedMin: 2500,
};

// 🇺🇸 US PRICE RULES (separate)
const US_PRICE = {
  hourlyMin: 27,
  fixedMin: 500,
};

/* =========================
   CATEGORY FILTER
========================= */

function passCategory(job: any): boolean {
  const categories = job?.categories || [];
  const isUSOnly = job?.us_only === true;

  // 🇺🇸 US → EXCLUDE MODE
  if (isUSOnly) {
    if (!Array.isArray(categories)) return true;
    if (US_EXCLUDED_CATEGORIES.length === 0) return true;

    return !categories.some((c: string) =>
      US_EXCLUDED_CATEGORIES.includes(c)
    );
  }

  // 🌍 GLOBAL → WHITELIST MODE
  if (GLOBAL_ALLOWED_CATEGORIES.length === 0) return true;

  return categories.some((c: string) =>
    GLOBAL_ALLOWED_CATEGORIES.includes(c)
  );
}

/* =========================
   COUNTRY FILTER
========================= */

function passCountry(job: any): boolean {
  const name = job?.client_details?.country?.name;

  if (!name) return false;
  if (ALLOWED_COUNTRIES.length === 0) return true;

  return ALLOWED_COUNTRIES.includes(name);
}

/* =========================
   BUDGET PARSER
========================= */

function extractMaxBudget(budgetStr: string): number {
  const clean = (budgetStr || "").replace(/,/g, "");
  const numbers = (clean.match(/\d+(\.\d+)?/g) || []).map(Number);

  if (numbers.length === 1) return numbers[0];
  if (numbers.length >= 2) return Math.max(...numbers);

  return 0;
}

/* =========================
   POOR CLIENT LOGIC
========================= */

function isPoorClient(job: any): boolean {
  const c = job?.client_details || {};

  const rating = c?.rating;
  const budgetStr = job?.budget || "";
  const type = job?.budget_type;
  const categories = job?.categories || [];

  // optional focus on relevant categories
  const isTech =
    Array.isArray(categories) &&
    categories.some((cat: string) =>
      ["Web, Mobile & Software Dev", "IT & Networking"].includes(cat)
    );

  if (!isTech) return false;

  // ⭐ rating check
  const lowRating =
    typeof rating === "number" &&
    rating >= 0.5 &&
    rating <= 3.5;

  // ⭐ budget check
  const max = extractMaxBudget(budgetStr);

  const lowHourly = type === "hourly" && max > 0 && max <= 10;
  const lowFixed = type === "fixed" && max > 0 && max <= 20;

  const lowBudget = lowHourly || lowFixed;

  return lowRating || lowBudget;
}

/* =========================
   PRICE FILTER
========================= */

function passPrice(job: any): boolean {
  const type = job?.budget_type;
  const budgetStr = job?.budget || "";
  const isUSOnly = job?.us_only === true;

  if (!type || type === "no" || type === "Not specified") {
    return true;
  }

  const max = extractMaxBudget(budgetStr);

  const rules = isUSOnly ? US_PRICE : GLOBAL_PRICE;

  if (type === "hourly") {
    return max >= rules.hourlyMin;
  }

  if (type === "fixed") {
    return max >= rules.fixedMin;
  }

  return true;
}

/* =========================
   PIPELINE
========================= */

function shouldPass(job: any): boolean {
  return (
    passCategory(job) &&
    passCountry(job) &&
    passPrice(job)
  );
}

/* =========================
   SLACK FORMAT
========================= */

function getFlag(country: any) {
  const code = country?.iso_code2;

  if (!code || typeof code !== "string") return "🌍";

  return code
    .toUpperCase()
    .replace(/./g, (char) =>
      String.fromCodePoint(127397 + char.charCodeAt(0))
    );
}
function formatDate(dateStr?: string): string {
  if (!dateStr) return "N/A";

  const date = new Date(dateStr);

  if (isNaN(date.getTime())) return "N/A";

  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}
function calcAvgSpendPerHire(totalSpent: any, totalHires: any): string {
  const spent = Number(totalSpent);
  const hires = Number(totalHires);

  if (!spent || !hires || hires === 0) return "N/A";

  return Math.floor(spent / hires).toString();
}

function buildSlack(job: any) {
  const c = job?.client_details || {};

  const countryName = c?.country?.name || "";
  const flag = getFlag(c?.country);

  const isPoor = isPoorClient(job);

  const totalHires = c.total_hires;
  const isZeroHire = totalHires === 0;
  const zeroHireMark = isZeroHire ? "❄️" : "";

  const registered = c?.registered_at;

  const avgSpendPerHire = calcAvgSpendPerHire(
    c.total_spent,
    c.total_hires
  );


  const icon = `${isPoor ? "⚠️ " : ""}${job?.us_only ? "🔴" : "🔵"}`;

  return {
    text: `
          ${icon} ${flag} ${zeroHireMark} <${job.url}|${job.title}>
          ${job.budget} (${job.budget_type}) ▲ ${job.experience_level} ▲ ${c.payment_method_verified ? "✅" : "❌ "}
          ${Math.floor(Number(c.total_spent ?? 0))} ▲ ${c.total_hires ?? "N/A"} 🔺 ${Math.floor(Number(c.avg_hourly_rate_paid ?? 0))} ▲ ${avgSpendPerHire}
          ${c.rating ?? "N/A"} ▲ ${formatDate(registered)}
          ${job.categories?.join(" → ") || "N/A"}
          `.trim(),
            };
}

/* =========================
   SLACK SENDER
========================= */

async function sendToSlack(job: any) {
  await fetch(SLACK_WEBHOOK_URL || "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlack(job)),
  });
}

/* =========================
   WEBHOOK  
========================= */

app.post("/webhook/vollna", async (req: Request, res: Response) => {
  try {
    const jobs = req.body?.projects;

    if (!Array.isArray(jobs)) {
      return res.sendStatus(400);
    }

    for (const job of jobs) {
      if (!shouldPass(job)) continue;

      await sendToSlack(job);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});