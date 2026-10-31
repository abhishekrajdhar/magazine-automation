import pytest

from app.config import Settings, get_settings
from app.services.llm import get_llm


@pytest.fixture
def fresh_settings():
    """get_settings() is cached; re-read the environment for these tests and restore afterwards."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _settings(**kw):
    return Settings(_env_file=None, **{"anthropic_api_key": "", "openai_api_key": "", "llm_model": "", **kw})


@pytest.mark.parametrize(
    ("openai", "anthropic", "provider", "model"),
    [
        ("sk-openai", "", "openai_compatible", "gpt-4.1"),
        ("", "sk-ant", "anthropic", "claude-opus-5-5"),
        ("sk-openai", "sk-ant", "openai_compatible", "gpt-4.1"),
        ("", "", "none", "claude-opus-5-5"),
    ],
)
def test_auto_picks_whichever_key_is_set(openai, anthropic, provider, model):
    s = _settings(llm_provider="auto", openai_api_key=openai, anthropic_api_key=anthropic)
    assert s.effective_llm_provider == provider
    assert s.effective_llm_model == model


def test_explicit_provider_and_model_override_auto():
    s = _settings(llm_provider="anthropic", openai_api_key="sk-openai", anthropic_api_key="sk-ant")
    assert s.effective_llm_provider == "anthropic" and s.effective_llm_model == "claude-opus-5-5"
    s = _settings(llm_provider="auto", openai_api_key="sk-openai", llm_model="my-model", openai_model="ignored")
    assert s.effective_llm_model == "my-model"


def test_get_llm_uses_openai_without_an_anthropic_key(monkeypatch, fresh_settings):
    monkeypatch.setenv("LLM_PROVIDER", "auto")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("LLM_MODEL", "")
    llm = get_llm()
    assert llm.name == "openai_compatible" and llm.model == "gpt-4.1"
    assert llm.configured()[0] is True


def test_get_llm_without_any_key_explains_both_options(monkeypatch, fresh_settings):
    monkeypatch.setenv("LLM_PROVIDER", "auto")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    ok, detail = get_llm().configured()
    assert ok is False and "OPENAI_API_KEY" in detail and "ANTHROPIC_API_KEY" in detail
