import { expect, test, type Browser, type Page } from "@playwright/test";

const owner = {
  name: "Browser Owner",
  email: "browser-owner@memora.local",
  password: "browser-owner-password",
};
const member = {
  name: "Browser Member",
  email: "browser-member@memora.local",
  password: "browser-member-password",
};

function createTextPdf(text: string): Buffer {
  const escapedText = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 18 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function register(page: Page, account: typeof owner) {
  await page.goto("/");
  const registerButton = page.getByRole("button", { name: "快速开始" }).first();
  await expect(registerButton).toBeVisible();
  await registerButton.click();
  const dialog = page.getByRole("dialog", { name: "创建个人空间" });
  await dialog.locator('input[name="display_name"]').fill(account.name);
  await dialog.locator('input[name="email"]').fill(account.email);
  await dialog.locator('input[name="password"]').fill(account.password);
  await dialog.locator('input[name="password_confirm"]').fill(account.password);
  await dialog.getByRole("button", { name: "创建并进入" }).click();
  await expect(page.getByRole("region", { name: "草稿对话" })).toBeVisible();
}

async function createTeam(page: Page, teamName: string): Promise<string> {
  await page.getByRole("button", { name: /切换空间，当前为/ }).click();
  await page.getByRole("menu").getByRole("button", { name: "创建团队" }).click();
  const dialog = page.getByRole("dialog", { name: "创建团队" });
  await dialog.getByLabel("团队名称").fill(teamName);
  await dialog.getByRole("button", { name: "创建并进入" }).click();
  await page
    .getByRole("navigation", { name: "主要功能" })
    .getByRole("button", { name: "团队" })
    .click();
  await expect(page.getByRole("heading", { name: teamName })).toBeVisible();
  const formattedCode = (await page.locator(".team-summary-band code").textContent()) ?? "";
  return formattedCode.replaceAll("-", "");
}

async function requestToJoinTeam(page: Page, teamName: string, teamCode: string) {
  await page.getByRole("button", { name: /切换空间，当前为/ }).click();
  await page.getByRole("menu").getByRole("button", { name: "使用团队号加入" }).click();
  const dialog = page.getByRole("dialog", { name: "加入团队" });
  await dialog.getByLabel("团队号").fill(teamCode);
  await dialog.getByRole("button", { name: "提交加入申请" }).click();
  const submittedDialog = page.getByRole("dialog", { name: "申请已提交" });
  await expect(submittedDialog).toBeVisible();
  await expect(submittedDialog.getByText(teamName)).toBeVisible();
  await submittedDialog.getByRole("button", { name: "完成" }).click();
}

async function selectTeam(page: Page, teamName: string) {
  await page.getByRole("button", { name: /切换空间，当前为/ }).click();
  await page.getByRole("menuitem", { name: teamName }).click();
  await page
    .getByRole("navigation", { name: "主要功能" })
    .getByRole("button", { name: "团队" })
    .click();
  await expect(page.getByRole("heading", { name: teamName })).toBeVisible();
}

test("核心记忆、Agent、团队权限和移动端路径", async ({ page, browser }) => {
  await register(page, owner);

  await page.getByRole("combobox", { name: "联网模式" }).selectOption("DISABLED");
  await page.locator('input[type="file"][accept*="application/pdf"]').setInputFiles({
    name: "browser-e2e-evidence.pdf",
    mimeType: "application/pdf",
    buffer: createTextPdf("Memora browser E2E document evidence and page citation."),
  });
  await expect(page.getByText("PDF 已解析，可以交给 AI 阅读。")).toBeVisible({
    timeout: 90_000,
  });

  await page
    .getByRole("textbox", { name: "告诉 Memora 你的想法" })
    .fill("请阅读 PDF，整理成标题和要点，然后帮我保存这个。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("已整理并保存到个人记忆。")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[aria-label="文档来源"]').getByText("文档 1 · 第 1 页")).toBeVisible();
  await page.getByText("工作过程").last().click();
  await expect(page.getByText("保存到个人记忆", { exact: true })).toBeVisible();
  await expect(page.getByText("已按当前账号和个人空间保存为私有记忆。")).toBeVisible();

  await page
    .getByRole("navigation", { name: "主要功能" })
    .getByRole("button", { name: "记忆库" })
    .click();
  await page.getByRole("button", { name: "检索记忆库" }).click();
  const searchForm = page.locator(".library-search-popover");
  await searchForm.getByPlaceholder("检索正文与标题").fill("Browser E2E PDF");
  await searchForm.getByRole("button", { name: "检索", exact: true }).click();
  await expect(page.getByRole("button", { name: /查看记忆：Browser E2E PDF 记忆/ })).toBeVisible();
  await page.getByRole("button", { name: /查看记忆：Browser E2E PDF 记忆/ }).click();
  await expect(page.locator('[aria-label="记忆文档来源"]')).toContainText("第 1 页");

  const teamName = "Browser E2E Research Team";
  const teamCode = await createTeam(page, teamName);
  expect(teamCode).toMatch(/^[A-Z0-9]{12}$/);

  const memberContext = await (browser as Browser).newContext({
    locale: "zh-CN",
    colorScheme: "dark",
  });
  const memberPage = await memberContext.newPage();
  await register(memberPage, member);
  await requestToJoinTeam(memberPage, teamName, teamCode);

  await page.reload();
  await selectTeam(page, teamName);
  const requestRow = page.locator(".team-requests-panel li").filter({ hasText: member.name });
  await expect(requestRow).toBeVisible();
  await requestRow.getByRole("button", { name: "允许" }).click();
  await expect(
    page.locator(".team-members-panel li").filter({ hasText: member.name }),
  ).toBeVisible();

  await memberPage.reload();
  await selectTeam(memberPage, teamName);
  await expect(memberPage.locator(".team-role-badge")).toHaveText("成员");

  const removeButton = page.getByRole("button", { name: `移除成员 ${member.name}` });
  await removeButton.click();
  await removeButton.click();
  await expect(page.locator(".team-members-panel li").filter({ hasText: member.name })).toHaveCount(
    0,
  );
  await memberContext.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileMenu = page.getByRole("button", { name: "打开导航" });
  await expect(mobileMenu).toBeVisible();
  await mobileMenu.click();
  await expect(page.getByRole("complementary", { name: "Memora 导航" })).toBeVisible();
  const hasNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(hasNoHorizontalOverflow).toBe(true);

  const metricsToken = process.env.METRICS_TOKEN;
  expect(metricsToken).toBeTruthy();
  const metricsResponse = await page.request.get("/api/metrics", {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  expect(metricsResponse.ok()).toBe(true);
  const metricBody = await metricsResponse.text();
  expect(metricBody).toContain("memora_http_requests_total");
  expect(metricBody).toContain("memora_agent_tool_executions_total");
  expect(metricBody).not.toContain("请阅读 PDF");
});
