import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("展示工程阶段和三项产品基础原则", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "让每个想法，都能在需要时被重新找到。" }),
    ).toBeInTheDocument();
    expect(screen.getByText("默认私有")).toBeInTheDocument();
    expect(screen.getByText("时间可信")).toBeInTheDocument();
    expect(screen.getByText("回答有据")).toBeInTheDocument();
    expect(
      screen.getByText("当前阶段不包含登录、想法记录或 Chatbot 业务功能。"),
    ).toBeInTheDocument();
  });
});
