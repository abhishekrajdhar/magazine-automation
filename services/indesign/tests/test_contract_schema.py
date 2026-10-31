"""The shared layout contract example must validate against the schema the renderer targets."""

from __future__ import annotations

import copy
import json

import pytest

jsonschema = pytest.importorskip("jsonschema")

from conftest import CONTRACTS_DIR, example_contract  # noqa: E402


@pytest.fixture(scope="module")
def validator():
    schema = json.loads((CONTRACTS_DIR / "layout-contract.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def test_example_contract_validates(validator):
    errors = sorted(validator.iter_errors(example_contract()), key=lambda e: list(e.path))
    assert not errors, [f"{list(e.path)}: {e.message}" for e in errors]


def test_schema_rejects_bad_frame_bounds(validator):
    bad = copy.deepcopy(example_contract())
    bad["pages"][0]["frames"][0]["bounds_pt"] = [0, 0, 380]
    assert list(validator.iter_errors(bad)), "3-element bounds_pt must be rejected"


def test_schema_rejects_unknown_frame_kind(validator):
    bad = copy.deepcopy(example_contract())
    bad["pages"][0]["frames"][0]["kind"] = "video"
    assert list(validator.iter_errors(bad))


def test_example_uses_only_fields_the_renderer_maps():
    """Guard against contract drift: every frame kind/fit/fitting in the example is handled by the JSX."""
    from conftest import EXTENDSCRIPT_DIR

    jsx = (EXTENDSCRIPT_DIR / "pressflow-render.jsx").read_text(encoding="utf-8")
    contract = example_contract()
    for page in contract["pages"]:
        for frame in page["frames"]:
            assert f'"{frame["kind"]}"' in jsx
            if "fit" in frame:
                assert f'"{frame["fit"]}"' in jsx
            if "image" in frame and "fitting" in frame["image"]:
                assert f'"{frame["image"]["fitting"]}"' in jsx
