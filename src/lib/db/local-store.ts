/**
 * Local JSON persistence when Supabase is not configured.
 * Enough for Telegram MVP (users, tasks, reminders, settings, memory).
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  User,
  Settings,
  Task,
  Reminder,
  ConversationMessage,
  MemoryItem,
  PendingAction,
  EmailRow,
  EmailSummary,
} from "@/lib/db/client";

const DATA_DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "store.json");

type Store = {
  users: User[];
  settings: Settings[];
  tasks: Task[];
  reminders: Reminder[];
  conversation_messages: ConversationMessage[];
  memory_items: MemoryItem[];
  pending_actions: PendingAction[];
  emails: EmailRow[];
  email_summaries: EmailSummary[];
  rate_limits: Array<{ key: string; count: number; window_start: string }>;
};

const empty = (): Store => ({
  users: [],
  settings: [],
  tasks: [],
  reminders: [],
  conversation_messages: [],
  memory_items: [],
  pending_actions: [],
  emails: [],
  email_summaries: [],
  rate_limits: [],
});

let cache: Store | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(FILE, "utf8");
    cache = { ...empty(), ...JSON.parse(raw) };
  } catch {
    cache = empty();
  }
  return cache!;
}

function persist(store: Store) {
  cache = store;
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
  });
  return writeChain;
}

function now() {
  return new Date().toISOString();
}

export const localDb = {
  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    const s = await load();
    return s.users.find((u) => u.telegram_id === telegramId) ?? null;
  },

  async listOwners(): Promise<User[]> {
    const s = await load();
    return s.users.filter((u) => u.is_owner);
  },

  async countUsers(): Promise<number> {
    return (await load()).users.length;
  },

  async createUser(input: {
    telegram_id: number;
    telegram_username?: string | null;
    display_name?: string | null;
    is_owner: boolean;
  }): Promise<User> {
    const s = await load();
    const user: User = {
      id: randomUUID(),
      telegram_id: input.telegram_id,
      telegram_username: input.telegram_username ?? null,
      display_name: input.display_name ?? null,
      timezone: "UTC",
      locale: "ru",
      is_owner: input.is_owner,
      gmail_email: null,
      gmail_access_token_enc: null,
      gmail_refresh_token_enc: null,
      gmail_token_expiry: null,
      gmail_history_id: null,
      gmail_watch_expiration: null,
      created_at: now(),
      updated_at: now(),
    };
    s.users.push(user);
    const settings: Settings = {
      id: randomUUID(),
      user_id: user.id,
      notify_email_priority: "medium",
      morning_briefing_enabled: false,
      morning_briefing_hour: 8,
      language: "ru",
      email_digest_include_low: false,
      max_emails_per_analysis: 15,
      preferences: {},
      created_at: now(),
      updated_at: now(),
    };
    s.settings.push(settings);
    await persist(s);
    return user;
  },

  async updateUser(id: string, patch: Partial<User>): Promise<User> {
    const s = await load();
    const idx = s.users.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error("user not found");
    s.users[idx] = { ...s.users[idx], ...patch, updated_at: now() };
    await persist(s);
    return s.users[idx];
  },

  async getUser(id: string): Promise<User | null> {
    return (await load()).users.find((u) => u.id === id) ?? null;
  },

  async getSettings(userId: string): Promise<Settings> {
    const s = await load();
    const st = s.settings.find((x) => x.user_id === userId);
    if (!st) throw new Error("settings missing");
    return st;
  },

  async updateSettings(userId: string, patch: Partial<Settings>): Promise<Settings> {
    const s = await load();
    const idx = s.settings.findIndex((x) => x.user_id === userId);
    if (idx < 0) throw new Error("settings missing");
    s.settings[idx] = { ...s.settings[idx], ...patch, updated_at: now() };
    await persist(s);
    return s.settings[idx];
  },

  async createTask(input: Omit<Task, "id" | "created_at" | "updated_at" | "completed_at"> & {
    completed_at?: string | null;
  }): Promise<Task> {
    const s = await load();
    const task: Task = {
      ...input,
      id: randomUUID(),
      completed_at: input.completed_at ?? null,
      created_at: now(),
      updated_at: now(),
    };
    s.tasks.push(task);
    await persist(s);
    return task;
  },

  async listTasks(userId: string, status?: string): Promise<Task[]> {
    const s = await load();
    return s.tasks
      .filter((t) => t.user_id === userId && (!status || status === "all" || t.status === status))
      .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  },

  async updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
    const s = await load();
    const idx = s.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    s.tasks[idx] = { ...s.tasks[idx], ...patch, updated_at: now() };
    await persist(s);
    return s.tasks[idx];
  },

  async createReminder(input: {
    user_id: string;
    text: string;
    remind_at: string;
    recurrence?: string | null;
    recurrence_rule?: string | null;
    related_task_id?: string | null;
  }): Promise<Reminder> {
    const s = await load();
    const r: Reminder = {
      id: randomUUID(),
      user_id: input.user_id,
      text: input.text,
      remind_at: input.remind_at,
      status: "pending",
      recurrence: input.recurrence ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
      related_task_id: input.related_task_id ?? null,
      created_at: now(),
      sent_at: null,
    };
    s.reminders.push(r);
    await persist(s);
    return r;
  },

  async listReminders(userId: string, status = "pending"): Promise<Reminder[]> {
    const s = await load();
    return s.reminders
      .filter((r) => r.user_id === userId && (status === "all" || r.status === status))
      .sort((a, b) => a.remind_at.localeCompare(b.remind_at));
  },

  async updateReminder(id: string, patch: Partial<Reminder>) {
    const s = await load();
    const idx = s.reminders.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    s.reminders[idx] = { ...s.reminders[idx], ...patch };
    await persist(s);
    return s.reminders[idx];
  },

  async dueReminders(iso: string): Promise<Reminder[]> {
    const s = await load();
    return s.reminders.filter((r) => r.status === "pending" && r.remind_at <= iso);
  },

  async appendConversation(userId: string, role: ConversationMessage["role"], content: string) {
    const s = await load();
    s.conversation_messages.push({
      id: randomUUID(),
      user_id: userId,
      role,
      content,
      created_at: now(),
    });
    s.conversation_messages = s.conversation_messages
      .filter((m) => m.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 30)
      .concat(s.conversation_messages.filter((m) => m.user_id !== userId));
    await persist(s);
  },

  async getRecentConversation(userId: string, limit = 12) {
    const s = await load();
    return s.conversation_messages
      .filter((m) => m.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-limit);
  },

  async clearConversation(userId: string) {
    const s = await load();
    s.conversation_messages = s.conversation_messages.filter((m) => m.user_id !== userId);
    await persist(s);
  },

  async listMemory(userId: string) {
    const s = await load();
    return s.memory_items.filter((m) => m.user_id === userId && m.active);
  },

  async addMemory(userId: string, content: string, kind: MemoryItem["kind"]) {
    const s = await load();
    const item: MemoryItem = {
      id: randomUUID(),
      user_id: userId,
      kind,
      content,
      active: true,
      created_at: now(),
      updated_at: now(),
    };
    s.memory_items.push(item);
    await persist(s);
    return item;
  },

  async forgetMemory(userId: string, query: string) {
    const s = await load();
    const q = query.toLowerCase();
    let n = 0;
    for (const m of s.memory_items) {
      if (m.user_id === userId && m.active && m.content.toLowerCase().includes(q)) {
        m.active = false;
        n += 1;
      }
    }
    await persist(s);
    return n;
  },

  async clearAllMemory(userId: string) {
    const s = await load();
    for (const m of s.memory_items) {
      if (m.user_id === userId) m.active = false;
    }
    s.conversation_messages = s.conversation_messages.filter((m) => m.user_id !== userId);
    await persist(s);
  },

  async createPending(input: Omit<PendingAction, "id" | "created_at" | "expires_at" | "status" | "telegram_message_id"> & {
    status?: PendingAction["status"];
  }) {
    const s = await load();
    const row: PendingAction = {
      id: randomUUID(),
      user_id: input.user_id,
      kind: input.kind,
      payload: input.payload,
      status: input.status ?? "pending",
      telegram_message_id: null,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: now(),
    };
    s.pending_actions.push(row);
    await persist(s);
    return row;
  },

  async getPending(id: string) {
    return (await load()).pending_actions.find((p) => p.id === id) ?? null;
  },

  async updatePending(id: string, patch: Partial<PendingAction>) {
    const s = await load();
    const idx = s.pending_actions.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    s.pending_actions[idx] = { ...s.pending_actions[idx], ...patch };
    await persist(s);
    return s.pending_actions[idx];
  },

  async listPending(userId: string, kind?: string) {
    const s = await load();
    return s.pending_actions.filter(
      (p) =>
        p.user_id === userId &&
        p.status === "pending" &&
        (!kind || p.kind === kind)
    );
  },
};
