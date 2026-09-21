import { getDb, isDbConfigured, type Reminder } from "@/lib/db/client";
import { localDb } from "@/lib/db/local-store";

function useLocal() {
  return !isDbConfigured();
}

export async function createReminder(input: {
  userId: string;
  text: string;
  remindAt: string;
  recurrence?: string | null;
  recurrenceRule?: string | null;
  relatedTaskId?: string | null;
}): Promise<Reminder> {
  if (useLocal()) {
    return localDb.createReminder({
      user_id: input.userId,
      text: input.text,
      remind_at: input.remindAt,
      recurrence: input.recurrence ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      related_task_id: input.relatedTaskId ?? null,
    });
  }

  const db = getDb();
  const { data, error } = await db
    .from("reminders")
    .insert({
      user_id: input.userId,
      text: input.text,
      remind_at: input.remindAt,
      recurrence: input.recurrence ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      related_task_id: input.relatedTaskId ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("create reminder failed");
  return data as Reminder;
}

export async function listReminders(
  userId: string,
  status: "pending" | "sent" | "all" = "pending"
): Promise<Reminder[]> {
  if (useLocal()) return localDb.listReminders(userId, status);

  const db = getDb();
  let q = db
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("remind_at", { ascending: true })
    .limit(40);

  if (status !== "all") {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data as Reminder[]) ?? [];
}

export async function cancelReminder(userId: string, idOrText: string): Promise<number> {
  if (useLocal()) {
    const pending = await localDb.listReminders(userId, "pending");
    const matches = pending.filter(
      (r) => r.id === idOrText || r.text.toLowerCase().includes(idOrText.toLowerCase())
    );
    for (const m of matches) {
      await localDb.updateReminder(m.id, { status: "cancelled" });
    }
    return matches.length;
  }

  const db = getDb();
  const { data: byId } = await db
    .from("reminders")
    .select("id")
    .eq("user_id", userId)
    .eq("id", idOrText)
    .eq("status", "pending")
    .maybeSingle();

  if (byId) {
    await db.from("reminders").update({ status: "cancelled" }).eq("id", byId.id);
    return 1;
  }

  const { data } = await db
    .from("reminders")
    .select("id, text")
    .eq("user_id", userId)
    .eq("status", "pending")
    .ilike("text", `%${idOrText}%`);

  if (!data?.length) return 0;
  await db
    .from("reminders")
    .update({ status: "cancelled" })
    .in(
      "id",
      data.map((r: { id: string }) => r.id)
    );
  return data.length;
}

export async function dueReminders(now = new Date()): Promise<Reminder[]> {
  if (useLocal()) return localDb.dueReminders(now.toISOString());

  const db = getDb();
  const { data, error } = await db
    .from("reminders")
    .select("*")
    .eq("status", "pending")
    .lte("remind_at", now.toISOString())
    .order("remind_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data as Reminder[]) ?? [];
}

export async function markReminderSent(reminder: Reminder): Promise<void> {
  if (useLocal()) {
    await localDb.updateReminder(reminder.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    if (reminder.recurrence === "daily" || reminder.recurrence === "weekly") {
      const next = new Date(reminder.remind_at);
      if (reminder.recurrence === "daily") next.setDate(next.getDate() + 1);
      if (reminder.recurrence === "weekly") next.setDate(next.getDate() + 7);
      await createReminder({
        userId: reminder.user_id,
        text: reminder.text,
        remindAt: next.toISOString(),
        recurrence: reminder.recurrence,
        recurrenceRule: reminder.recurrence_rule,
        relatedTaskId: reminder.related_task_id,
      });
    }
    return;
  }

  const db = getDb();
  await db
    .from("reminders")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", reminder.id);

  if (reminder.recurrence === "daily" || reminder.recurrence === "weekly") {
    const next = new Date(reminder.remind_at);
    if (reminder.recurrence === "daily") next.setDate(next.getDate() + 1);
    if (reminder.recurrence === "weekly") next.setDate(next.getDate() + 7);
    await createReminder({
      userId: reminder.user_id,
      text: reminder.text,
      remindAt: next.toISOString(),
      recurrence: reminder.recurrence,
      recurrenceRule: reminder.recurrence_rule,
      relatedTaskId: reminder.related_task_id,
    });
  }
}
