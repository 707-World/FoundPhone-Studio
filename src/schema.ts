import { z } from "zod";
export const uid = () => crypto.randomUUID();
export const itemSchema = z.object({
  id: z.string(),
  title: z.string().max(1000),
  body: z.string().max(200000),
  richText: z.string().max(400000).default(""),
  meta: z
    .record(
      z.string().max(60),
      // 作者填的普通属性值仍然收得很紧；带 data: 的图片/音频（头像、封面）
      // 本身就是 base64，另给额度 —— 它们要走 safeMedia 那道校验。
      z
        .string()
        .max(400000)
        .refine((v) => v.startsWith("data:") || v.length <= 2000, {
          message: "属性值过长",
        }),
    )
    .default({}),
  time: z.string(),
  sender: z.string(),
  avatar: z.string().default(""),
  kind: z
    .enum([
      "text",
      "image",
      "audio",
      "video",
      "file",
      "transfer",
      "call",
      "order",
      "note",
      "post",
      "event",
    ])
    .default("text"),
  media: z.string().default(""),
  hidden: z.boolean().default(false),
  unlock: z.string().default(""),
  password: z.string().default(""),
  folder: z.string().default(""),
  favorite: z.boolean().default(false),
  outgoing: z.boolean().default(false),
  read: z.boolean().default(false),
  likes: z.number().default(0),
  comments: z.array(z.string()).default([]),
});
export type Item = z.infer<typeof itemSchema>;
export const conditionSchema = z.object({
  key: z.string(),
  op: z.enum(["eq", "neq", "gt", "lt", "includes"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type Condition = z.infer<typeof conditionSchema>;
export const actionSchema = z.object({
  type: z.enum([
    "date",
    "variable",
    "unlock",
    "hide",
    "notification",
    "message",
    "time",
    "ending",
    "choice",
    "clue",
    "call",
    /** 解锁一条“待玩家点击推进”的剧情台词或素材 */
    "reveal",
    /** 记一个“剧情点”名字，供 named 触发的节点醒来 */
    "flag",
    /** 记一条剧情台词：按名字排队，由引擎逐条放出来 */
    "line",
    /** 关掉某个应用（删不掉的联系人、卸载后照样收到消息都在这里体现） */
    "forceOff",
    /** 反过来：替他把这个东西点开（相册里那张照片） */
    "open",
  ]),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  /** reveal 专用：操作哪条内容（默认 key） */
  targetId: z.string().optional(),
});
export type Action = z.infer<typeof actionSchema>;
export const nodeSchema = z.object({
  delayMs: z.number().int().min(0).max(86400000).optional(),
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "start",
    "event",
    "condition",
    "action",
    "choice",
    "delay",
    "ending",
    "comment",
  ]),
  event: z.string(),
  target: z.string(),
  conditions: z.array(conditionSchema),
  logic: z.enum(["and", "or", "not"]).default("and"),
  actions: z.array(actionSchema),
  next: z.array(z.string()),
  once: z.boolean(),
  x: z.number(),
  y: z.number(),
});
export type StoryNode = z.infer<typeof nodeSchema>;
export const workSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000),
  category: z.string(),
  cover: z.string(),
  updatedAt: z.number(),
  phone: z.object({
    owner: z.string(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    passcode: z.string().max(12),
    wallpaper: z.string(),
    theme: z.enum(["light", "dark"]),
    time: z.string(),
    battery: z.number().min(0).max(100),
    network: z.string(),
    notifications: z.boolean(),
  }),
  apps: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        installed: z.boolean().default(true),
        visible: z.boolean(),
        dock: z.boolean(),
        folder: z.string(),
        icon: z.string(),
      }),
    )
    .max(100),
  data: z.record(z.string(), z.array(itemSchema).max(20000)),
  nodes: z.array(nodeSchema).max(2000),
  variables: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
  mode: z.enum(["explore", "story", "mixed"]),
});
export type Work = z.infer<typeof workSchema>;
export type UiValue = string | number | boolean | string[];
export type Runtime = {
  date?: string;
  elapsedMs?: number;
  clockRemainderMs?: number;
  scheduled?: { nodeId: string; due: number }[];
  incomingCall?: {
    caller: string;
    target: string;
    status: "ringing" | "answered";
  } | null;
  /** 已经打进来的来电（含被挂断的记录），结局分支用 */
  callLog?: ("answer" | "decline")[];
  /** 被强制关掉的内容：删除好友 / 卸载应用都在这 */
  forcedOff?: string[];
  /** 被强制打开的内容：他替玩家点开的那一张照片、那一段对话 */
  open?: Record<string, string>;
  /** 结局定格：blackScreen 之后整个屏幕黑掉 */
  screenOff?: boolean;
  ui?: Record<string, Record<string, UiValue>>;
  workId: string;
  revision: number;
  variables: Record<string, string | number | boolean>;
  visited: string[];
  read: string[];
  clues: string[];
  unlocked: string[];
  hidden: string[];
  completed: string[];
  notifications: string[];
  endings: string[];
  choices: { label: string; target: string }[];
  messages: Record<string, Item[]>;
  time: string;
  trace: string[];
};
export function initialRuntime(w: Work): Runtime {
  return {
    date: w.phone.date,
    elapsedMs: 0,
    clockRemainderMs: 0,
    scheduled: [],
    incomingCall: null,
    callLog: [],
    forcedOff: [],
    open: {},
    screenOff: false,
    ui: {},
    workId: w.id,
    revision: w.updatedAt,
    variables: { ...w.variables },
    visited: [],
    read: [],
    clues: [],
    unlocked: [],
    hidden: [],
    completed: [],
    notifications: [],
    endings: [],
    choices: [],
    messages: {},
    time: w.phone.time,
    trace: [],
  };
}
export function makeItem(partial: Partial<Item> = {}): Item {
  return itemSchema.parse({
    id: uid(),
    title: "新内容",
    body: "在这里写下故事…",
    time: "2026-09-01 08:30",
    sender: "小林",
    ...partial,
  });
}
export function validateWork(input: unknown): Work {
  return workSchema.parse(input);
}
export function safeMedia(value: string) {
  return /^data:(image\/(png|jpeg|webp|gif)|audio\/(mpeg|mp3|wav|ogg|webm|mp4)|video\/(mp4|webm));base64,[a-zA-Z0-9+/=\s]+$/.test(
    value,
  )
    ? value
    : "";
}

/**
 * 聊天里显示的时刻：只取「时:分」。
 * 台词时间精确到秒（用来保证剧本顺序），直接 slice(-5) 会把 14:52:20 截成 52:20。
 */
export function clockOf(time: string): string {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(time || "");
  if (!m) return time || "";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
