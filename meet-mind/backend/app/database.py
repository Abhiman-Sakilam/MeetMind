from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# Additive migrations: safe to run on every startup.
# Each statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so they are no-ops after the first run.
_MIGRATIONS = [
    # meetings: new columns added after initial schema
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS topic VARCHAR",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS topics JSONB",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS keywords JSONB",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_id VARCHAR(36)",
    "ALTER TABLE participants ADD COLUMN IF NOT EXISTS user_id VARCHAR(36)",
    "ALTER TABLE notes ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)",
    "ALTER TABLE notes ADD COLUMN IF NOT EXISTS session_title VARCHAR(200)",
    # commands table
    """
    CREATE TABLE IF NOT EXISTS commands (
        id VARCHAR PRIMARY KEY,
        meeting_id VARCHAR NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        command_type VARCHAR(50),
        original_text TEXT,
        parameters JSONB,
        response TEXT,
        executed_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # notes table
    """
    CREATE TABLE IF NOT EXISTS notes (
        id VARCHAR PRIMARY KEY,
        meeting_id VARCHAR NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'key_point',
        speaker_name VARCHAR,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # action_items table
    """
    CREATE TABLE IF NOT EXISTS action_items (
        id VARCHAR PRIMARY KEY,
        meeting_id VARCHAR NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        assigned_to VARCHAR,
        due_date TIMESTAMPTZ,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # decisions table
    """
    CREATE TABLE IF NOT EXISTS decisions (
        id VARCHAR PRIMARY KEY,
        meeting_id VARCHAR NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        options JSONB,
        analysis TEXT,
        chosen_option TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # transcripts table (for full meeting transcript / summary)
    """
    CREATE TABLE IF NOT EXISTS transcripts (
        id VARCHAR PRIMARY KEY,
        meeting_id VARCHAR NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_name VARCHAR,
        text TEXT NOT NULL,
        "timestamp" FLOAT DEFAULT 0.0,
        confidence FLOAT DEFAULT 1.0,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
]


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for stmt in _MIGRATIONS:
            await conn.execute(text(stmt.strip()))


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
