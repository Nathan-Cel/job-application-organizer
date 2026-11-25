from app import prompts


def test_cv_is_truncated():
    message = prompts.system_message({"cv": "x" * 10000})
    assert len(message["content"]) < prompts.MAX_PROFILE_FIELD + 1000
