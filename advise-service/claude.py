"""The Claude API call of the advise service: one streamed request with a JSON schema answer.
Same settings as the other CATCH workers (ocr-service/extract.py, mrac-service/mrac/judge.py), kept here so this
service doesn't import code from another one."""

import json
import os

DEFAULT_MODEL = "claude-opus-5-5"
REQUEST_TIMEOUT = 180   # seconds without data from the stream; treated like "busy" and retried later
# Models that accept server-side refusal fallbacks (fallbacks="default"); others get the plain request
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class RetryLater(Exception):
    """Rate limit or a temporary Claude API error: put the request back in the queue."""


_client = None


def _get_client(api_key):
    global _client
    if _client is None:
        import anthropic

        # The SDK already retries 429 / 5xx / dropped connections twice before raising
        _client = anthropic.Anthropic(api_key=api_key, timeout=REQUEST_TIMEOUT)
    return _client


def ai_config():
    """(api_key, model) from the environment; api_key is None when the AI is off."""
    return os.getenv("ANTHROPIC_API_KEY") or None, os.getenv("ANTHROPIC_MODEL") or DEFAULT_MODEL


def _answer_text(message):
    """The JSON answer. With a server-side fallback, text before the last fallback block is the declined
    model's partial answer, so only what comes after it counts."""
    blocks = list(message.content)
    last_fallback = max((i for i, b in enumerate(blocks) if b.type == "fallback"), default=-1)
    return "".join(b.text for b in blocks[last_fallback + 1:] if b.type == "text")


def ask_json(api_key, model, system, user, schema, effort, max_tokens):
    """(answer dict, message). Raises RetryLater on rate limits / temporary errors, RuntimeError on a refusal, a cut-off
    or a malformed answer, and the SDK's error on anything else (a bad request won't get better by retrying)."""
    import anthropic

    request = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }
    if model in FALLBACK_MODELS:  # a safety-classifier decline is re-run on Anthropic's recommended model
        request.update(betas=[FALLBACK_BETA], fallbacks="default")
    try:
        with _get_client(api_key).beta.messages.stream(**request) as stream:
            message = stream.get_final_message()
    except (anthropic.RateLimitError, anthropic.APIConnectionError) as e:
        raise RetryLater(f"Claude API busy or unreachable ({type(e).__name__}): {str(e)[:300]}") from e
    except anthropic.APIStatusError as e:
        if e.status_code >= 500:
            raise RetryLater(f"Claude API busy ({e.status_code}): {str(e)[:300]}") from e
        raise

    if message.stop_reason == "refusal":
        category = getattr(message.stop_details, "category", None)
        raise RuntimeError(f"Claude declined to answer (refusal{f': {category}' if category else ''})")
    if message.stop_reason == "max_tokens":
        raise RuntimeError(f"Claude's answer was cut off at {max_tokens} tokens")
    try:
        return json.loads(_answer_text(message)), message
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Claude's answer is not valid JSON: {e}") from e


def token_counts(message):
    """(input tokens incl. cache, output tokens), or (None, None)."""
    usage = message.usage
    if not usage:
        return None, None
    return (usage.input_tokens + (usage.cache_creation_input_tokens or 0) + (usage.cache_read_input_tokens or 0),
            usage.output_tokens)
