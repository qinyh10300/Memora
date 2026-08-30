import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DraftTrace } from "@/features/shared/contracts";

import { ActivityTrace, formatTraceDuration } from "./activity-trace";

afterEach(cleanup);

const liveTrace: DraftTrace = {
  duration_ms: 1200,
  model: "test-model",
  input_tokens: 0,
  output_tokens: 0,
  steps: [
    {
      id: "analysis",
      kind: "ANALYSIS",
      status: "COMPLETED",
      title: "理解请求并检查执行边界",
      detail: "只显示安全的过程摘要。",
      elapsed_ms: 0,
      duration_ms: 300,
      item_count: null,
    },
    {
      id: "tool-search-memories-1",
      kind: "RETRIEVAL",
      status: "RUNNING",
      title: "搜索个人记忆",
      detail: "正在搜索当前账号仍可访问的个人记忆。",
      elapsed_ms: 300,
      duration_ms: null,
      item_count: null,
    },
  ],
};

describe("ActivityTrace", () => {
  it("formats total and step time like a compact execution timeline", () => {
    expect(formatTraceDuration(7_800)).toBe("7.8s");
    expect(formatTraceDuration(185_000)).toBe("3m 5s");
  });

  it("shows live progress without presenting hidden chain of thought", () => {
    const { container } = render(<ActivityTrace trace={liveTrace} active />);

    expect(screen.getByText("正在执行")).toBeInTheDocument();
    expect(screen.getByText("1/2 个步骤")).toBeInTheDocument();
    expect(screen.getByText("1.2s")).toHaveClass("trace-summary-time");
    expect(screen.getByRole("status")).toHaveTextContent("当前：搜索个人记忆");
    expect(screen.getByText("安全过程摘要，不包含模型隐藏思维链。")).toBeInTheDocument();
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("collapses a completed trace and keeps its evidence summary available", () => {
    const completedTrace: DraftTrace = {
      ...liveTrace,
      duration_ms: 2400,
      steps: liveTrace.steps.map((step) => ({
        ...step,
        status: "COMPLETED" as const,
        duration_ms: step.duration_ms ?? 900,
      })),
    };
    const { container } = render(<ActivityTrace trace={completedTrace} />);

    expect(screen.getByText("执行了 2 个步骤")).toBeInTheDocument();
    expect(screen.getByText("工作过程")).toBeInTheDocument();
    expect(screen.getByText("2.4s")).toHaveClass("trace-summary-time");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
