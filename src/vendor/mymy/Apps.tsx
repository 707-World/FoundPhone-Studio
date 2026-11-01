/* React/data adapters for dudwo5/Mymy UI templates: kt/ktn/KHD/bub,
 * igHome/igProfile/igDM/igSheet, xHome. See NOTICE.txt for permission.
 * Author content, DOM globals, timers and media dependencies are excluded. */
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Search,
  Plus,
  Settings,
  Users,
  MessageCircle,
  MoreHorizontal,
  Heart,
  Home,
  Grid,
  Send,
  Bookmark,
  Repeat2,
  BarChart2,
  Share,
  User,
  Bell,
  X,
  Smile,
  Menu,
  Compass,
} from "lucide-react";
import type { SkinProps } from "../../AppSkins";
import { Avatar, Media } from "../../skins/shared";
import { useSkinState } from "../../skinState";
import { clockOf, makeItem, type Item } from "../../schema";
import { testCondition, visible } from "../../engine";
import {
  IG_BUZZ_NAMES,
  IG_COMMENT_MEDIA,
  IG_COMMENT_TEXT,
  IG_NPC_POSTS,
} from "./igFeed";
import "./ui.css";
import "./adapter.css";
function grouped(items: Item[]) {
  return [...new Set(items.map((i) => i.title))].map((title) => ({
    title,
    items: items.filter((i) => i.title === title),
  }));
}
export function messageRun(items: Item[], index: number) {
  const m = items[index],
    previous = items[index - 1],
    next = items[index + 1];
  return {
    first:
      !previous ||
      previous.outgoing !== m.outgoing ||
      previous.sender !== m.sender,
    last: !next || next.outgoing !== m.outgoing || next.sender !== m.sender,
  };
}
const read = (p: SkinProps, i: Item) =>
  p.creator || i.password ? p.onItem(i) : p.onRead(i.id);
/**
 * 这个会话里“已经开始、但还没被玩家点出来”的剧情台词数量。
 * 台词 id 形如 kkt-b2-3 / ig-dm3-7：同一段共用前缀，段内首句由段落变量解锁，
 * 其后每一句都等上一句出现。所以只统计“首句已解锁”的那一组里还没出现的句子，
 * 后面的段落还没开始就不会被算进来。
 */
function pendingLines(
  p: SkinProps,
  inThread: (i: Item) => boolean,
) {
  const all = p.allItems ?? p.items;
  const groups = new Map<string, Item[]>();
  for (const i of all) {
    if (!i.unlock || !inThread(i)) continue;
    const key = i.id.replace(/-\d+$/, "");
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  let n = 0;
  for (const lines of groups.values()) {
    const first = lines[0];
    if (!testCondition({ key: first.unlock, op: "eq", value: true }, p.state))
      continue;
    n += lines.filter((i) => !visible(i, p.state)).length;
  }
  return n;
}
/** 从内容池中随机抽取若干条，保证同一批内不重复 */
function pickSome<T>(pool: T[], count: number): T[] {
  const bag = [...pool];
  const out: T[] = [];
  while (bag.length && out.length < count)
    out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  return out;
}
type Buzz = { id: string; likes: number; comments: string[] };
const IG_RELATIVE = [
  "2小时前",
  "5小时前",
  "昨天",
  "昨天",
  "3小时前",
  "6小时前",
  "4小时前",
];
function Blank() {
  return <p className="mymy-empty">暂无内容</p>;
}
function Back({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="返回" onClick={onClick}>
      <ArrowLeft size={22} />
    </button>
  );
}
export function MymyKakao(p: SkinProps) {
  const [tab, setTab] = useSkinState<string>(p, "mymyTab", "聊天"),
    [sent, setSent] = useSkinState<string[]>(p, "mymyKktSent", []),
    [aliases, setAliases] = useSkinState<string[]>(p, "mymyKktAliases", []),
    [declined, setDeclined] = useSkinState<string[]>(p, "mymyKktDeclined", []),
    [deleted, setDeleted] = useSkinState<string[]>(p, "mymyKktDeleted", []),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [aliasDraft, setAliasDraft] = useState(""),
    [menu, setMenu] = useState(false);
  /** 被强制“关掉”的内容（删不掉的好友、卸不掉的软件）都记在这里 */
  const off = new Set(p.state?.forcedOff ?? []);
  const aliasFor = (t: string) => {
    const row = aliases.find((a) => a.split("\t")[0] === t);
    return row ? row.split("\t").slice(1).join("\t") : "";
  };
  const saveAlias = (t: string, name: string) => {
    const rest = aliases.filter((a) => a.split("\t")[0] !== t);
    setAliases(name.trim() ? [...rest, t + "\t" + name.trim()] : rest);
  };
  const displayName = (t: string) => aliasFor(t) || t;
  /**
   * 删除好友：普通的联系人就真的从列表里消失（记进 ui.deleted，刷新也还在）。
   * 但“他”删不掉 —— 点了只会跳出一句提示，聊天框岿然不动。
   */
  const [deleteNote, setDeleteNote] = useState("");
  /** 剧情接管：输入框封死，玩家只能看着他一直发 */
  const locked = off.has("input:lock") || (p.state?.screenOff ?? false);
  // 有些人删不掉：要么被剧情锁死，要么剧本一开始就标了“甩不掉”
  const undeletable =
    off.has("contact:" + p.thread) ||
    p.state?.variables?.["sticky:" + p.thread] === true;
  const refusedDelete = (t: string) => {
    if (undeletable) {
      setDeleteNote(`${displayName(t)} 无法删除`);
      p.onEvent?.("delete", t);
      return;
    }
    const rest = deleted.filter((x) => x !== t);
    setDeleted([...rest, t]);
    setMenu(false);
    setDeleteNote("");
    p.onThread("");
  };
  // 用“手机当天”补日期，玩家自己发的消息才会排在最下面而不是掉回旧聊天里
  const day = p.state?.date || p.items[0]?.time.slice(0, 10) || "";
  const stamp = (t: string) =>
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t) ? t : (day + " " + t).trim();
  const requests = p.items.filter(
    (i) =>
      i.meta.request === "true" &&
      !declined.includes(i.id) &&
      !off.has("contact:Juyeon"),
  );
  /** 好友申请还没处理完时，Kakao 里看不到 Juyeon 的聊天框 */
  const hiddenThread = new Set(requests.length ? ["Juyeon", "好友申请"] : []);
  const list = grouped(
      p.items.filter(
        (i) =>
          i.meta.request !== "true" &&
          !hiddenThread.has(i.title) &&
          !deleted.includes(i.title) &&
          !off.has("contact:" + i.title),
      ),
    ),
    messages = [
      ...p.items.filter((i) => i.title === p.thread),
      ...sent.flatMap((raw, index) => {
        try {
          const entry: unknown = JSON.parse(raw);
          if (
            !Array.isArray(entry) ||
            entry.length !== 3 ||
            !entry.every((v) => typeof v === "string") ||
            entry[0] !== p.thread
          )
            return [];
          return [
            makeItem({
              id: "local-kkt-" + index,
              title: entry[0],
              body: entry[1],
              time: stamp(entry[2]),
              sender: p.owner || "机主",
              outgoing: true,
              meta: { local: "true" },
            }),
          ];
        } catch {
          return [];
        }
      }),
    ].sort((a, b) => {
      // 一律按时间先后排：一条新的永远在下面。
      // 玩家自己发的话用的是发送那一刻的时间，所以自然落在最后。
      const x = stamp(a.time),
        y = stamp(b.time);
      if (x !== y) return x < y ? -1 : 1;
      return a.meta.local === "true" ? 1 : b.meta.local === "true" ? -1 : 0;
    }),
    /** 当前会话里还没被玩家点出来的剧情台词数量：>0 时输入栏变成“点击继续” */
    pending = pendingLines(p, (i) => i.title === p.thread),
    /** 剧本亮起的“这一段可以开始”的灯：没它玩家就没有可点的入口 */
    entry = p.state?.variables?.["entry:" + p.thread] === true,
    /** 有没有东西可点：有待点台词，或者新的一段正等着被点开 */
    tappable = pending > 0 || entry,
    /** 玩家还没往下翻到头：用来判断“下面有新消息” */
    scroll = useRef<HTMLDivElement>(null),
    [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const node = scroll.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [p.thread, messages.length]);
  return (
    <div className="mymy-ui mymy-kakao" data-mymy="kakao">
      {p.thread ? (
        <>
          <header className="kzth">
            <Back onClick={() => p.onThread("")} />
            <span className="kzname">{displayName(p.thread)}</span>
            <span className="kzpill">
              <button
                aria-label="聊天菜单"
                onClick={() => {
                  if (!menu) setAliasDraft(aliasFor(p.thread));
                  setMenu(!menu);
                }}
              >
                <Menu size={21} />
              </button>
            </span>
          </header>
          <div
            className="msgs kk"
            ref={scroll}
            onScroll={() => {
              const n = scroll.current;
              if (n)
                setAtBottom(n.scrollHeight - n.scrollTop - n.clientHeight < 48);
            }}
          >
            {messages.map((m, i) => {
              const run = messageRun(messages, i);
              const dayLabel = stamp(m.time).slice(0, 10),
                previousDay =
                  i > 0 ? stamp(messages[i - 1].time).slice(0, 10) : "";
              if (m.meta.contact === "true")
                return (
                  <p className="kzsys" key={m.id}>
                    {m.body}
                  </p>
                );
              return (
                <Fragment key={m.id}>
                  {dayLabel !== previousDay && (
                    <p className="kzday">{dayLabel}</p>
                  )}
                  <div
                    className={
                      "kzm " +
                      (m.outgoing ? "kzmy" : "kzot") +
                      (run.first ? " first" : "")
                    }
                  >
                    {!m.outgoing && run.first && (
                      <>
                        <div className="kzmav">
                          <Avatar name={m.sender} src={m.avatar} />
                        </div>
                        <div className="kzmn">{m.sender}</div>
                      </>
                    )}
                    {m.outgoing && run.last && (
                      <span className="kzt">
                        {m.meta.unread || ""}
                        <br />
                        {clockOf(m.time)}
                      </span>
                    )}
                    <button
                      className={
                        "kzbub" +
                        (m.media ? " kzimg" : "") +
                        (m.meta.map === "true" ? " kzmap" : "")
                      }
                      onClick={() => {
                        // 聊天里的地址：点一下直接跳到地图 App
                        if (m.meta.map === "true") {
                          p.onOpenApp?.("maps");
                          return;
                        }
                        if (m.meta.local !== "true") read(p, m);
                      }}
                    >
                      {m.media ? (
                        <Media item={m} zoom />
                      ) : m.meta.map === "true" ? (
                        <span className="kzmap-body">
                          <strong>📍 {m.body}</strong>
                          <small>{m.meta.place}</small>
                          <em>轻触在地图中打开</em>
                        </span>
                      ) : (
                        m.body
                      )}
                    </button>
                    {!m.outgoing && run.last && (
                      <span className="kzt">{clockOf(m.time)}</span>
                    )}
                  </div>
                </Fragment>
              );
            })}
            {!messages.length && <Blank />}
          </div>
          {tappable && (
            <button
              className="mymy-tap"
              aria-label="点击继续剧情"
              onClick={() => p.onEvent?.("tap", p.thread)}
            >
              {atBottom ? "轻触屏幕继续" : "下面有新消息 ↓"}
            </button>
          )}
          <form
            className={"kzinp" + (locked ? " mymy-locked-input" : "")}
            onSubmit={(e) => {
              e.preventDefault();
              // 被接管时：一个字都发不出去
              if (locked) return;
              if (draft.trim()) {
                setSent([
                  ...sent,
                  JSON.stringify([
                    p.thread,
                    draft.trim(),
                    p.virtualTime || "09:41",
                  ]),
                ]);
                setDraft("");
                p.onEvent?.("send", p.thread);
              }
            }}
          >
            <button
              type="button"
              aria-label="添加聊天内容"
              onClick={() => (p.creator ? p.onAdd() : setMenu(!menu))}
            >
              <Plus size={21} />
            </button>
            <input
              aria-label="KKT消息"
              placeholder={
                locked ? "…" : tappable ? "点击输入栏继续剧情" : "输入消息"
              }
              value={pending || locked ? "" : draft}
              maxLength={2000}
              readOnly={pending > 0 || locked}
              onFocus={() => {
                if (tappable) p.onEvent?.("tap", p.thread);
              }}
              onClick={() => {
                if (tappable) p.onEvent?.("tap", p.thread);
              }}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Smile size={22} />
            <button
              className={draft.trim() ? "go" : ""}
              aria-label="发送KKT消息"
              disabled={!draft.trim() || pending > 0 || locked}
            >
              ↑
            </button>
          </form>
          {menu && (
            <div className="mymy-local-menu">
              <strong>{displayName(p.thread)}</strong>
              <p>
                群成员：{[...new Set(messages.map((m) => m.sender))].join("、")}
              </p>
              <label className="mymy-alias">
                备注名
                <input
                  aria-label="修改备注"
                  value={aliasDraft}
                  maxLength={30}
                  placeholder={p.thread}
                  onChange={(e) => setAliasDraft(e.target.value)}
                />
              </label>
              <button
                aria-label="保存备注"
                onClick={() => saveAlias(p.thread, aliasDraft)}
              >
                保存备注
              </button>
              {/* 所有联系人都能点，但有些人（有些东西）删不掉 */}
              <button
                className="mymy-delete"
                aria-label="删除该好友"
                onClick={() => refusedDelete(p.thread)}
              >
                删除该好友
              </button>
              {deleteNote && (
                <p className="mymy-delete-note" role="status">
                  {deleteNote}
                </p>
              )}
              <button onClick={() => setMenu(false)}>完成</button>
            </div>
          )}
        </>
      ) : (
        <div className="kzkk">
          <div className="kzhd">
            <header className="kzkh">
              <b className="kzti">
                {tab === "好友" ? p.owner || "好友" : "聊天"}
              </b>
              <span className="kzic">
                <button
                  aria-label="搜索聊天"
                  onClick={() => setQuery(query ? "" : " ")}
                >
                  <Search size={21} />
                </button>
                {p.creator && (
                  <button aria-label="新增内容" onClick={p.onAdd}>
                    <Plus />
                  </button>
                )}
                <button aria-label="KKT设置" onClick={() => setMenu(!menu)}>
                  <Settings size={21} />
                </button>
              </span>
            </header>
            <div className="kzkc2">
              {["好友", "聊天"].map((t) => (
                <button
                  key={t}
                  className={
                    "kzkpl " +
                    (t === tab || (t === "为你推荐" && tab === "推荐")
                      ? "on"
                      : "")
                  }
                  onClick={() => setTab(t)}
                >
                  {t}
                  {t === "好友" && requests.length > 0 && (
                    <i className="mymy-dot" aria-label="有新的好友申请" />
                  )}
                </button>
              ))}
            </div>
            {query !== "" && (
              <input
                className="mymy-search"
                aria-label="搜索KKT"
                value={query.trimStart()}
                onChange={(e) => setQuery(e.target.value || " ")}
                placeholder="搜索"
              />
            )}
          </div>
          <div className="kzkb">
            <div className="kzksec">
              {tab === "好友" ? "好友" : "全部聊天"} {list.length}
            </div>
            {requests.length > 0 && (
              <div className="kzksec mymy-req-head">
                好友申请 {requests.length}
              </div>
            )}
            {requests.map((r) => (
              <div className="kzkr kzkreq" key={r.id}>
                <Avatar name={r.sender} src={r.avatar} />
                <span className="kzkn">
                  <b>{displayName(r.sender)}</b>
                  <small>{r.body || "申请添加你为好友"}</small>
                </span>
                <span className="mymy-req-act">
                  <button
                    aria-label={"接受" + r.sender + "的好友申请"}
                    onClick={() => p.onEvent?.("accept", r.sender)}
                  >
                    接受
                  </button>
                  <button
                    aria-label={"拒绝" + r.sender + "的好友申请"}
                    onClick={() => setDeclined([...declined, r.id])}
                  >
                    拒绝
                  </button>
                </span>
              </div>
            ))}
            {list
              .filter((g) => g.title.includes(query.trim()))
              .map((g) => {
                const last = g.items.at(-1)!;
                return (
                  <button
                    className="kzkr kzkcr"
                    key={g.title}
                    onClick={() => p.onThread(g.title)}
                  >
                    <Avatar name={last.sender || g.title} src={last.avatar} />
                    <span className="kzkn">
                      <b>{displayName(g.title)}</b>
                      <small>{tab === "好友" ? last.sender : last.body}</small>
                    </span>
                    <span className="kzkmt">
                      {clockOf(last.time)}
                      {last.meta.unread && (
                        <i className="kzkbd">{last.meta.unread}</i>
                      )}
                    </span>
                  </button>
                );
              })}
            {!list.length && <Blank />}
          </div>
          <nav className="kzknv">
            {[Users, MessageCircle, Compass, Grid, MoreHorizontal].map(
              (Icon, i) => (
                <button
                  key={i}
                  aria-label={["好友", "聊天", "发现", "更多功能", "设置"][i]}
                  className={(tab === "好友" ? 0 : 1) === i ? "on" : ""}
                  onClick={() =>
                    i < 2 ? setTab(["好友", "聊天"][i]) : setMenu(true)
                  }
                >
                  <Icon />
                </button>
              ),
            )}
          </nav>
          {menu && (
            <div className="mymy-local-menu">
              <strong>KakaoTalk</strong>
              <p>作品内聊天</p>
              <button onClick={() => setMenu(false)}>完成</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export function MymyInstagram(p: SkinProps) {
  const [tab, setTab] = useSkinState<string>(p, "mymyTab", "主页"),
    [liked, setLiked] = useSkinState<string[]>(p, "mymyLiked", []),
    [saved, setSaved] = useSkinState<string[]>(p, "mymySaved", []),
    [replies, setReplies] = useSkinState<string[]>(p, "mymyReplies", []),
    [myPosts, setMyPosts] = useSkinState<string[]>(p, "mymyIgPosts", []),
    [buzz, setBuzz] = useSkinState<string[]>(p, "mymyIgBuzz", []),
    [feed, setFeed] = useSkinState<string[]>(p, "mymyIgFeed", []),
    [feedAt, setFeedAt] = useSkinState<number>(p, "mymyIgFeedAt", 0),
    [dmSent, setDmSent] = useSkinState<string[]>(p, "mymyIgDmSent", []),
    [profile, setProfile] = useSkinState<string[]>(p, "mymyIgProfile", []),
    [seen, setSeen] = useSkinState<string[]>(p, "mymySeen", []);
  const [sheet, setSheet] = useState<Item | null>(null),
    [selected, setSelected] = useState<Item | null>(null),
    [story, setStory] = useState(0),
    [draft, setDraft] = useState(""),
    [pop, setPop] = useState(""),
    [compose, setCompose] = useState(false),
    [photo, setPhoto] = useState(""),
    [editing, setEditing] = useState(false),
    [dm, setDm] = useState(""),
    [nameDraft, setNameDraft] = useState(""),
    [bioDraft, setBioDraft] = useState(""),
    [avatarDraft, setAvatarDraft] = useState("");
  /** 被强制“关掉”的内容（卸不掉的软件）都记在这里 */
  const off = new Set(p.state?.forcedOff ?? []);
  /** 剧情接管：输入框封死 */
  const locked = off.has("input:lock") || (p.state?.screenOff ?? false);
  /** IG 私信的事件名要跟 Kakao 区分开，否则两条线会互相抢点击 */
  const dmKey = "ig:" + dm;
  const my = (() => {
    try {
      const raw: unknown = profile.length ? JSON.parse(profile[0]) : {};
      return raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    } catch {
      return {} as Record<string, unknown>;
    }
  })();
  const profileName = typeof my.name === "string" ? my.name : "",
    profileBio = typeof my.bio === "string" ? my.bio : "",
    profileAvatar = typeof my.avatar === "string" ? my.avatar : "";
  const buzzList: Buzz[] = buzz.flatMap((raw) => {
    try {
      const v: unknown = JSON.parse(raw);
      if (!v || typeof v !== "object") return [];
      const o = v as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.likes !== "number") return [];
      return [
        {
          id: o.id,
          likes: o.likes,
          comments: Array.isArray(o.comments)
            ? o.comments.filter((c): c is string => typeof c === "string")
            : [],
        },
      ];
    } catch {
      return [];
    }
  });
  const buzzFor = (id: string) => buzzList.find((b) => b.id === id);
  const npcPosts = feed
    .flatMap((raw, index) => {
      try {
        const v: unknown = JSON.parse(raw);
        if (!v || typeof v !== "object") return [];
        const o = v as Record<string, unknown>;
        if (typeof o.author !== "string" || typeof o.body !== "string")
          return [];
        return [
          makeItem({
            id: "npc-ig-" + index,
            title: typeof o.author === "string" ? o.author : "",
            body: o.body,
            media: typeof o.media === "string" ? o.media : "",
            time: "",
            sender: o.author,
            likes: typeof o.likes === "number" ? o.likes : 0,
            comments: Array.isArray(o.comments)
              ? o.comments.filter((c): c is string => typeof c === "string")
              : [],
            meta: {
              local: "true",
              location: typeof o.ago === "string" ? o.ago : "",
            },
          }),
        ];
      } catch {
        return [];
      }
    })
    .reverse();
  useEffect(() => {
    if (p.creator) return;
    const now = Date.now();
    if (feed.length && now - feedAt < 40000) return;
    const first = !feed.length;
    const count = first ? 3 : 1 + Math.round(Math.random());
    const fresh = Array.from({ length: count }, (_, k) => {
      const src = IG_NPC_POSTS[(feed.length + k) % IG_NPC_POSTS.length];
      return JSON.stringify({ ...src, ago: first ? IG_RELATIVE[k] : "刚刚" });
    });
    setFeed([...feed, ...fresh]);
    setFeedAt(now);
    // 每次打开 App（挂载）时补充一批，模拟“每天都有新动态”
  }, []);
  const pick = (
    e: React.ChangeEvent<HTMLInputElement>,
    done: (url: string) => void,
  ) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || f.size > 2 * 1024 * 1024) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) return;
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") done(r.result);
    };
    r.readAsDataURL(f);
  };
  const mine = myPosts.flatMap((raw, index) => {
    try {
      const e: unknown = JSON.parse(raw);
      if (!e || typeof e !== "object") return [];
      const body = (e as Record<string, unknown>).body,
        media = (e as Record<string, unknown>).media,
        time = (e as Record<string, unknown>).time;
      if (typeof body !== "string") return [];
      if (typeof media === "string" && media && !media.startsWith("data:"))
        return [];
      return [
        makeItem({
          id: "local-ig-" + index,
          title: "我的帖子",
          body,
          media: typeof media === "string" ? media : "",
          time: typeof time === "string" && time ? time : p.virtualTime || "",
          sender: profileName || p.owner || "机主",
          avatar: profileAvatar,
          meta: { local: "true" },
        }),
      ];
    } catch {
      return [];
    }
  });
  /**
   * 第七段：玩家只要发一条帖子，他就会立刻来评论。
   * 剧本用 flag 通知皮肤，皮肤记住是哪一条帖子被评论过（只评论一次）。
   */
  const [juyeonCmt, setJuyeonCmt] = useSkinState<string[]>(
    p,
    "mymyIgJuyeonCmt",
    [],
  );
  const juyeonCommented = p.state?.variables?.["flag:igJuyeonComment"] === true;
  const lastMine = mine.length ? mine[mine.length - 1].id : "";
  useEffect(() => {
    if (juyeonCommented && !juyeonCmt.length && lastMine)
      setJuyeonCmt([lastMine]);
  }, [juyeonCommented, juyeonCmt.length, lastMine]);
  const extraComments = (i: Item) =>
    juyeonCmt.includes(i.id) ? ["Juyeon: 我刚还在想你😺"] : [];
  /**
   * 主页时间线：玩家刚发的帖子永远排在最上面（最新发的那条第一），
   * 往下是“刚刚 / 几分钟前”的日常动态，最后才是按时间倒序排的旧帖子。
   */
  const posts = [
      ...mine.slice().reverse(),
      ...npcPosts,
      ...p.items
        .filter((i) => i.folder !== "私信" && i.meta.story !== "true")
        .slice()
        .sort(
          (a, b) =>
            Date.parse(b.time.replace(" ", "T")) -
            Date.parse(a.time.replace(" ", "T")),
        ),
    ],
    stories = p.items.filter((i) => i.meta.story === "true"),
    dms = p.items.filter((i) => i.folder === "私信"),
    dmThreads = [...new Set(dms.map((i) => i.title))],
    active = stories[story - 1];
  /**
   * 私信里对方主动发来的话：一句一句往前走。
   * 台词早就按时间排好了，但要让它们真的“一条接一条地来”，
   * 得有人在屏幕上推一把 —— 私信页开着就自动走，关着就等下次进来再接着走。
   * （靠定时器推进的话，没打开私信时段落就卡住了，玩家一进来那句就凭空出现。）
   */
  useEffect(() => {
    if (p.creator || tab !== "私信") return;
    const due = dms.find(
      (i) =>
        !visible(i, p.state) &&
        testCondition({ key: i.unlock, op: "eq", value: true }, p.state) &&
        !i.outgoing &&
        i.sender !== "我" &&
        i.meta.local !== "true",
    );
    if (!due) return;
    const timer = setTimeout(() => p.onEvent?.("tap", "ig:" + due.title), 900);
    return () => clearTimeout(timer);
  }, [tab, p.state, dms, p.creator]);
  /** 私信排序用的时间键：只写了时刻的补上手机当天，排序才不会乱 */
  const dmDay = p.state?.date || p.items[0]?.time.slice(0, 10) || "";
  const dmStamp = (t: string) =>
    /^\d{4}-\d{2}-\d{2}/.test(t) ? t : (dmDay + " " + t).trim();
  /** 私信内容区：进会话就自动翻到最新一条，不用玩家自己往下拖 */
  const dmScroll = useRef<HTMLDivElement>(null);
  const dmMessages = dm
    ? [
        ...dms.filter((i) => i.title === dm),
        ...dmSent.flatMap((raw, index) => {
          try {
            const v: unknown = JSON.parse(raw);
            if (!Array.isArray(v) || v.length !== 3 || v[0] !== dm) return [];
            return [
              makeItem({
                id: "local-igdm-" + index,
                title: String(v[0]),
                body: String(v[1]),
                time: String(v[2]),
                sender: profileName || p.owner || "机主",
                outgoing: true,
                avatar: profileAvatar,
                meta: { local: "true" },
              }),
            ];
          } catch {
            return [];
          }
        }),
      ].sort((a, b) => {
        // 一律按时间先后排：新消息永远在下面，滚动条也才钓得住底
        const x = dmStamp(a.time),
          y = dmStamp(b.time);
        if (x !== y) return x < y ? -1 : 1;
        return a.meta.local === "true" ? 1 : b.meta.local === "true" ? -1 : 0;
      })
    : [];
  useEffect(() => {
    const node = dmScroll.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [dm, dmMessages.length]);
  /** 这条私信会话里还没被玩家点出来的剧情台词数量 */
  const dmPending = dm
    ? pendingLines(p, (i) => i.folder === "私信" && i.title === dm)
    : 0;
  /** 剧本亮起的“这一段可以开始”的灯（IG 私信用自己的键，免得跟 Kakao 抢） */
  const dmEntry = dm
    ? p.state?.variables?.["entry:ig:" + dm] === true
    : false;
  const dmTappable = dmPending > 0 || dmEntry;
  const toggle = (id: string, values: string[], set: (v: string[]) => void) =>
    set(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  const like = (i: Item, on: boolean) => {
    toggle(i.id, liked, setLiked);
    if (on) p.onEvent?.("like", i.id);
  };
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(
      () => setStory((n) => (n < stories.length ? n + 1 : 0)),
      5000,
    );
    return () => clearTimeout(t);
  }, [active, stories.length]);
  const openStory = (i: number) => {
    const m = stories[i];
    setSeen([...new Set([...seen, m.id])]);
    read(p, m);
    setStory(i + 1);
  };
  const openPost = (i: Item) => {
    if (p.creator || i.password) p.onItem(i);
    else {
      read(p, i);
      setSelected(i);
    }
  };
  const post = (i: Item) => (
    <article className="igp" key={i.id}>
      <header className="igph">
        <Avatar name={i.sender} src={i.avatar} />
        <div className="igpn">
          <button onClick={() => setTab("个人主页")}>
            <b>{i.sender}</b>
          </button>
          <small>{i.meta.location || i.time}</small>
        </div>
        <button aria-label="帖子详情" onClick={() => openPost(i)}>
          <MoreHorizontal />
        </button>
      </header>
      {i.media ? (
        <div
          className="carw"
          onDoubleClick={() => {
            if (!liked.includes(i.id)) like(i, true);
            setPop(i.id);
          }}
        >
          <Media item={i} />
          {pop === i.id && (
            <Heart
              className="mymy-heart-pop"
              fill="white"
              onAnimationEnd={() => setPop("")}
            />
          )}
        </div>
      ) : (
        <p className="igpt">{i.body}</p>
      )}
      <div className="iga">
        <button
          aria-label={"点赞" + i.title}
          aria-pressed={liked.includes(i.id)}
          onClick={() => like(i, !liked.includes(i.id))}
        >
          <Heart
            fill={liked.includes(i.id) ? "#ff3040" : "none"}
            color={liked.includes(i.id) ? "#ff3040" : "currentColor"}
          />
        </button>
        <button
          aria-label={"评论" + i.title}
          onClick={() => {
            read(p, i);
            setSheet(i);
          }}
        >
          <MessageCircle />
        </button>
        <button aria-label="分享帖子" onClick={() => setTab("私信")}>
          <Send />
        </button>
        <button
          className="mymy-save"
          aria-label={"收藏" + i.title}
          aria-pressed={saved.includes(i.id)}
          onClick={() => toggle(i.id, saved, setSaved)}
        >
          <Bookmark fill={saved.includes(i.id) ? "currentColor" : "none"} />
        </button>
      </div>
      <p className="lk2">
        {i.likes +
          (liked.includes(i.id) ? 1 : 0) +
          (buzzFor(i.id)?.likes ?? 0)}{" "}
        次赞
      </p>
      {i.media && (
        <button
          className="igc"
          onClick={() => {
            openPost(i);
          }}
        >
          <b>{i.sender}</b> {i.body}
        </button>
      )}
      <button className="cmall" onClick={() => setSheet(i)}>
        查看评论{" "}
        {i.comments.length +
          (buzzFor(i.id)?.comments.length ?? 0) +
          extraComments(i).length +
          replies.filter((r) => r.startsWith(i.id + "\t")).length}
      </button>
      <p className="igt">{i.time}</p>
    </article>
  );
  return (
    <div className="mymy-ui mymy-instagram" data-mymy="instagram">
      <div className="ig">
        <header className="igh">
          <button
            aria-label={selected ? "返回Instagram动态" : "关闭当前App"}
            onClick={() => (selected ? setSelected(null) : p.onBack())}
          >
            <ArrowLeft />
          </button>
          <span className="igl2">
            {selected ? "帖子" : tab === "主页" ? "Instagram" : tab}
          </span>
          <button aria-label="打开私信" onClick={() => setTab("私信")}>
            <Send />
          </button>
        </header>
        <div className="igb">
          {selected && post(selected)}
          {!selected && tab === "主页" && (
            <>
              <div className="sts">
                {stories.map((s, n) => (
                  <button
                    className="st"
                    key={s.id}
                    onClick={() => openStory(n)}
                  >
                    <span
                      className={"sr on " + (seen.includes(s.id) ? "seen" : "")}
                    >
                      <Avatar name={s.sender} src={s.avatar} />
                    </span>
                    <small>{s.sender}</small>
                  </button>
                ))}
              </div>
              {posts.map(post)}
              {!posts.length && <Blank />}
            </>
          )}
          {!selected && tab === "个人主页" && (
            <>
              <div className="pf">
                <Avatar
                  name={profileName || p.owner || "机主"}
                  src={profileAvatar}
                />
                <div className="ps">
                  <div>
                    <b>{posts.length}</b>
                    <small>帖子</small>
                  </div>
                  <div>
                    <b>—</b>
                    <small>粉丝</small>
                  </div>
                  <div>
                    <b>—</b>
                    <small>关注</small>
                  </div>
                </div>
              </div>
              <p className="pn">{profileName || p.owner}</p>
              {profileBio && <p className="pb">{profileBio}</p>}
              <button
                className="mymy-edit-profile"
                aria-label="编辑个人资料"
                onClick={() => {
                  setNameDraft(profileName);
                  setBioDraft(profileBio);
                  setAvatarDraft(profileAvatar);
                  setEditing(true);
                }}
              >
                编辑资料
              </button>
              <div className="ptab">
                <div className="on">
                  <Grid />
                </div>
              </div>
              <div className="pg2">
                {posts.map((i) => (
                  <button key={i.id} onClick={() => openPost(i)}>
                    <Media item={i} />
                  </button>
                ))}
              </div>
            </>
          )}
          {!selected && tab === "私信" && (
            <>
              {dm ? (
                <div className="igdm">
                  <header className="igdmh">
                    <button
                      aria-label="返回私信列表"
                      onClick={() => setDm("")}
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <Avatar name={dm} src={dms.find((i) => i.title === dm)?.avatar} />
                    <b>{dm}</b>
                  </header>
                  <div className="igdmb" ref={dmScroll}>
                    {dmMessages.map((m) => (
                      <div
                        key={m.id}
                        className={"igdmm " + (m.outgoing ? "me" : "you")}
                      >
                        {!m.outgoing && (
                          <Avatar name={m.sender} src={m.avatar} />
                        )}
                        <span className="igdmbub">
                          {m.media ? (
                            <button
                              className="igdmpic"
                              aria-label={"查看图片" + m.title}
                              onClick={() => setSelected(m)}
                            >
                              <Media item={m} zoom />
                            </button>
                          ) : (
                            m.body
                          )}
                          <small>{clockOf(m.time)}</small>
                        </span>
                      </div>
                    ))}
                    {!dmMessages.length && <Blank />}
                  </div>
                  {dmTappable && (
                    <button
                      className="mymy-tap"
                      aria-label="点击继续私信剧情"
                      onClick={() => p.onEvent?.("tap", dmKey)}
                    >
                      轻触屏幕继续
                    </button>
                  )}
                  <form
                    className={"igdmi" + (locked ? " mymy-locked-input" : "")}
                    onSubmit={(e) => {
                      e.preventDefault();
                      // 被接管时：一个字都发不出去
                      if (locked) return;
                      if (draft.trim()) {
                        setDmSent([
                          ...dmSent,
                          JSON.stringify([
                            dm,
                            draft.trim(),
                            p.virtualTime || "",
                          ]),
                        ]);
                        setDraft("");
                        p.onEvent?.("send", dmKey);
                      }
                    }}
                  >
                    <input
                      aria-label="私信内容"
                      value={dmPending || locked ? "" : draft}
                      onClick={() => {
                        if (dmTappable) p.onEvent?.("tap", dmKey);
                      }}
                      maxLength={2000}
                      readOnly={dmPending > 0 || locked}
                      placeholder={
                        locked
                          ? "…"
                          : dmTappable
                            ? "点击输入栏继续剧情"
                            : "发消息…"
                      }
                      onFocus={() => {
                        if (dmTappable) p.onEvent?.("tap", dmKey);
                      }}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                      aria-label="发送私信"
                      disabled={!draft.trim() || dmPending > 0 || locked}
                    >
                      发送
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  {dmThreads.map((t) => {
                    const rows = dms.filter((i) => i.title === t),
                      last = rows.at(-1)!;
                    return (
                      <button
                        className="kzkr"
                        key={t}
                        onClick={() => {
                          setDraft("");
                          setDm(t);
                          read(p, last);
                        }}
                      >
                        <Avatar name={last.sender} src={last.avatar} />
                        <span className="kzkn">
                          <b>{t}</b>
                          <small>{last.body}</small>
                        </span>
                      </button>
                    );
                  })}
                  {!dmThreads.length && <Blank />}
                </>
              )}
            </>
          )}
          {!selected && tab === "搜索" && (
            <>
              <input
                className="mymy-search"
                aria-label="搜索Instagram"
                placeholder="搜索"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {posts
                .filter((i) => (i.title + i.body + i.sender).includes(draft))
                .map(post)}
            </>
          )}
        </div>
        <nav className="mymy-ig-nav">
          {[Home, Search, Plus, Send, User].map((Icon, n) => (
            <button
              key={n}
              aria-label={["主页", "搜索", "发帖", "私信", "个人主页"][n]}
              aria-pressed={
                !selected &&
                n !== 2 &&
                tab === ["主页", "搜索", "", "私信", "个人主页"][n]
              }
              onClick={() => {
                setSelected(null);
                setDm("");
                if (n === 2) {
                  setDraft("");
                  setPhoto("");
                  setCompose(true);
                  return;
                }
                setTab(["主页", "搜索", "", "私信", "个人主页"][n]);
              }}
            >
              <Icon />
            </button>
          ))}
        </nav>
      </div>
      {compose && (
        <div className="kzcs">
          <button
            className="kzbk"
            aria-label="关闭发帖"
            onClick={() => setCompose(false)}
          />
          <section className="kzsh" role="dialog" aria-label="新帖子面板">
            <div className="mymy-sheet-handle" />
            <header>
              <b>新帖子</b>
              <button aria-label="关闭发帖面板" onClick={() => setCompose(false)}>
                <X />
              </button>
            </header>
            <form
              className="mymy-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim() || photo) {
                  const id = "local-ig-" + myPosts.length;
                  const pool = photo ? IG_COMMENT_MEDIA : IG_COMMENT_TEXT;
                  const who = pickSome(
                    IG_BUZZ_NAMES,
                    1 + Math.floor(Math.random() * 3),
                  );
                  const texts = pickSome(pool, who.length);
                  setMyPosts([
                    ...myPosts,
                    JSON.stringify({
                      body: draft.trim(),
                      media: photo,
                      time: p.virtualTime || "",
                    }),
                  ]);
                  setBuzz([
                    ...buzz,
                    JSON.stringify({
                      id,
                      likes: 8 + Math.floor(Math.random() * 53),
                      comments: who.map((name, n) => name + ": " + texts[n]),
                    }),
                  ]);
                  setDraft("");
                  setPhoto("");
                  setCompose(false);
                  setTab("主页");
                  // 玩家发了帖：剧情可以据此醒来（比如“他立刻评论了你”）
                  p.onEvent?.("post", "instagram");
                }
              }}
            >
              {photo && <img className="mymy-compose-photo" src={photo} alt="待发布图片" />}
              <textarea
                aria-label="帖子正文"
                value={draft}
                maxLength={2000}
                placeholder="分享此刻…"
                onChange={(e) => setDraft(e.target.value)}
              />
              <label className="mymy-compose-pick">
                添加图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="选择帖子图片"
                  onChange={(e) => pick(e, setPhoto)}
                />
              </label>
              <button aria-label="发布帖子" disabled={!draft.trim() && !photo}>
                发布
              </button>
            </form>
          </section>
        </div>
      )}
      {editing && (
        <div className="kzcs">
          <button
            className="kzbk"
            aria-label="关闭资料编辑"
            onClick={() => setEditing(false)}
          />
          <section className="kzsh" role="dialog" aria-label="编辑个人资料">
            <div className="mymy-sheet-handle" />
            <header>
              <b>编辑资料</b>
              <button aria-label="关闭资料面板" onClick={() => setEditing(false)}>
                <X />
              </button>
            </header>
            <form
              className="mymy-compose"
              onSubmit={(e) => {
                e.preventDefault();
                setProfile([
                  JSON.stringify({
                    name: nameDraft.trim(),
                    bio: bioDraft.trim(),
                    avatar: avatarDraft,
                  }),
                ]);
                setEditing(false);
              }}
            >
              <Avatar name={nameDraft || p.owner || "机主"} src={avatarDraft} />
              <label className="mymy-alias">
                名字
                <input
                  aria-label="编辑主页名字"
                  value={nameDraft}
                  maxLength={30}
                  placeholder={p.owner || "机主"}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
              <label className="mymy-alias">
                简介
                <input
                  aria-label="编辑主页简介"
                  value={bioDraft}
                  maxLength={150}
                  placeholder="介绍一下自己"
                  onChange={(e) => setBioDraft(e.target.value)}
                />
              </label>
              <label className="mymy-compose-pick">
                更换头像
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="选择头像图片"
                  onChange={(e) => pick(e, setAvatarDraft)}
                />
              </label>
              <button aria-label="保存个人资料">保存</button>
            </form>
          </section>
        </div>
      )}
      {sheet && (
        <div className="kzcs">
          <button
            className="kzbk"
            aria-label="关闭评论"
            onClick={() => setSheet(null)}
          />
          <section className="kzsh" role="dialog" aria-label="Instagram评论">
            <div className="mymy-sheet-handle" />
            <header>
              <b>评论</b>
              <button aria-label="关闭评论面板" onClick={() => setSheet(null)}>
                <X />
              </button>
            </header>
            <div className="mymy-comments">
              {[
                ...extraComments(sheet),
                ...(buzzFor(sheet.id)?.comments ?? []),
                ...sheet.comments,
                ...replies
                  .filter((r) => r.startsWith(sheet.id + "\t"))
                  .map((r) => r.split("\t").slice(1).join("\t")),
              ].map((c, n) => (
                <p key={n}>
                  <Avatar name={c.split(":")[0]} />
                  {c}
                </p>
              ))}
            </div>
            <form
              className="cmb2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) {
                  setReplies([...replies, sheet.id + "\t" + draft.trim()]);
                  setDraft("");
                }
              }}
            >
              <input
                aria-label="添加评论"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="添加评论"
                maxLength={500}
              />
              <button>发布</button>
            </form>
          </section>
        </div>
      )}
      {active && (
        <div
          className="mymy-story"
          onPointerDown={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const next =
              e.clientX - box.left < box.width * 0.3 ? story - 1 : story + 1;
            setStory(next > stories.length ? 0 : Math.max(0, next));
          }}
        >
          <div className="mymy-story-bars">
            {stories.map((s, n) => (
              <i key={s.id} className={n < story ? "seen" : ""} />
            ))}
          </div>
          <header>
            <Avatar name={active.sender} src={active.avatar} />
            <b>{active.sender}</b>
            <button
              aria-label="关闭快拍"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setStory(0)}
            >
              <X />
            </button>
          </header>
          <Media item={active} />
          <p>{active.body}</p>
        </div>
      )}
    </div>
  );
}
export function MymyX(p: SkinProps) {
  const [dark, setDark] = useSkinState<boolean>(p, "x-dark", true);
  const [tab, setTab] = useSkinState<string>(p, "mymyTab", "推荐"),
    [likes, setLikes] = useSkinState<string[]>(p, "mymyXLikes", []),
    [reposts, setReposts] = useSkinState<string[]>(p, "mymyXReposts", []),
    [marks, setMarks] = useSkinState<string[]>(p, "mymyXMarks", []),
    [query, setQuery] = useState("");
  const isLiked = (id: string) =>
    typeof p.ui?.["liked-" + id] === "boolean"
      ? Boolean(p.ui["liked-" + id])
      : likes.includes(id);
  const isSaved = (id: string) =>
    typeof p.ui?.["saved-" + id] === "boolean"
      ? Boolean(p.ui["saved-" + id])
      : marks.includes(id);
  const toggle = (id: string, v: string[], set: (x: string[]) => void) =>
    set(v.includes(id) ? v.filter((x) => x !== id) : [...v, id]);
  return (
    <div
      className={"mymy-ui mymy-x " + (dark ? "x-reference-dark" : "")}
      data-mymy="twitter"
    >
      <div className="kzxw">
        <header className="kzxh">
          <button aria-label="关闭当前App" onClick={p.onBack}>
            <ArrowLeft />
          </button>
          <div className="kzxlg">𝕏</div>
          <button aria-label="切换X外观" onClick={() => setDark(!dark)}>
            <User />
          </button>
        </header>
        <div className="kzxtb">
          {["为你推荐", "正在关注", "添加 +", "时间"].map((t) => (
            <button
              className={t === tab ? "on" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "搜索" && (
          <input
            className="mymy-search"
            aria-label="搜索X"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索"
          />
        )}
        <div className="kzxfd">
          {p.items
            .filter((i) => (i.title + i.body).includes(query))
            .map((i) => (
              <article className="kzxt" key={i.id}>
                <Avatar name={i.sender} src={i.avatar} />
                <div className="kzxb">
                  <div className="kzxn">
                    <b>{i.sender}</b>
                    <small>
                      @{i.meta.handle || "user"} · {clockOf(i.time)}
                    </small>
                    <em>
                      <MoreHorizontal size={18} />
                    </em>
                  </div>
                  <button
                    className="kzxx"
                    onClick={() => {
                      read(p, i);
                      p.onItem(i);
                    }}
                  >
                    {i.body}
                  </button>
                  {i.media && (
                    <button
                      className="kzxv"
                      aria-label="打开媒体"
                      onClick={() => p.onItem(i)}
                    >
                      <Media item={i} />
                    </button>
                  )}
                  <div className="kzxac">
                    <button
                      aria-label={"评论" + i.title}
                      onClick={() => p.onItem(i)}
                    >
                      <MessageCircle />
                      {i.comments.length}
                    </button>
                    <button
                      aria-label={"转发" + i.title}
                      aria-pressed={reposts.includes(i.id)}
                      onClick={() => toggle(i.id, reposts, setReposts)}
                    >
                      <Repeat2 />
                      {reposts.includes(i.id) ? 1 : 0}
                    </button>
                    <button
                      aria-label={"点赞" + i.title}
                      aria-pressed={isLiked(i.id)}
                      onClick={() => {
                        toggle(i.id, likes, setLikes);
                        p.onUi?.("liked-" + i.id, !isLiked(i.id));
                      }}
                    >
                      <Heart fill={isLiked(i.id) ? "#f91880" : "none"} />
                      {i.likes + (isLiked(i.id) ? 1 : 0)}
                    </button>
                    <span>
                      <BarChart2 />
                      {i.meta.views || "—"}
                    </span>
                    <button
                      aria-label={"收藏" + i.title}
                      aria-pressed={isSaved(i.id)}
                      onClick={() => {
                        toggle(i.id, marks, setMarks);
                        p.onUi?.("saved-" + i.id, !isSaved(i.id));
                      }}
                    >
                      <Bookmark />
                    </button>
                    <button aria-label="分享" onClick={() => p.onItem(i)}>
                      <Share />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          {!p.items.length && <Blank />}
        </div>
        <nav className="kzxnav">
          {[Home, Search, Bell, MessageCircle].map((Icon, n) => (
            <button
              key={n}
              aria-label={["时间线", "搜索", "通知", "私信"][n]}
              onClick={() => n < 2 && setTab(n ? "搜索" : "推荐")}
              disabled={n > 1}
            >
              <Icon />
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
