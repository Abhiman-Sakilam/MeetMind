import pytest
from app.personas import get_persona, PERSONAS, DEFAULT_PERSONA


def test_all_six_personas_exist():
    expected = {"friendly", "professional", "witty", "calm", "hacker", "motivator"}
    assert set(PERSONAS.keys()) == expected


def test_each_persona_has_required_fields():
    for key, persona in PERSONAS.items():
        assert persona.emoji, f"{key}: emoji is empty"
        assert persona.label, f"{key}: label is empty"
        assert len(persona.system_prompt) > 50, f"{key}: system_prompt too short"
        assert persona.switch_announcement, f"{key}: switch_announcement is empty"


def test_get_persona_returns_correct_persona():
    p = get_persona("professional")
    assert p.emoji == "🎩"
    assert p.label == "Professional"


def test_get_persona_falls_back_to_default_for_unknown_key():
    p = get_persona("nonexistent_persona_xyz")
    assert p == PERSONAS[DEFAULT_PERSONA]


def test_switch_announcements_are_unique():
    announcements = [p.switch_announcement for p in PERSONAS.values()]
    assert len(announcements) == len(set(announcements)), "switch announcements must be unique"


def test_system_prompts_contain_persona_name():
    for key, persona in PERSONAS.items():
        assert key.upper() in persona.system_prompt.upper(), \
            f"{key}: system_prompt should mention the persona name"
