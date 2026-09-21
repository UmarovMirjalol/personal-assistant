import { getDb, isDbConfigured, type Task } from "@/lib/db/client";
import { localDb } from "@/lib/db/local-store";

function useLocal() {
  return !isDbConfigured();
}

export async function createTask(input: {
  userId: string;
  title: string;
  notes?: string;
  priority?: "high" | "medium" | "low";
  dueAt?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  source?: string;
}): Promise<Task> {
  if (useLocal()) {
    return localDb.createTask({
      user_id: input.userId,
      title: input.title,
      notes: input.notes ?? null,
      status: "open",
      priority: input.priority ?? "medium",
      due_at: input.dueAt ?? null,
      scheduled_start: input.scheduledStart ?? null,
      scheduled_end: input.scheduledEnd ?? null,
      source: input.source ?? "manual",
      source_email_id: null,
    });
  }

  const db = getDb();
  const { data, error } = await db
    .from("tasks")
    .insert({
      user_id: input.userId,
      title: input.title,
      notes: input.notes ?? null,
      priority: input.priority ?? "medium",
      due_at: input.dueAt ?? null,
      scheduled_start: input.scheduledStart ?? null,
      scheduled_end: input.scheduledEnd ?? null,
      source: input.source ?? "manual",
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("create task failed");
  return data as Task;
}

export async function listTasks(
  userId: string,
  opts: { status?: "open" | "done" | "cancelled" | "all"; limit?: number } = {}
): Promise<Task[]> {
  if (useLocal()) {
    const rows = await localDb.listTasks(userId, opts.status ?? "open");
    return rows.slice(0, opts.limit ?? 30);
  }

  const db = getDb();
  let q = db
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 30);

  if (opts.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  } else if (!opts.status) {
    q = q.eq("status", "open");
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data as Task[]) ?? [];
}

export async function completeTask(userId: string, taskIdOrTitle: string): Promise<Task | null> {
  if (useLocal()) {
    const open = await localDb.listTasks(userId, "open");
    const task =
      open.find((t) => t.id === taskIdOrTitle) ||
      open.find((t) => t.title.toLowerCase().includes(taskIdOrTitle.toLowerCase()));
    if (!task) return null;
    return localDb.updateTask(task.id, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
  }

  const db = getDb();
  const { data: byId } = await db
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("id", taskIdOrTitle)
    .maybeSingle();

  let task = byId as Task | null;
  if (!task) {
    const { data: list } = await db
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "open")
      .ilike("title", `%${taskIdOrTitle}%`)
      .limit(1);
    task = (list?.[0] as Task) ?? null;
  }
  if (!task) return null;

  const { data, error } = await db
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", task.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Task;
}

export async function getTodayPlan(userId: string, timezone = "UTC") {
  const tasks = await listTasks(userId, { status: "open", limit: 50 });
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  const scheduled = tasks
    .filter((t) => {
      if (!t.scheduled_start) return false;
      const s = new Date(t.scheduled_start);
      return s >= start && s <= end;
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime()
    );

  const dueToday = tasks.filter((t) => {
    if (!t.due_at) return false;
    const d = new Date(t.due_at);
    return d >= start && d <= end;
  });

  const unscheduled = tasks.filter(
    (t) => !t.scheduled_start && !dueToday.find((d) => d.id === t.id)
  );

  return { scheduled, dueToday, unscheduled, timezone };
}
