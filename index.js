// index.js
const severityRank = { low: 1, medium: 2, high: 3 };

function getInput(name, fallback = "") {
  // GitHub Actions provides inputs as env vars: INPUT_<NAME>
  const key = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  return process.env[key] ?? fallback;
}

function parseCsv(input) {
  return input
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeRisk(risk) {
  const r = String(risk || "").toLowerCase();
  if (r === "high" || r === "medium" || r === "low") return r;
  return "low";
}

function icon(risk) {
  if (risk === "high") return "✖";
  if (risk === "medium") return "⚠";
  return "✔";
}

function annotationPrefix(sev) {
  if (sev === "high") return "::error::";
  if (sev === "medium") return "::warning::";
  return "::notice::";
}

function issueToMessage(issue) {
  // Supports both simple string issues and structured issues
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") {
    return issue.message || issue.title || JSON.stringify(issue);
  }
  return String(issue);
}

function inferSeverityFromIssue(issue, fallbackPairRisk) {
  // If API provides severity, use it; else infer.
  if (issue && typeof issue === "object" && issue.severity) {
    return normalizeRisk(issue.severity);
  }
  const msg = issueToMessage(issue).toLowerCase();
  if (msg.includes("missing snapshot for production") || msg.includes("app_debug")) return "high";
  if (msg.includes("missing env key") || msg.includes("mismatch")) return "medium";
  return normalizeRisk(fallbackPairRisk);
}

async function main() {
  const apiKey = getInput("api_key");
  const apiUrl = String(getInput("api_url")).replace(/\/$/, "");
  const baseline = getInput("baseline", "production");
  const environments = parseCsv(getInput("environments", "staging,production"));
  const failOn = normalizeRisk(getInput("fail_on", "high"));
  const annotate = String(getInput("annotate", "true")).toLowerCase() !== "false";

  if (!apiKey) throw new Error("Missing required input: api_key");
  if (!apiUrl) throw new Error("Missing required input: api_url");

  const url = `${apiUrl}/api/compare`;
  const body = { environments, baseline };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`CloudMonitor compare returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.message ? `: ${json.message}` : "";
    throw new Error(`CloudMonitor compare failed (status ${res.status})${msg}`);
  }

  const globalRisk = normalizeRisk(json.risk);
  const pairs = json.pairs || {};
  const pairEntries = Object.entries(pairs);

  // Summary
  let counts = { high: 0, medium: 0, low: 0 };
  let totalIssues = 0;

  for (const [, data] of pairEntries) {
    const r = normalizeRisk(data?.risk);
    counts[r] += 1;
    totalIssues += Array.isArray(data?.issues) ? data.issues.length : 0;
  }

  console.log(`CloudMonitor baseline=${baseline} risk=${globalRisk.toUpperCase()} pairs=${pairEntries.length} issues=${totalIssues}`);
  console.log(`Pairs: ${counts.high} HIGH / ${counts.medium} MED / ${counts.low} LOW`);

  // Print only pairs with issues
  for (const [pairName, data] of pairEntries) {
    const r = normalizeRisk(data?.risk);
    const issues = Array.isArray(data?.issues) ? data.issues : [];
    if (!issues.length) continue;

    console.log(`\n${icon(r)} ${pairName} (${r.toUpperCase()})`);
    for (const issue of issues) {
      const msg = issueToMessage(issue);
      console.log(`  - ${msg}`);

      if (annotate) {
        const sev = inferSeverityFromIssue(issue, r);
        // keep annotation short
        console.log(`${annotationPrefix(sev)}${pairName}: ${msg}`);
      }
    }
  }

  // Decide fail
  if (severityRank[globalRisk] >= severityRank[failOn]) {
    console.error(`CloudMonitor: failing because risk=${globalRisk.toUpperCase()} >= fail_on=${failOn.toUpperCase()}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
