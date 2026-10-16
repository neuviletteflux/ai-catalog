def test_example_skill_run():
    from skills.example-skill.implementation.main import run

    result = run("test input")
    assert "Skill executed successfully" in result
    assert "test input" in result
