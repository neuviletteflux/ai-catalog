import importlib.util
import os
import sys


def load_run_from_path():
    # locate the implementation main.py relative to this test file
    base = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    impl_path = os.path.join(base, "implementation", "main.py")
    spec = importlib.util.spec_from_file_location("example_skill_main", impl_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.run


def test_example_skill_run():
    run = load_run_from_path()
    result = run("test input")
    assert "Skill executed successfully" in result
    assert "test input" in result
