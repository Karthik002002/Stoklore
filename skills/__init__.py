"""Skill registry: drop a .py file here with a filter(tickers) -> tickers function."""
import importlib
import pkgutil

import skills


def available_skills():
    return sorted(name for _, name, _ in pkgutil.iter_modules(skills.__path__))


def load_skill(name):
    module = importlib.import_module(f"skills.{name}")
    if not hasattr(module, "filter"):
        raise ValueError(f"skill '{name}' has no filter(tickers) function")
    return module.filter
