import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, DateTime, Integer, Float, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    display_name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    # Bumped on password reset / Google password drop; older login tokens stop working.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), default=_now)


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String(36), primary_key=True, default=_uuid)
    room_name = Column(String, unique=True, index=True)
    title = Column(String, default="Untitled Meeting")
    created_at = Column(DateTime(timezone=True), default=_now)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    topic = Column(String, nullable=True)
    status = Column(String, default="active")
    topics = Column(JSON, nullable=True)
    keywords = Column(JSON, nullable=True)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)

    participants = relationship("Participant", back_populates="meeting", cascade="all, delete-orphan")
    transcripts = relationship("Transcript", back_populates="meeting", cascade="all, delete-orphan")
    commands = relationship("Command", back_populates="meeting", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="meeting", cascade="all, delete-orphan")
    action_items = relationship("ActionItem", back_populates="meeting", cascade="all, delete-orphan")
    decisions = relationship("Decision", back_populates="meeting", cascade="all, delete-orphan")


class Participant(Base):
    __tablename__ = "participants"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    peer_id = Column(String, nullable=True)
    joined_at = Column(DateTime(timezone=True), default=_now)
    left_at = Column(DateTime(timezone=True), nullable=True)

    meeting = relationship("Meeting", back_populates="participants")


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    speaker_name = Column(String, nullable=True)
    text = Column(Text, nullable=False)
    timestamp = Column(Float, default=0.0)
    confidence = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="transcripts")


class Command(Base):
    __tablename__ = "commands"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    command_type = Column(String(50), nullable=True)
    original_text = Column(Text, nullable=True)
    parameters = Column(JSON, nullable=True)
    response = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="commands")


class Note(Base):
    __tablename__ = "notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    type = Column(String(50), default="key_point")
    speaker_name = Column(String, nullable=True)
    session_id = Column(String(64), nullable=True)
    session_title = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="notes")


class ActionItem(Base):
    __tablename__ = "action_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    title = Column(Text, nullable=False)
    assigned_to = Column(String, nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(50), default="pending")
    created_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="action_items")


class Decision(Base):
    __tablename__ = "decisions"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    title = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)
    analysis = Column(Text, nullable=True)
    chosen_option = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    meeting = relationship("Meeting", back_populates="decisions")
