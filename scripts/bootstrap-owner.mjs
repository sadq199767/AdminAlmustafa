import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
loadEnvFile(".env.local");
const email = process.argv[2];
if (!email || !email.includes("@")) throw new Error("Provide the owner email.");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const { data: owners, error: ownersError } = await admin
  .from("profiles")
  .select("id")
  .eq("role", "owner");
if (ownersError) throw new Error("Apply the database migration first.");
if (owners.length) throw new Error("An owner already exists. No changes made.");
let existing;
for (let page = 1; page <= 100; page++) {
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({
    page,
    perPage: 100,
  });
  if (usersError) throw new Error("Unable to inspect existing accounts.");
  existing = users.users.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing || users.users.length < 100) break;
}
if (existing) {
  const { error } = await admin
    .from("profiles")
    .upsert({ id: existing.id, name: "مصطفى", role: "owner" });
  if (error) throw new Error("Unable to assign owner profile.");
  console.log(
    "Existing account linked as owner. Its password and login credentials were preserved.",
  );
  process.exit(0);
}
const { data, error } = await admin.auth.admin.generateLink({
  type: "invite",
  email,
});
if (error) throw new Error(error.message);
const { error: profileError } = await admin
  .from("profiles")
  .insert({ id: data.user.id, name: "مصطفى", role: "owner" });
if (profileError)
  throw new Error(
    "User created, but owner profile needs repair. No link was printed.",
  );
mkdirSync(".local", { recursive: true });
const url = `http://localhost:3000/activate?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
writeFileSync(
  ".local/owner-access.txt",
  `حساب المالك: ${email}\nافتح الرابط التالي واختر كلمة مرورك. الرابط يستخدم مرة واحدة وتنتهي صلاحيته حسب إعداد Supabase.\n${url}\n`,
);
console.log(
  "Owner account created. One-time activation link saved to .local/owner-access.txt. No email sent.",
);
