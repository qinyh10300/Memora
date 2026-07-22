export type MemberReference = {
  id: string;
  display_name: string;
};

export type TimeRange = {
  createdFrom: string;
  createdTo: string;
};

export type QuestionRoute = {
  kind: "QUESTION";
  question: string;
  topic: string | null;
  scope: "PERSONAL" | "COLLEAGUE" | "WORKSPACE";
  authorId: string | null;
  timeRange: TimeRange | null;
};

export type ReportRoute = Omit<QuestionRoute, "kind"> & { kind: "REPORT" };
export type QueryRoute = QuestionRoute | ReportRoute;

export type MessageRoute =
  | { kind: "CAPTURE"; body: string }
  | { kind: "SHARE_LATEST" }
  | { kind: "UNSHARE_LATEST" }
  | { kind: "DELETE_LATEST" }
  | { kind: "SUPPLEMENT_LATEST"; body: string }
  | QueryRoute
  | {
      kind: "NEEDS_COLLEAGUE";
      queryKind: QueryRoute["kind"];
      question: string;
      topic: string | null;
      timeRange: TimeRange | null;
    };

const CAPTURE_PREFIX =
  /^(?:请)?(?:帮我)?(?:记住|记下|记(?:一下)?|记录(?:一下)?|存(?:一下)?|保存(?:一下)?)(?:这个)?(?:想法|内容)?[：:，,\s]*/;
const QUESTION_CUE =
  /(?:[?？]\s*$|^(?:请|能不能|可以)?\s*(?:帮我)?\s*(?:查|找|总结|回顾|生成|告诉|列出|看看)|我想知道|有没有|是否|什么时候|何时|记了什么|记过什么|有哪些|怎么想|怎么看|如何变化|有什么想法|有什么进展)/;
const TEAM_CUE = /(?:团队|大家|工作区|我们几个人|所有成员|所有人|几个人)/;
const COLLEAGUE_CUE = /(?:这个同事|某个同事|同事这段时间|同事最近)/;
const REPORT_CUE = /(?:报告|总结.*(?:变化|这段时间|最近|想法)|(?:想法|观点).*变化)/;
const LATEST_MEMORY = "(?:上一条|最近一条|刚才那条|刚刚那条)";

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function localDate(year: number, month: number, day: number): Date | null {
  const result = new Date(year, month - 1, day);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
}

export function inferTimeRange(input: string, now = new Date()): TimeRange | null {
  const explicit = input.match(
    /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(?:到|至|—|–|~|～)\s*(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/,
  );
  if (explicit) {
    const start = localDate(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]));
    const end = localDate(Number(explicit[4]), Number(explicit[5]), Number(explicit[6]));
    if (start && end && start <= end) {
      return { createdFrom: start.toISOString(), createdTo: addDays(end, 1).toISOString() };
    }
  }

  const today = startOfLocalDay(now);
  const recentDays = input.match(/最近\s*(\d{1,3})\s*天/);
  if (recentDays) {
    const days = Math.max(1, Number(recentDays[1]));
    return {
      createdFrom: addDays(today, -(days - 1)).toISOString(),
      createdTo: addDays(today, 1).toISOString(),
    };
  }

  if (/最近\s*(?:一周|7\s*天)/.test(input)) {
    return {
      createdFrom: addDays(today, -6).toISOString(),
      createdTo: addDays(today, 1).toISOString(),
    };
  }
  if (/最近\s*(?:一个月|30\s*天)/.test(input)) {
    return {
      createdFrom: addDays(today, -29).toISOString(),
      createdTo: addDays(today, 1).toISOString(),
    };
  }
  if (/今天/.test(input)) {
    return { createdFrom: today.toISOString(), createdTo: addDays(today, 1).toISOString() };
  }
  if (/本周/.test(input)) {
    const weekday = today.getDay() || 7;
    return {
      createdFrom: addDays(today, -(weekday - 1)).toISOString(),
      createdTo: addDays(today, 1).toISOString(),
    };
  }
  if (/本月/.test(input)) {
    return {
      createdFrom: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
      createdTo: addDays(today, 1).toISOString(),
    };
  }
  return null;
}

export function inferTopic(input: string): string | null {
  const quoted = input.match(/[“「『"]([^”」』"]{2,80})[”」』"]/);
  if (quoted) return quoted[1].trim();

  const opinion = input.match(/对\s*([^，。！？?]{2,80}?)\s*的(?:看法|想法|观点|判断)/);
  if (opinion) return opinion[1].trim();

  const about = input.match(
    /(?:关于|有关|围绕)\s*([^，。！？?]{2,80}?)(?:的(?:看法|想法|观点|判断|记录|进展)|[，。！？?]|$)/,
  );
  if (about) return about[1].trim();

  const leadingSubject = input.match(
    /^([^，。！？?]{2,40}?)(?:我)?(?:之前|以前).*(?:怎么看|怎么想|看法|想法)/,
  );
  if (leadingSubject) return leadingSubject[1].trim();

  if (/(?:记了什么|记过什么|全部|所有|总结.*想法|回顾.*想法|报告)/.test(input)) {
    return "全部";
  }
  return null;
}

export function parseVisibilityChoice(input: string): "PRIVATE" | "WORKSPACE" | null {
  const normalized = input.trim().toLowerCase();
  if (/^(?:1|自己|仅自己|只存给自己|私有|private)[。.!！]?$/.test(normalized)) {
    return "PRIVATE";
  }
  if (/^(?:2|团队|共享|共享给团队|分享给团队|工作区|workspace)[。.!！]?$/.test(normalized)) {
    return "WORKSPACE";
  }
  return null;
}

export function routeMessage(
  input: string,
  members: MemberReference[],
  currentUserId: string,
  now = new Date(),
): MessageRoute {
  const trimmed = input.trim();
  if (
    new RegExp(
      `^(?:把|将)?(?:我的)?${LATEST_MEMORY}.*(?:取消共享|改成私有|设为私有|仅自己可见)[。.!！]?$`,
    ).test(trimmed)
  ) {
    return { kind: "UNSHARE_LATEST" };
  }
  if (
    new RegExp(
      `^(?:把|将)?(?:我的)?${LATEST_MEMORY}.*(?:分享|共享)(?:给团队|到团队|到工作区)?[。.!！]?$`,
    ).test(trimmed)
  ) {
    return { kind: "SHARE_LATEST" };
  }
  if (new RegExp(`^(?:请)?(?:帮我)?删除(?:我的)?${LATEST_MEMORY}[。.!！]?$`).test(trimmed)) {
    return { kind: "DELETE_LATEST" };
  }
  const supplement = trimmed.match(
    new RegExp(`^(?:补充|追加)(?:到|给)?(?:我的)?${LATEST_MEMORY}[：:，,\\s]+([\\s\\S]+)$`),
  );
  if (supplement) return { kind: "SUPPLEMENT_LATEST", body: supplement[1].trim() };

  const captureMatch = trimmed.match(CAPTURE_PREFIX);
  if (captureMatch) {
    const body = trimmed.slice(captureMatch[0].length).trim();
    return { kind: "CAPTURE", body: body || trimmed };
  }
  if (!QUESTION_CUE.test(trimmed) && !REPORT_CUE.test(trimmed)) {
    return { kind: "CAPTURE", body: trimmed };
  }

  const topic = inferTopic(trimmed);
  const timeRange = inferTimeRange(trimmed, now);
  const queryKind: QueryRoute["kind"] = REPORT_CUE.test(trimmed) ? "REPORT" : "QUESTION";
  const normalized = trimmed.toLocaleLowerCase("zh-CN");
  const colleague = members.find(
    (member) =>
      member.id !== currentUserId &&
      normalized.includes(member.display_name.toLocaleLowerCase("zh-CN")),
  );
  if (colleague) {
    return {
      kind: queryKind,
      question: trimmed,
      topic,
      scope: "COLLEAGUE",
      authorId: colleague.id,
      timeRange,
    };
  }
  if (TEAM_CUE.test(trimmed)) {
    return {
      kind: queryKind,
      question: trimmed,
      topic,
      scope: "WORKSPACE",
      authorId: null,
      timeRange,
    };
  }
  if (COLLEAGUE_CUE.test(trimmed)) {
    return { kind: "NEEDS_COLLEAGUE", queryKind, question: trimmed, topic, timeRange };
  }
  return {
    kind: queryKind,
    question: trimmed,
    topic,
    scope: "PERSONAL",
    authorId: null,
    timeRange,
  };
}
