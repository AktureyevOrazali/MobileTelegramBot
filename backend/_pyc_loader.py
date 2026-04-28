from __future__ import annotations

import importlib.machinery
import importlib.util
import sys
from pathlib import Path
from types import ModuleType


def _resolve_pyc_path(module_basename: str) -> Path:
    pycache_dir = Path(__file__).with_name("__pycache__")
    version_tag = f"cpython-{sys.version_info.major}{sys.version_info.minor}"
    exact = pycache_dir / f"{module_basename}.{version_tag}.pyc"
    if exact.exists():
        return exact

    matches = sorted(pycache_dir.glob(f"{module_basename}.cpython-*.pyc"))
    if matches:
        return matches[-1]
    raise FileNotFoundError(f"Compiled module for {module_basename!r} not found in {pycache_dir}")


def load_pyc_module(module_basename: str) -> ModuleType:
    pyc_path = _resolve_pyc_path(module_basename)
    module_name = f"{__package__}._restored_{module_basename}"
    loader = importlib.machinery.SourcelessFileLoader(module_name, str(pyc_path))
    spec = importlib.util.spec_from_loader(module_name, loader)
    if spec is None:
        raise ImportError(f"Could not create import spec for {pyc_path}")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def reexport_pyc(module_basename: str, target_globals: dict[str, object]) -> None:
    module = load_pyc_module(module_basename)
    public_names = getattr(module, "__all__", None)
    if public_names is None:
      public_names = [name for name in vars(module) if not name.startswith("_")]
    for name in public_names:
        target_globals[name] = getattr(module, name)
    target_globals["__all__"] = list(public_names)
