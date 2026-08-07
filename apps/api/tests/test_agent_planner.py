from memora.agent.planner import build_public_draft_plan


def test_public_plan_only_contains_safe_capability_steps() -> None:
    plan = build_public_draft_plan(
        restore_original=False,
        has_attachments=True,
        model_available=True,
        web_search_requested=True,
        web_search_available=True,
        save_requested=True,
    )

    assert [step.id for step in plan.steps] == [
        "validate",
        "attachments",
        "retrieval",
        "web-search",
        "model",
        "save",
        "output",
    ]
    assert plan.summary == (
        "公开计划 7 步：校验账号与输入边界、读取已授权附件、检索已授权个人记忆、"
        "查询可验证网页来源、调用所选模型整理草稿、校验授权后保存私有记忆、"
        "返回草稿与公开执行结果。"
    )


def test_public_plan_describes_restore_and_disabled_model_without_fake_work() -> None:
    restore = build_public_draft_plan(
        restore_original=True,
        has_attachments=True,
        model_available=True,
        web_search_requested=True,
        web_search_available=True,
        save_requested=True,
    )
    disabled = build_public_draft_plan(
        restore_original=False,
        has_attachments=False,
        model_available=False,
        web_search_requested=True,
        web_search_available=False,
        save_requested=True,
    )

    assert [step.id for step in restore.steps] == ["validate", "restore", "output"]
    assert [step.id for step in disabled.steps] == ["validate", "fallback", "output"]
