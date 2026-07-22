import { describe, expect, it } from "vitest";

import { inferTimeRange, parseVisibilityChoice, routeMessage } from "./conversation-router";

const members = [
  { id: "alex", display_name: "Alex" },
  { id: "blair", display_name: "Blair" },
  { id: "casey", display_name: "Casey" },
];

describe("conversation router", () => {
  it("把普通陈述和明确记录命令视为待保存内容", () => {
    expect(routeMessage("定价应该从小团队开始。", members, "alex")).toEqual({
      kind: "CAPTURE",
      body: "定价应该从小团队开始。",
    });
    expect(routeMessage("帮我记一下：先验证每周回顾", members, "alex")).toEqual({
      kind: "CAPTURE",
      body: "先验证每周回顾",
    });
  });

  it("宽泛回顾默认使用个人全部记录", () => {
    expect(routeMessage("我之前记了什么？", members, "alex")).toMatchObject({
      kind: "QUESTION",
      topic: "全部",
      scope: "PERSONAL",
      authorId: null,
    });
  });

  it("只有明确团队词或成员姓名才扩大范围", () => {
    expect(routeMessage("总结团队最近 7 天的想法", members, "alex")).toMatchObject({
      kind: "REPORT",
      topic: "全部",
      scope: "WORKSPACE",
    });
    expect(routeMessage("Blair 最近有什么想法？", members, "alex")).toMatchObject({
      kind: "QUESTION",
      scope: "COLLEAGUE",
      authorId: "blair",
    });
    expect(routeMessage("这个同事最近有什么进展？", members, "alex")).toMatchObject({
      kind: "NEEDS_COLLEAGUE",
    });
  });

  it("把报告和观点变化请求路由到显式范围报告", () => {
    expect(routeMessage("给我一份最近 30 天的想法变化报告", members, "alex")).toMatchObject({
      kind: "REPORT",
      scope: "PERSONAL",
      topic: "全部",
    });
  });

  it("解析显式日期和常用相对时间为左闭右开范围", () => {
    const explicit = inferTimeRange("总结 2026-07-01 到 2026-07-22 的想法");
    expect(explicit?.createdFrom).toBe(new Date(2026, 6, 1).toISOString());
    expect(explicit?.createdTo).toBe(new Date(2026, 6, 23).toISOString());

    const recent = inferTimeRange("总结最近 7 天", new Date(2026, 6, 22, 14));
    expect(recent?.createdFrom).toBe(new Date(2026, 6, 16).toISOString());
    expect(recent?.createdTo).toBe(new Date(2026, 6, 23).toISOString());
  });

  it("只接受清晰的私有或团队选择", () => {
    expect(parseVisibilityChoice("只存给自己")).toBe("PRIVATE");
    expect(parseVisibilityChoice("共享给团队")).toBe("WORKSPACE");
    expect(parseVisibilityChoice("你决定吧")).toBeNull();
  });

  it("把低频记录操作路由为聊天命令", () => {
    expect(routeMessage("把上一条共享给团队", members, "alex")).toEqual({
      kind: "SHARE_LATEST",
    });
    expect(routeMessage("把上一条取消共享", members, "alex")).toEqual({
      kind: "UNSHARE_LATEST",
    });
    expect(routeMessage("删除上一条", members, "alex")).toEqual({ kind: "DELETE_LATEST" });
    expect(routeMessage("补充上一条：先验证四个人是否持续使用", members, "alex")).toEqual({
      kind: "SUPPLEMENT_LATEST",
      body: "先验证四个人是否持续使用",
    });
  });
});
