import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Inspect the exact index contents that Git will commit, never print secret values.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const environment = existsSync(".env.local")
  ? parseEnv(readFileSync(".env.local", "utf8"))
  : {};
const localValues = Object.entries(environment).filter(
  ([, value]) => value.length >= 8,
);
const patterns = [
  [
    "JWT credential",
    /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/,
  ],
  ["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{15,}/],
  [
    "GitHub credential",
    /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  ],
  ["Telegram credential", /\b\d{5,20}:[A-Za-z0-9_-]{30,}\b/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const findings = [];
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example")
    findings.push(`${file}: environment file must not be committed`);
  if (
    /^(?:\.local|\.next|node_modules|\.vercel)\//.test(file) ||
    /\.(?:pem|key)$/.test(file)
  )
    findings.push(`${file}: private or generated file must not be committed`);
  const content = execFileSync("git", ["show", `:${file}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  for (const [name, value] of localValues)
    if (content.includes(value))
      findings.push(`${file}: contains a value from ${name}`);
  for (const [name, pattern] of patterns)
    if (pattern.test(content)) findings.push(`${file}: ${name}`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(
  `PASS: ${files.length} staged files checked; no local environment values or recognized credentials found.`,
);
