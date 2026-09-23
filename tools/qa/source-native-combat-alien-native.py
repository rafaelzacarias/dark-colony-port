"""Provider evidence: original ALIEN02 policy with a constructed type8 target."""

import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "provider_damaged", Path(__file__).with_name("native-damaged-actor-native.py")
)
damaged = importlib.util.module_from_spec(spec)
spec.loader.exec_module(damaged)
original_capture = damaged.PROJECTILE.capture


def original_policy_capture(*args, **kwargs):
    assert args == (8,) and kwargs["policy"] == 0 and kwargs["armor_level"] == 0
    kwargs["policy"] = None
    return original_capture(*args, **kwargs)


damaged.PROJECTILE.capture = original_policy_capture
try:
    evidence = damaged.capture(kind=8)
finally:
    damaged.PROJECTILE.capture = original_capture

assert evidence["projectile"]["policy"] == 1
assert evidence["projectile"]["fire"]["received"][7] == 0
assert evidence["world"]["typeId"] == 8
assert evidence["projectile"]["fixture"]["policy"] is None
assert evidence["projectile"]["fire"]["runtimeIntercepts"] == []
evidence["providerBoundary"] = {
    "mission": "ALIEN02",
    "localTeam": 0,
    "policy": "original-initializer-unmodified",
    "target": "original-constructor-type8-controlled-opponent",
    "armorLevel": "source-equivalent-zero",
}
print(json.dumps(evidence), flush=True)