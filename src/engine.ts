import type { Action, Condition, Runtime, StoryNode, Work } from "./schema";
import { makeItem } from "./schema";
export function testCondition(c: Condition, s: Runtime): boolean {
  const [scope, ...rest] = c.key.split(":");
  const key = rest.join(":");
  const lists: Record<string, string[]> = {
    visited: s.visited,
    read: s.read,
    clue: s.clues,
    unlocked: s.unlocked,
    completed: s.completed,
  };
  const actual =
    scope === "ui"
      ? s.ui?.[rest[0]]?.[rest.slice(1).join(":")]
      : lists[scope]
        ? lists[scope].includes(key)
        : s.variables[c.key];
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "gt":
      return typeof actual === "number" && actual > Number(c.value);
    case "lt":
      return typeof actual === "number" && actual < Number(c.value);
    case "includes":
      return String(actual ?? "").includes(String(c.value));
  }
}
function apply(a: Action, s: Runtime, w: Work) {
  const contentId = a.targetId || a.key;
  switch (a.type) {
    case "reveal":
      // 剧情台词逐条解锁：台词本身解锁后才能被玩家看到
      if (a.value === false || a.value === "false") {
        s.unlocked = s.unlocked.filter((x) => x !== contentId);
      } else if (!s.unlocked.includes(contentId)) {
        s.unlocked.push(contentId);
      }
      break;
    case "date":
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(a.value))) s.date = String(a.value);
      break;
    case "variable":
      s.variables[a.key] = a.value;
      break;
    case "unlock":
      if (!s.unlocked.includes(a.key)) s.unlocked.push(a.key);
      break;
    case "hide":
      if (!s.hidden.includes(a.key)) s.hidden.push(a.key);
      break;
    case "notification":
      s.notifications.push(String(a.value));
      break;
    case "call":
      s.notifications.push(`${String(a.value)} 来电`);
      s.incomingCall = {
        caller: String(a.value),
        target: a.key,
        status: "ringing",
      };
      break;
    case "flag":
      // 剧情点：用 flag:<名字> 记下来，named 触发的节点据此判断该不该醒
      if (!s.unlocked.includes("flag:" + a.key)) s.unlocked.push("flag:" + a.key);
      break;
    case "line":
      // 一次记一个剧情点：台词本体由对应的 reveal 解锁，这里只标“这一段读完了”
      if (!s.unlocked.includes("flag:" + a.key)) s.unlocked.push("flag:" + a.key);
      break;
    case "forceOff":
      s.forcedOff ??= [];
      if (!s.forcedOff.includes(String(a.value || a.key)))
        s.forcedOff.push(String(a.value || a.key));
      if (a.key === "screen") s.screenOff = true;
      break;
    case "open":
      // 反过来：他替玩家把某个东西点开了（相册里那张照片）。
      // key 就是那条内容的 id —— 记成 open[内容id] = true
      s.open ??= {};
      s.open[String(a.value || a.key)] = "true";
      break;
    case "clue":
      if (!s.clues.includes(a.key)) s.clues.push(a.key);
      break;
    case "time":
      s.time = String(a.value);
      s.clockRemainderMs = 0;
      break;
    case "ending":
      if (!s.endings.includes(String(a.value))) s.endings.push(String(a.value));
      break;
    case "choice":
      if (!s.choices.some((c) => c.target === a.key))
        s.choices.push({ label: String(a.value), target: a.key });
      break;
    case "message":
      s.messages[a.key] = [
        ...(s.messages[a.key] ?? []),
        makeItem({
          id: `event-${a.key}-${s.completed.length}-${s.messages[a.key]?.length ?? 0}`,
          title: "新消息",
          sender: w.phone.owner,
          body: String(a.value),
        }),
      ];
      break;
  }
}
function runQueue(
  w: Work,
  s: Runtime,
  event: string,
  target: string,
  queue: string[],
  resuming = new Set<string>(),
  _trigger = event,
  at?: number,
) {
  const seen = new Set<string>();
  let steps = 0;
  while (queue.length && steps++ < 200) {
    const id = queue.shift()!;
    const n = w.nodes.find((n) => n.id === id);
    if (!n || seen.has(id) || (n.once && s.completed.includes(id))) continue;
    seen.add(id);
    const conditions = n.conditions.map((c) => testCondition(c, s));
    const pass =
      n.logic === "or"
        ? conditions.some(Boolean)
        : n.logic === "not"
          ? !conditions.every(Boolean)
          : conditions.every(Boolean);
    if (!pass) continue;
    if (n.type === "delay" && !resuming.has(id)) {
      s.scheduled ??= [];
      if (!s.scheduled.some((t) => t.nodeId === id))
        s.scheduled.push({
          nodeId: id,
          due: (at ?? s.elapsedMs ?? 0) + (n.delayMs ?? 1000),
        });
      s.trace.push(`delay:${n.delayMs ?? 1000}ms → ${n.label}`);
      continue;
    }
    if (!s.completed.includes(id)) s.completed.push(id);
    s.trace.push(`${event}:${target} → ${n.label}`);
    for (const a of n.actions) {
      const previous =
        a.type === "variable"
          ? s.variables[a.key]
          : a.type === "time"
            ? s.time
            : undefined;
      apply(a, s, w);
      if (a.type === "variable" && previous !== s.variables[a.key])
        queue.push(
          ...w.nodes
            .filter(
              (n) =>
                n.event === "variable" && (!n.target || n.target === a.key),
            )
            .map((n) => n.id),
        );
      if (a.type === "time" && previous !== s.time)
        queue.push(
          ...w.nodes
            .filter(
              (n) => n.event === "time" && (!n.target || n.target === s.time),
            )
            .map((n) => n.id),
        );
    }
    if (
      n.type === "ending" &&
      !n.actions.some((a) => a.type === "ending") &&
      !s.endings.includes(n.label)
    )
      s.endings.push(n.label);
    if (n.type === "choice") {
      for (const id of n.next)
        if (!s.choices.some((c) => c.target === id))
          s.choices.push({
            label: w.nodes.find((n) => n.id === id)?.label ?? id,
            target: id,
          });
    } else queue.push(...n.next);
  }
  s.trace = s.trace.slice(-100);
  return s;
}
/**
 * 自动节点（event 为 auto）：条件一满足就立刻执行。
 * 用来让“对方的话”自己弹出来 —— 玩家只需要点出自己说的那几句。
 *
 * 关键：话要**一条一条**地弹。所以这里不直接执行节点，而是把它排进定时队列，
 * 隔 AUTO_GAP_MS 毫秒才真正放出来；同一段对话一次只排一条，
 * 于是一连串回复会像真的在打字一样依次出现，而不是一口气全冒出来。
 */
const AUTO_GAP_MS = 1500;
function runAuto(w: Work, s: Runtime): boolean {
  if (w.mode === "explore") return false;
  s.scheduled ??= [];
  const pending = new Set(s.scheduled.map((x) => x.nodeId));
  const ready = w.nodes.filter(
    (n) =>
      n.event === "auto" &&
      n.type !== "delay" &&
      !pending.has(n.id) &&
      !(n.once && s.completed.includes(n.id)) &&
      n.conditions.every((c) => testCondition(c, s)),
  );
  if (!ready.length) return false;
  // 同一个会话里一次只排一条，保证严格逐条出现
  const onePerThread = new Map<string, string>();
  for (const n of ready) {
    const key = n.target || "_";
    if (!onePerThread.has(key)) onePerThread.set(key, n.id);
  }
  for (const id of onePerThread.values()) {
    const n = w.nodes.find((x) => x.id === id)!;
    const gap = n.delayMs ?? AUTO_GAP_MS;
    s.scheduled.push({ nodeId: n.id, due: (s.elapsedMs ?? 0) + gap });
    s.trace.push(`auto:${gap}ms → ${n.label}`);
  }
  return true;
}
/**
 * 剧情点唤醒。
 *
 * - `named`：所有条件都满足、且还没跑过的节点，立刻跑。它不产生台词，
 *   只负责记剧情点 / 记通知 / 排下一条 `auto`，所以可以一次全跑。
 * - `auto`：真正放台词的那一类，仍然按会话逐条排队（见 runAuto）。
 *
 * 这样剧本就能写成“读完某一段 → 记一个剧情点 → 下一个剧情点醒来”，
 * 不必依赖时钟，节奏完全由玩家推进。
 */
function runStart(w: Work, s: Runtime): boolean {
  if (w.mode === "explore") return false;
  s.scheduled ??= [];
  const pending = new Set(s.scheduled.map((x) => x.nodeId));
  const ready = w.nodes.filter(
    (n) =>
      n.event === "named" &&
      !pending.has(n.id) &&
      !(n.once && s.completed.includes(n.id)) &&
      n.conditions.every((c) => testCondition(c, s)),
  );
  if (!ready.length) return false;
  runQueue(
    w,
    s,
    "named",
    "",
    ready.map((n) => n.id),
    new Set(ready.map((n) => n.id)),
  );
  runAuto(w, s);
  return true;
}
export function dispatch(
  w: Work,
  previous: Runtime,
  event: string,
  target = "",
): Runtime {
  const s = structuredClone(previous);
  if (event === "choose") s.choices = [];
  if (event === "openApp" && !s.visited.includes(target))
    s.visited.push(target);
  if (event === "read" && !s.read.includes(target)) s.read.push(target);
  if (w.mode === "explore") return s;
  let ids = w.nodes
    .filter(
      (n) =>
        (n.type === "start" && event === "start") ||
        (n.event === event && (!n.target || n.target === target)),
    )
    .map((n) => n.id);
  if (event === "search") {
    // 搜的是“含有某个关键词”，不是一模一样的一句话：
    // 搜「首尔艺高 好吃」也要命中只写了「首尔艺高」的那批帖子。
    const cut = target.indexOf(":");
    const app = cut > 0 ? target.slice(0, cut) : "";
    const word = cut > 0 ? target.slice(cut + 1) : target;
    ids = w.nodes
      .filter((n) => {
        if (n.event !== "search") return false;
        const c = (n.target || "").indexOf(":");
        if (c < 0 || !app) return true;
        if (n.target.slice(0, c) !== app) return false;
        return word.includes(n.target.slice(c + 1));
      })
      .map((n) => n.id);
  }
  if (event === "tap") {
    // 一次点击只推进一句：从尚未完成的节点里挑最早的一个。
    // 这里必须连条件一起判断 —— 否则上一句「对方的话」还在打字时玩家抢先一点，
    // 这次点击会被条件不满足的节点吃掉，玩家就白白少看一句。
    const ready = (n: StoryNode) =>
      n.conditions.every((c) => testCondition(c, s));
    const first = w.nodes.find(
      (n) =>
        n.event === "tap" &&
        (!n.target || n.target === target) &&
        !s.completed.includes(n.id) &&
        ready(n),
    );
    ids = first ? [first.id] : [];
  }
  runQueue(w, s, event, target, ids, new Set(), event);
  runAuto(w, s);
  runStart(w, s);
  return s;
}
/** 把条件已满足的等待型节点排进定时队列（延时从“此刻”起算） */
function scheduleDue(w: Work, s: Runtime, at: number, immediate = false) {
  const pending = new Set((s.scheduled ?? []).map((x) => x.nodeId));
  const due = w.nodes.filter(
    (n) =>
      n.type === "delay" &&
      n.conditions.length > 0 &&
      !pending.has(n.id) &&
      !(n.once && s.completed.includes(n.id)) &&
      n.conditions.every((c) =>
        testCondition(c, { ...s, elapsedMs: at } as Runtime),
      ),
  );
  if (!due.length) return false;
  if (immediate) {
    // 条件在很久以前就满足了：补跑时把延时视为已到期
    runQueue(w, s, "timer", due[0].id, due.map((n) => n.id), new Set(due.map((n) => n.id)));
    return true;
  }
  // 延时从“条件满足的那一刻”起算，因此排期基准取触发时刻
  runQueue(
    w,
    s,
    "timer",
    due[0].id,
    due.map((n) => n.id),
    new Set(),
    "timer",
    at,
  );
  return true;
}
export function advance(
  w: Work,
  previous: Runtime,
  milliseconds: number,
): Runtime {
  const s = structuredClone(previous);
  const delta = Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(milliseconds, 86400000))
    : 0;
  const end = (s.elapsedMs ?? 0) + delta;
  s.elapsedMs ??= 0;
  s.clockRemainderMs ??= 0;
  s.scheduled ??= [];
  let resumes = 0;
  if (w.mode !== "explore") runStart(w, s);
  while (true) {
    // 条件已满足但还没排期的等待型节点：先排期，延时从“此刻”起算
    if (w.mode !== "explore" && !s.scheduled.length && scheduleDue(w, s, s.elapsedMs))
      continue;
    // 还没排期的自动台词（对方的话）：按间隔排进去，一条一条地弹
    if (w.mode !== "explore" && !s.scheduled.length && runStart(w, s)) continue;
    if (w.mode !== "explore" && !s.scheduled.length && runAuto(w, s)) continue;
    s.scheduled.sort((a, b) => a.due - b.due);
    const due =
      w.mode !== "explore" && resumes < 200 ? s.scheduled[0] : undefined;
    const clockAt = s.elapsedMs + 60000 - s.clockRemainderMs;
    const next = Math.min(
      end,
      clockAt,
      due ? Math.max(s.elapsedMs, due.due) : Infinity,
    );
    s.clockRemainderMs += next - s.elapsedMs;
    s.elapsedMs = next;
    if (s.clockRemainderMs >= 60000) {
      s.clockRemainderMs -= 60000;
      const match = s.time.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const value = (Number(match[1]) * 60 + Number(match[2]) + 1) % 1440;
        s.time =
          String(Math.floor(value / 60)).padStart(2, "0") +
          ":" +
          String(value % 60).padStart(2, "0");
        if (w.mode !== "explore")
          runQueue(
            w,
            s,
            "time",
            s.time,
            w.nodes
              .filter(
                (n) => n.event === "time" && (!n.target || n.target === s.time),
              )
              .map((n) => n.id),
          );
      }
    }
    if (due && due.due <= s.elapsedMs) {
      s.scheduled.splice(s.scheduled.indexOf(due), 1);
      resumes++;
      runQueue(w, s, "timer", due.nodeId, [due.nodeId], new Set([due.nodeId]));
      if (w.mode !== "explore") {
        runStart(w, s);
        runAuto(w, s);
      }
      continue;
    }
    if (!due && s.elapsedMs < end && !s.scheduled.length) {
      // 没有定时任务：一次性跳到末尾
      s.clockRemainderMs += end - s.elapsedMs;
      s.elapsedMs = end;
      if (s.clockRemainderMs >= 60000) {
        const mins = Math.floor(s.clockRemainderMs / 60000);
        s.clockRemainderMs -= mins * 60000;
        const match = s.time.match(/^(\d{1,2}):(\d{2})$/);
        if (match) {
          const value = (Number(match[1]) * 60 + Number(match[2]) + mins) % 1440;
          s.time =
            String(Math.floor(value / 60)).padStart(2, "0") +
            ":" +
            String(value % 60).padStart(2, "0");
        }
      }
      break;
    }
    if (s.elapsedMs >= end || !due) break;
  }
  return s;
}
export function choose(w: Work, s: Runtime, id: string) {
  const node = w.nodes.find((n) => n.id === id);
  if (!node || !s.choices.some((c) => c.target === id)) return s;
  return dispatch(
    {
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === id ? { ...n, event: "choose", target: id } : n,
      ),
    },
    s,
    "choose",
    id,
  );
}
export function validateGraph(nodes: StoryNode[]) {
  const errors: string[] = [];
  for (const n of nodes) {
    for (const id of n.next)
      if (!nodes.some((x) => x.id === id))
        errors.push(`${n.label} 引用了不存在的节点 ${id}`);
    if (n.next.includes(n.id))
      errors.push(`${n.label} 存在自环（运行时会阻止循环）`);
  }
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    nodes.find((n) => n.id === id)?.next.forEach(visit);
  };
  // 没有 next 的等待型节点（定时、事件触发）由对应的玩家操作/时间推进唤醒，
  // 因此还要把“引用了这些台词的内容”补进可达集合，否则逐句点击型的剧本会被误判。
  nodes
    .filter((n) => n.type === "start" || n.event)
    .forEach((n) => visit(n.id));
  const revealKeys = new Set(
    nodes.flatMap((n) =>
      n.actions
        .filter((a) => a.type === "reveal")
        .map((a) => a.targetId || a.key),
    ),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (reachable.has(n.id)) continue;
      const ready =
        n.event === "time" ||
        n.conditions.some(
          (c) =>
            c.key.startsWith("unlocked:") && revealKeys.has(c.key.slice(9)),
        );
      if (ready) {
        reachable.add(n.id);
        n.next.forEach(visit);
        grew = true;
      }
    }
  }
  nodes
    .filter((n) => n.type !== "comment" && !reachable.has(n.id))
    .forEach((n) => errors.push(`${n.label} 不可达`));
  return errors;
}
export function visible(
  item: { id: string; hidden: boolean; unlock: string },
  s: Runtime,
) {
  return (
    !s.hidden.includes(item.id) &&
    (!item.hidden || s.unlocked.includes(item.id)) &&
    (!item.unlock ||
      testCondition({ key: item.unlock, op: "eq", value: true }, s))
  );
}
