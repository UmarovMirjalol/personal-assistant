import { allowedTelegramIds } from "@/lib/env";
import { getDb, isDbConfigured, type User, type Settings } from "@/lib/db/client";
import { localDb } from "@/lib/db/local-store";

export class AccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

function useLocal() {
  return !isDbConfigured();
}

export async function assertTelegramAccess(telegramId: number): Promise<void> {
  const allowlist = allowedTelegramIds();
  if (allowlist.length > 0 && !allowlist.includes(telegramId)) {
    throw new AccessDeniedError(
      "Этот бот личный. Твой Telegram ID не в whitelist."
    );
  }

  if (allowlist.length === 0) {
    if (useLocal()) {
      const owners = await localDb.listOwners();
      if (owners.length > 0 && owners[0].telegram_id !== telegramId) {
        throw new AccessDeniedError(
          "Бот уже привязан к другому пользователю. Добавь свой ID в TELEGRAM_ALLOWED_USER_IDS."
        );
      }
      return;
    }

    const db = getDb();
    const { data: owners } = await db
      .from("users")
      .select("telegram_id")
      .eq("is_owner", true)
      .limit(1);

    if (owners && owners.length > 0 && owners[0].telegram_id !== telegramId) {
      throw new AccessDeniedError(
        "Бот уже привязан к другому пользователю. Добавь свой ID в TELEGRAM_ALLOWED_USER_IDS."
      );
    }
  }
}

export async function getOrCreateUser(input: {
  telegramId: number;
  username?: string;
  displayName?: string;
}): Promise<{ user: User; settings: Settings; isNew: boolean }> {
  await assertTelegramAccess(input.telegramId);

  if (useLocal()) {
    const existing = await localDb.getUserByTelegramId(input.telegramId);
    if (existing) {
      const settings = await localDb.getSettings(existing.id);
      return { user: existing, settings, isNew: false };
    }
    const count = await localDb.countUsers();
    const user = await localDb.createUser({
      telegram_id: input.telegramId,
      telegram_username: input.username ?? null,
      display_name: input.displayName ?? null,
      is_owner: count === 0,
    });
    const settings = await localDb.getSettings(user.id);
    return { user, settings, isNew: true };
  }

  const db = getDb();

  const { data: existing } = await db
    .from("users")
    .select("*")
    .eq("telegram_id", input.telegramId)
    .maybeSingle();

  if (existing) {
    const { data: settings } = await db
      .from("settings")
      .select("*")
      .eq("user_id", existing.id)
      .single();

    if (!settings) {
      const { data: createdSettings, error } = await db
        .from("settings")
        .insert({ user_id: existing.id })
        .select("*")
        .single();
      if (error || !createdSettings) throw error ?? new Error("settings create failed");
      return { user: existing as User, settings: createdSettings as Settings, isNew: false };
    }
    return { user: existing as User, settings: settings as Settings, isNew: false };
  }

  const { count } = await db
    .from("users")
    .select("*", { count: "exact", head: true });

  const isOwner = (count ?? 0) === 0;

  const { data: user, error: userError } = await db
    .from("users")
    .insert({
      telegram_id: input.telegramId,
      telegram_username: input.username ?? null,
      display_name: input.displayName ?? null,
      is_owner: isOwner,
    })
    .select("*")
    .single();

  if (userError || !user) throw userError ?? new Error("user create failed");

  const { data: settings, error: settingsError } = await db
    .from("settings")
    .insert({ user_id: user.id })
    .select("*")
    .single();

  if (settingsError || !settings) {
    throw settingsError ?? new Error("settings create failed");
  }

  return { user: user as User, settings: settings as Settings, isNew: true };
}

export async function getUserByTelegramId(telegramId: number): Promise<User | null> {
  if (useLocal()) return localDb.getUserByTelegramId(telegramId);
  const db = getDb();
  const { data } = await db
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as User) ?? null;
}

export async function getSettings(userId: string): Promise<Settings> {
  if (useLocal()) return localDb.getSettings(userId);
  const db = getDb();
  const { data, error } = await db
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw error ?? new Error("settings missing");
  return data as Settings;
}

export async function updateSettings(
  userId: string,
  patch: Partial<Settings>
): Promise<Settings> {
  if (useLocal()) return localDb.updateSettings(userId, patch);
  const db = getDb();
  const { data, error } = await db
    .from("settings")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("settings update failed");
  return data as Settings;
}

const MAX_CONVERSATION_MESSAGES = 30;

export async function appendConversation(
  userId: string,
  role: "user" | "assistant" | "system",
  content: string
): Promise<void> {
  if (useLocal()) {
    await localDb.appendConversation(userId, role, content.slice(0, 4000));
    return;
  }
  const db = getDb();
  const { error } = await db.from("conversation_messages").insert({
    user_id: userId,
    role,
    content: content.slice(0, 4000),
  });
  if (error) {
    // Don't fail the whole reply for logging issues, but surface once
    console.error("appendConversation failed", error.message);
  }

  const { data: old } = await db
    .from("conversation_messages")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(MAX_CONVERSATION_MESSAGES, MAX_CONVERSATION_MESSAGES + 50);

  if (old && old.length > 0) {
    await db
      .from("conversation_messages")
      .delete()
      .in(
        "id",
        old.map((r: { id: string }) => r.id)
      );
  }
}

export async function getRecentConversation(userId: string, limit = 12) {
  if (useLocal()) return localDb.getRecentConversation(userId, limit);
  const db = getDb();
  const { data } = await db
    .from("conversation_messages")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{ role: string; content: string; created_at: string }>).reverse();
}

export async function clearConversation(userId: string) {
  if (useLocal()) {
    await localDb.clearConversation(userId);
    return;
  }
  const db = getDb();
  await db.from("conversation_messages").delete().eq("user_id", userId);
}

export async function listMemory(userId: string) {
  if (useLocal()) return localDb.listMemory(userId);
  const db = getDb();
  const { data } = await db
    .from("memory_items")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(40);
  return data ?? [];
}

export async function addMemory(
  userId: string,
  content: string,
  kind: "note" | "preference" | "project" | "routine" = "note"
) {
  if (useLocal()) return localDb.addMemory(userId, content, kind);
  const db = getDb();
  const { data, error } = await db
    .from("memory_items")
    .insert({ user_id: userId, content, kind })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function forgetMemory(userId: string, query: string) {
  if (useLocal()) return localDb.forgetMemory(userId, query);
  const db = getDb();
  const { data } = await db
    .from("memory_items")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);

  const q = query.toLowerCase();
  const matches = (data ?? []).filter((m: { content: string }) =>
    m.content.toLowerCase().includes(q)
  );
  if (matches.length === 0) return 0;

  await db
    .from("memory_items")
    .update({ active: false })
    .in(
      "id",
      matches.map((m: { id: string }) => m.id)
    );
  return matches.length;
}

export async function clearAllMemory(userId: string) {
  if (useLocal()) {
    await localDb.clearAllMemory(userId);
    return;
  }
  const db = getDb();
  await db.from("memory_items").update({ active: false }).eq("user_id", userId);
  await clearConversation(userId);
}
