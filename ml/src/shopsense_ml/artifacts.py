"""Persist / restore model bundles on local disk (MODEL_DIR)."""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

from shopsense_ml.recommender import ModelBundle

log = logging.getLogger(__name__)
POINTER = "current.json"
KEEP = 3


def save_bundle(bundle: ModelBundle, model_dir: Path) -> tuple[Path, Path]:
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"model-{bundle.version}.pkl"
    meta_path = model_dir / f"metadata-{bundle.version}.json"
    tmp = model_path.with_suffix(".tmp")
    with tmp.open("wb") as fh:
        pickle.dump(bundle, fh, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(model_path)
    meta_path.write_text(json.dumps(bundle.metadata, indent=2, default=str))
    (model_dir / POINTER).write_text(
        json.dumps({"version": bundle.version, "model": model_path.name})
    )
    _prune(model_dir)
    return model_path, meta_path


def load_current(model_dir: Path) -> ModelBundle | None:
    pointer = model_dir / POINTER
    if not pointer.exists():
        return None
    try:
        info = json.loads(pointer.read_text())
        with (model_dir / info["model"]).open("rb") as fh:
            bundle = pickle.load(fh)
        if not isinstance(bundle, ModelBundle):
            raise TypeError("artefact is not a ModelBundle")
        return bundle
    except Exception as exc:
        log.warning("failed to load model artefact", extra={"error": str(exc)})
        return None


def _prune(model_dir: Path) -> None:
    models = sorted(model_dir.glob("model-*.pkl"))
    for old in models[:-KEEP]:
        version = old.stem.removeprefix("model-")
        old.unlink(missing_ok=True)
        (model_dir / f"metadata-{version}.json").unlink(missing_ok=True)
