"""Local opt-in limits; imported/hosted services retain conservative defaults."""
import os


def individual_limit(public_limit: int) -> int:
    return 1000 if os.environ.get("PFF_LOCAL_LARGE_COHORTS") == "1" else public_limit
