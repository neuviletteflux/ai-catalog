# Example skill implementation

"""A minimal demo skill used to validate the catalog structure."""

from __future__ import annotations


def run(prompt: str) -> str:
    """Return a simple formatted response for the provided prompt."""
    return f"Skill executed successfully. Input: {prompt}"


if __name__ == "__main__":
    print(run("hello from example skill"))
