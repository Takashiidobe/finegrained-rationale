import json
import os
import subprocess
import tempfile
from pathlib import Path


def generate_text(prompt: str, model_name: str) -> str:
    mode = os.environ.get("ARGUS_LLM_MODE", "api").lower()
    provider = os.environ.get("ARGUS_LLM_PROVIDER", "openai").lower()
    if mode == "cli":
        return _generate_with_cli(provider, prompt, model_name)
    if provider == "openai":
        return _generate_with_openai(prompt, model_name)
    if provider == "anthropic":
        return _generate_with_anthropic(prompt, model_name)
    raise ValueError(f"Unsupported API provider: {provider}")


def _generate_with_openai(prompt: str, model_name: str) -> str:
    from openai import OpenAI

    api_key = os.environ.get("ARGUS_LLM_API_KEY") or os.environ.get("OPENAI_TOKEN") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set an OpenAI API key in Rationale configuration.")
    response = OpenAI(api_key=api_key).responses.create(
        model=model_name,
        input=[{"role": "user", "content": prompt}],
        reasoning={"effort": "high"},
    )
    return (response.output_text or "").strip()


def _generate_with_anthropic(prompt: str, model_name: str) -> str:
    from anthropic import Anthropic

    api_key = os.environ.get("ARGUS_LLM_API_KEY")
    if not api_key:
        raise RuntimeError("Set an Anthropic API key in Rationale configuration.")
    response = Anthropic(api_key=api_key).messages.create(
        model=model_name,
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    return "\n".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()


def _generate_with_cli(provider: str, prompt: str, model_name: str) -> str:
    with tempfile.TemporaryDirectory(prefix="rationale-cli-") as workdir:
        if provider == "claude-code":
            return _run_claude_cli(prompt, model_name, Path(workdir))
        if provider == "codex":
            return _run_codex_cli(prompt, model_name, Path(workdir))
    raise ValueError(f"Unsupported CLI provider: {provider}")


def _run_claude_cli(prompt: str, model_name: str, workdir: Path) -> str:
    command = [
        "claude", "-p", "--input-format", "text", "--output-format", "json", *_model_flag(model_name),
        "--max-turns", "1", "--safe-mode", "--tools", "", "--disallowedTools", "mcp__*",
    ]
    try:
        result = subprocess.run(command, input=prompt, text=True, capture_output=True, cwd=workdir, check=False, timeout=600)
    except FileNotFoundError as error:
        raise RuntimeError("Claude Code CLI was not found. Install it and sign in with a Claude plan, then try again.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Claude Code CLI did not finish within 10 minutes.") from error
    if result.returncode:
        raise RuntimeError(_cli_error("Claude Code", result))
    try:
        output = json.loads(result.stdout)
        return str(output.get("result", "")).strip()
    except json.JSONDecodeError as error:
        raise RuntimeError("Claude Code returned an unreadable response. Check that its CLI is installed and signed in.") from error


def _run_codex_cli(prompt: str, model_name: str, workdir: Path) -> str:
    command = [
        "codex", "exec", "--json", "--sandbox", "read-only", "--config", 'approval_policy="never"',
        "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", *_model_flag(model_name), "-",
    ]
    try:
        result = subprocess.run(command, input=prompt, text=True, capture_output=True, cwd=workdir, check=False, timeout=600)
    except FileNotFoundError as error:
        raise RuntimeError("Codex CLI was not found. Install it and sign in with your ChatGPT plan, then try again.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Codex CLI did not finish within 10 minutes.") from error
    if result.returncode:
        raise RuntimeError(_cli_error("Codex CLI", result))
    responses = []
    for line in result.stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item", {})
        if item.get("type") == "agent_message" and isinstance(item.get("text"), str):
            responses.append(item["text"])
    if responses:
        return responses[-1].strip()
    raise RuntimeError("Codex CLI returned no assistant response. Check that its CLI is installed and signed in.")


def _model_flag(model_name: str) -> list[str]:
    return [] if model_name in ("", "default") else ["--model", model_name]


def _cli_error(name: str, result: subprocess.CompletedProcess[str]) -> str:
    detail = (result.stderr or result.stdout).strip()
    try:
        message = json.loads(result.stdout).get("result")
    except (json.JSONDecodeError, AttributeError):
        message = None
    if isinstance(message, str) and message.strip():
        detail = message.strip()
    if not detail:
        detail = "Check that the CLI is installed and signed in."
    return f"{name} failed: {detail}"
