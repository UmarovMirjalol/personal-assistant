import { telegramUpdateSchema } from "../src/lib/security/validate";
const body = {
  update_id: Date.now(),
  message: {
    message_id: 999,
    date: Math.floor(Date.now() / 1000),
    text: "помощь",
    chat: { id: 846682305, type: "private" },
    from: { id: 846682305, is_bot: false, first_name: "Mirjalol" },
  },
};
const parsed = telegramUpdateSchema.safeParse(body);
console.log(JSON.stringify(parsed, null, 2));
