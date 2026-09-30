import argparse
import json

from llm_provider import generate_text


def main() -> None:
    parser = argparse.ArgumentParser(description="Send one short prompt through the configured provider to check that it works.")
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    reply = generate_text("Reply with the single word OK.", args.model)
    if not reply.strip():
        raise RuntimeError("The provider returned an empty reply.")
    print(json.dumps({"reply": reply[:200]}))


if __name__ == "__main__":
    main()
