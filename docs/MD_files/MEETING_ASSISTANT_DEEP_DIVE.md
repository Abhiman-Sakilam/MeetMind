# 🎤 AI Meeting Assistant - Complete Deep Dive

**Build a production-ready meeting transcription & analysis platform with real-time AI processing.**

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [What You'll Build](#what-youll-build)
3. [Why It's Marketable](#why-its-marketable)
4. [Complete Tech Stack](#complete-tech-stack)
5. [Architecture Deep Dive](#architecture-deep-dive)
6. [Week-by-Week Roadmap](#week-by-week-roadmap)
7. [Code Implementation](#code-implementation)
8. [Deployment Strategy](#deployment-strategy)
9. [Monetization Ideas](#monetization-ideas)
10. [Interview Talking Points](#interview-talking-points)

---

## 🎯 Project Overview

### The Problem

Every meeting is lost information:
- ❌ No searchable transcript
- ❌ Action items forgotten
- ❌ Decisions not documented
- ❌ Important details lost

### The Solution

**AI Meeting Assistant** - Records meetings, transcribes in real-time, extracts actionable insights, generates summaries automatically.

### Example Flow

```
Employee joins Zoom meeting
        ↓
App records audio stream
        ↓
Real-time transcription (every 10 seconds)
        ↓
AI agent extracts:
  ├─ Who's speaking (diarization)
  ├─ Action items ("John will send report by Friday")
  ├─ Key decisions ("Decided to move launch to Q2")
  ├─ Topics discussed
  └─ Sentiment (who's happy/concerned)
        ↓
Live dashboard shows:
  ├─ Real-time transcript
  ├─ Speaker names
  ├─ Action items with owners
  └─ Key moments flagged
        ↓
Post-meeting:
  ├─ Full transcript searchable
  ├─ Summary (2-3 paragraphs)
  ├─ Action items (with owners & deadlines)
  ├─ Key decisions listed
  ├─ Audio highlights (best clips)
  └─ Attendees overview
```

---

## 🏗️ What You'll Build

### Phase 1: MVP (Weeks 1-2)
Basic recording & transcription

```
[React] Audio recorder
  ↓
[FastAPI] Receive audio
  ↓
[Whisper] Transcribe
  ↓
[React] Display transcript
```

### Phase 2: Real-Time Intelligence (Weeks 3-4)
Speaker identification & action item extraction

```
[Audio Stream] (WebSocket)
  ↓
[Whisper API] Streaming transcription
  ↓
[PyAnnote] Speaker diarization
  ↓
[NER + LLM] Extract action items
  ↓
[WebSocket] Send back to frontend
```

### Phase 3: Advanced Features (Weeks 5-6)
Post-meeting analysis & dashboard

```
[Full Transcript] Analysis
  ↓
[Summarization] Generate summary
  ↓
[Topic Modeling] Extract topics
  ↓
[Highlight Detection] Find key moments
  ↓
[Report Generation] Create PDF summary
```

---

## 💰 Why It's Marketable

### 1. **Huge Market Size**

**TAM (Total Addressable Market):**
- 50M+ meeting rooms worldwide
- 4B+ meetings per day
- Average meeting waste: $15K per year per employee

**Companies buying:**
- All Fortune 500
- Any company with > 50 employees
- Every remote-first company

### 2. **Multiple Revenue Streams**

```
B2B SaaS:
├─ Per-user: $10-20/month
├─ Per-company: $500-5000/month
├─ Enterprise: $50K-100K+/year
└─ Revenue potential: $1M+ ARR possible

B2C:
├─ Freelancers: $50-100/month
├─ Students: $20-50/month
└─ Podcasters: $100-500/month

White-label:
├─ Zoom integration: Revenue share
├─ Microsoft Teams plugin
└─ Custom enterprise deployments
```

### 3. **Network Effects**

- Better with more usage (more training data)
- Creates data moat (you own meeting data)
- Multi-workspace expansion potential

### 4. **Competitive Advantages You Can Build**

vs **Otter.ai** (most popular):
- Better real-time performance
- Better action item extraction
- Custom integrations
- Lower cost

vs **Fireflies.io**:
- Open source option
- More control
- Better developer tools

vs **Gong.io**:
- Faster deployment
- Cheaper
- Privacy-first option

---

## 🛠️ Complete Tech Stack

### Frontend

```
React 18
├─ Real-time transcript display
├─ WebSocket connection
├─ Action item tracker
├─ Settings & recording controls
└─ Post-meeting summary dashboard

Libraries:
├─ Socket.io-client (WebSocket)
├─ React Router (navigation)
├─ Axios (API calls)
├─ Tailwind CSS (styling)
├─ Lucide Icons (UI icons)
├─ React Query (data fetching)
├─ Zustand (state management)
├─ Framer Motion (animations)
└─ PDF lib (export reports)

Browser APIs:
├─ MediaRecorder API (capture audio)
├─ WebSocket API (real-time updates)
└─ IndexedDB (offline caching)
```

### Backend

```
FastAPI 0.104+
├─ WebSocket endpoints
├─ REST API for management
├─ Request validation (Pydantic)
└─ CORS handling

Async Processing:
├─ Celery 5.3+ (background jobs)
├─ Redis 7.0+ (task queue + cache)
└─ APScheduler (scheduling)

LLM & Agents:
├─ LangChain 0.1.x
├─ OpenAI API (GPT-4)
├─ Anthropic Claude (optional)
└─ Prompt engineering

Databases:
├─ PostgreSQL 15 (structured data)
│  └─ Meetings, transcripts, action items, users
└─ Vector DB (Weaviate/Pinecone)
   └─ Semantic search for transcripts

File Storage:
├─ S3 / MinIO (audio files)
└─ Cloud storage (transcripts)
```

### ML/AI Stack

```
Speech Recognition:
├─ OpenAI Whisper (main)
│  └─ 99% accuracy, supports 99 languages
├─ Google Cloud Speech (fallback)
└─ Azure Speech Services (optional)

Speaker Diarization:
├─ PyAnnote 2.1 (speaker identification)
└─ Speechbrain (backup)

NLP Processing:
├─ spaCy (named entity recognition)
├─ Transformers (text classification)
├─ TextRank (keyword extraction)
└─ Sumy (summarization)

LLM Applications:
├─ Action item extraction (GPT-4)
├─ Summary generation (GPT-4)
├─ Key decision identification
└─ Sentiment analysis

Post-processing:
├─ NLTK (text processing)
├─ Pandas (data manipulation)
└─ NumPy (numerical operations)
```

### DevOps & Deployment

```
Development:
├─ Docker (containerization)
├─ Docker Compose (local services)
└─ Poetry (Python dependency management)

Backend Deployment:
├─ Railway / Render (FastAPI)
├─ AWS Lambda (serverless processing)
└─ GPU instance (for ML inference)

Frontend Deployment:
├─ Vercel (React app)
├─ Cloudflare (CDN)
└─ GitHub Pages (docs)

Monitoring:
├─ Sentry (error tracking)
├─ DataDog (performance monitoring)
├─ LogRocket (frontend logging)
└─ Custom metrics (inference latency)

CI/CD:
├─ GitHub Actions (automated tests)
├─ Docker Hub (image registry)
└─ Automated deployments
```

---

## 🏛️ Architecture Deep Dive

### System Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│              Client Browser (React)              │
│  ┌────────────────────────────────────────────┐  │
│  │ MediaRecorder API                          │  │
│  │ ├─ Capture audio from microphone           │  │
│  │ ├─ Capture audio from speakers (desktop)   │  │
│  │ └─ Stream to backend via WebSocket         │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Real-time UI                               │  │
│  │ ├─ Live transcript display                 │  │
│  │ ├─ Action items live update                │  │
│  │ ├─ Speaker identification                  │  │
│  │ └─ Progress indicator                      │  │
│  └────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────┘
                     │ WebSocket (audio chunks + control)
                     ▼
┌──────────────────────────────────────────────────┐
│         FastAPI Backend (Railway)                │
│ ┌────────────────────────────────────────────┐  │
│ │ WebSocket Handler                          │  │
│ │ ├─ Receive audio chunks (10-20s)           │  │
│ │ ├─ Buffer & queue for processing           │  │
│ │ ├─ Send confirmations back                 │  │
│ │ └─ Handle disconnections gracefully        │  │
│ └────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────┐  │
│ │ REST API Endpoints                         │  │
│ │ ├─ POST /meetings/start                    │  │
│ │ ├─ GET /meetings/{id}/transcript           │  │
│ │ ├─ GET /meetings/{id}/summary              │  │
│ │ ├─ POST /meetings/{id}/export              │  │
│ │ └─ GET /meetings/{id}/action-items         │  │
│ └────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────┘
                 │
    ┌────────────┼────────────┬──────────────┐
    │            │            │              │
    ▼            ▼            ▼              ▼
┌────────┐  ┌──────────┐ ┌─────────┐  ┌──────────┐
│ Celery │  │ PostgreSQL
│ Tasks  │  │ Database  │ │ Redis   │  │ S3/MinIO │
│ Queue  │  │           │ │ Cache   │  │ Storage  │
└────────┘  └──────────┘ └─────────┘  └──────────┘
    │
    └─────────────────────────────┐
                                  ▼
                    ┌──────────────────────────┐
                    │ Background Job Workers   │
                    │ (Celery + GPU instance)  │
                    │ ┌──────────────────────┐ │
                    │ │ Whisper Worker       │ │
                    │ │ - Transcribe audio   │ │
                    │ │ - 99% accuracy       │ │
                    │ │ - Optimized for speed│ │
                    │ └──────────────────────┘ │
                    │ ┌──────────────────────┐ │
                    │ │ Diarization Worker   │ │
                    │ │ - Identify speakers  │ │
                    │ │ - Track speaker turns│ │
                    │ │ - Match voices       │ │
                    │ └──────────────────────┘ │
                    │ ┌──────────────────────┐ │
                    │ │ Analysis Worker      │ │
                    │ │ - Extract entities   │ │
                    │ │ - Action items       │ │
                    │ │ - Key decisions      │ │
                    │ └──────────────────────┘ │
                    │ ┌──────────────────────┐ │
                    │ │ LLM Worker           │ │
                    │ │ - Summarization      │ │
                    │ │ - Text generation    │ │
                    │ │ - Reasoning          │ │
                    │ └──────────────────────┘ │
                    └──────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
    ┌────────┐         ┌────────┐       ┌──────────┐
    │ OpenAI │         │Anthropic       │ Hugging  │
    │ GPT-4  │         │ Claude         │ Face     │
    │ API    │         │                │ Models   │
    └────────┘         └────────┘       └──────────┘
```

### Data Flow: Real-Time Meeting Processing

```
REAL-TIME (WebSocket):

T=0s: User starts recording
  └─ Browser: Start MediaRecorder
  └─ Send: metadata, meeting_id

T=10s: First audio chunk (10 seconds of audio)
  └─ Browser: Send audio blob via WebSocket
  └─ Backend: Queue to Celery
  └─ Celery Worker 1: Transcribe chunk
  └─ Backend: Send back to frontend
  └─ Frontend: Display partial transcript
  └─ Backend: Stream to DB

T=20s: Second audio chunk
  └─ Repeat process (overlapping)
  └─ Diarization starts (who's speaking)
  └─ Real-time entity extraction

T=30s: Enough context for NLP
  └─ Extract action items from context
  └─ Send to frontend
  └─ Frontend: Display action items

CONTINUOUS:
  └─ Every 30 seconds: Re-analyze for entities
  └─ Every 60 seconds: Update summary preview
  └─ Real-time sentiment tracking
  └─ Live speaker identification

POST-MEETING (Batch):

After meeting ends:
  ├─ Consolidate transcript
  ├─ Final diarization
  ├─ Extract full action items
  ├─ Generate 2-3 min summary
  ├─ Find key moments (clips)
  ├─ Create meeting report
  └─ Store in database
```

### Data Model

```python
# Meeting
├─ meeting_id (UUID)
├─ title (str)
├─ start_time (datetime)
├─ end_time (datetime)
├─ duration_minutes (int)
├─ participants (list[User])
├─ status (recording, processing, completed)
├─ audio_file_path (str - S3 URL)
├─ transcript (Transcript)
├─ action_items (list[ActionItem])
├─ summary (str)
├─ key_moments (list[KeyMoment])
└─ metadata (dict)

# Transcript
├─ transcript_id (UUID)
├─ meeting_id (UUID)
├─ segments (list[Segment])
└─ full_text (str)

# Segment (10-15 seconds of speech)
├─ segment_id (UUID)
├─ timestamp (float) - seconds
├─ speaker (Speaker)
├─ text (str)
├─ confidence (float) - 0.0-1.0
├─ entities (list[Entity]) - NER results
├─ sentiment (str) - positive/negative/neutral
└─ audio_url (str) - clip for playback

# Speaker
├─ speaker_id (UUID)
├─ meeting_id (UUID)
├─ display_name (str)
├─ email (str - optional)
├─ voice_embedding (list[float]) - for diarization
├─ total_speaking_time (float)
└─ segments_count (int)

# ActionItem
├─ action_item_id (UUID)
├─ meeting_id (UUID)
├─ title (str) - "Send quarterly report"
├─ owner (Speaker)
├─ due_date (date)
├─ created_at (datetime)
├─ completed_at (datetime - nullable)
├─ segment_timestamp (float) - where it was mentioned
└─ confidence (float) - 0.0-1.0

# KeyMoment
├─ key_moment_id (UUID)
├─ meeting_id (UUID)
├─ type (enum) - decision, problem, solution, action
├─ timestamp (float)
├─ title (str)
├─ description (str)
├─ audio_clip_url (str)
└─ relevance_score (float)
```

---

## 📅 Week-by-Week Roadmap

### Week 1: Foundation & Recording

**Goal:** User can record and upload audio

#### Day 1-2: Project Setup
```bash
# Backend
git init meeting-assistant
cd meeting-assistant
mkdir -p backend frontend

# Backend setup
cd backend
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlalchemy psycopg2-binary pydantic python-dotenv
pip install celery redis
pip install openai whisper

# Frontend setup
cd frontend
npm create vite@latest . -- --template react
npm install axios socket.io-client zustand tailwindcss postcss autoprefixer
```

#### Day 3-4: Database Setup
```python
# backend/app/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

DATABASE_URL = "postgresql://user:password@localhost/meeting_assistant"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# backend/app/models.py
from sqlalchemy import Column, String, DateTime, Float, JSON, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime
import uuid

class Meeting(Base):
    __tablename__ = "meetings"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String)
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    duration_minutes = Column(Float, nullable=True)
    status = Column(String, default="recording")  # recording, processing, completed
    audio_file_path = Column(String, nullable=True)
    transcript_text = Column(String, nullable=True)
    summary = Column(String, nullable=True)
    metadata = Column(JSON, default={})
    
    # Relationships
    segments = relationship("Segment", back_populates="meeting")
    action_items = relationship("ActionItem", back_populates="meeting")
    speakers = relationship("Speaker", back_populates="meeting")

class Segment(Base):
    __tablename__ = "segments"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String, ForeignKey("meetings.id"))
    speaker_id = Column(String, ForeignKey("speakers.id"), nullable=True)
    timestamp = Column(Float)  # seconds
    text = Column(String)
    confidence = Column(Float)
    sentiment = Column(String, nullable=True)
    
    meeting = relationship("Meeting", back_populates="segments")
    speaker = relationship("Speaker")

class ActionItem(Base):
    __tablename__ = "action_items"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String, ForeignKey("meetings.id"))
    title = Column(String)
    owner = Column(String, nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    segment_timestamp = Column(Float, nullable=True)
    confidence = Column(Float)
    
    meeting = relationship("Meeting", back_populates="action_items")

class Speaker(Base):
    __tablename__ = "speakers"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String, ForeignKey("meetings.id"))
    display_name = Column(String)
    email = Column(String, nullable=True)
    total_speaking_time = Column(Float, default=0)
    
    meeting = relationship("Meeting", back_populates="speakers")
```

#### Day 5: React Audio Recorder
```jsx
// frontend/src/components/AudioRecorder.jsx
import { useState, useRef } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';

export function AudioRecorder({ onRecordingComplete }) {
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadAudio(audioBlob);
        audioChunksRef.current = [];
      };
      
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Please allow microphone access');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setIsProcessing(true);
  };

  const uploadAudio = async (audioBlob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob);
    formData.append('title', meetingTitle || 'Untitled Meeting');

    try {
      const response = await fetch('/api/meetings', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      onRecordingComplete(data.meeting_id);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload audio');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg">
      <input
        type="text"
        value={meetingTitle}
        onChange={(e) => setMeetingTitle(e.target.value)}
        placeholder="Meeting title (optional)"
        className="w-full mb-4 p-2 border rounded"
      />
      
      {!isRecording && !isProcessing && (
        <button
          onClick={startRecording}
          className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600"
        >
          <Mic size={20} />
          Start Recording
        </button>
      )}
      
      {isRecording && (
        <button
          onClick={stopRecording}
          className="flex items-center gap-2 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          <Square size={20} />
          Stop Recording
        </button>
      )}
      
      {isProcessing && (
        <div className="flex items-center gap-2 text-blue-600">
          <Loader2 className="animate-spin" />
          Processing audio...
        </div>
      )}
    </div>
  );
}
```

#### Day 6-7: API Endpoints
```python
# backend/app/main.py
from fastapi import FastAPI, UploadFile, File, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from app.database import SessionLocal, engine, Base
from app.models import Meeting, Segment
import uuid
from datetime import datetime

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Meeting Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/meetings")
async def create_meeting(audio: UploadFile = File(...), title: str = "Untitled"):
    """Start a new meeting and upload audio"""
    
    # Save audio file
    meeting_id = str(uuid.uuid4())
    audio_path = f"/tmp/{meeting_id}.webm"
    
    with open(audio_path, "wb") as f:
        f.write(await audio.read())
    
    # Create meeting in DB
    db = SessionLocal()
    meeting = Meeting(
        id=meeting_id,
        title=title,
        audio_file_path=audio_path,
        status="processing"
    )
    db.add(meeting)
    db.commit()
    
    # Queue transcription job
    from app.tasks import transcribe_audio_task
    transcribe_audio_task.delay(meeting_id, audio_path)
    
    return {
        "meeting_id": meeting_id,
        "status": "processing",
        "message": "Audio received, processing started"
    }

@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    """Get meeting details"""
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        return {"error": "Meeting not found"}, 404
    
    return {
        "id": meeting.id,
        "title": meeting.title,
        "status": meeting.status,
        "duration_minutes": meeting.duration_minutes,
        "created_at": meeting.start_time.isoformat()
    }

@app.get("/api/meetings/{meeting_id}/transcript")
async def get_transcript(meeting_id: str):
    """Get transcript segments"""
    db = SessionLocal()
    segments = db.query(Segment).filter(
        Segment.meeting_id == meeting_id
    ).order_by(Segment.timestamp).all()
    
    return {
        "segments": [
            {
                "timestamp": s.timestamp,
                "speaker": s.speaker.display_name if s.speaker else "Unknown",
                "text": s.text,
                "confidence": s.confidence
            }
            for s in segments
        ]
    }

@app.websocket("/ws/meetings/{meeting_id}/live")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str):
    """WebSocket for real-time transcript updates"""
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "transcript_update":
                # Broadcast to other clients
                # For now, just acknowledge
                await websocket.send_json({"status": "received"})
    
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()
```

**Deliverable:** Users can record, upload, and see processing status

---

### Week 2: Transcription & Speech Recognition

**Goal:** Convert audio to text with Whisper

#### Day 8-9: Whisper Integration
```python
# backend/app/tasks.py
from celery import Celery
from celery.schedules import crontab
import whisper
from app.database import SessionLocal
from app.models import Meeting, Segment, Speaker
import os

celery_app = Celery(
    'meeting_assistant',
    broker='redis://localhost:6379/0',
    backend='redis://localhost:6379/0'
)

whisper_model = whisper.load_model("base")  # 140MB, fast enough for MVP

@celery_app.task(name='transcribe_audio')
def transcribe_audio_task(meeting_id: str, audio_path: str):
    """Transcribe audio file using Whisper"""
    
    try:
        # Transcribe with Whisper
        result = whisper_model.transcribe(
            audio_path,
            language="en",
            verbose=False,
            temperature=0,  # More stable
            fp16=torch.cuda.is_available()  # Use GPU if available
        )
        
        db = SessionLocal()
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
        
        # Store full transcript
        full_text = result["text"]
        meeting.transcript_text = full_text
        
        # Create segments from result
        for segment in result["segments"]:
            db_segment = Segment(
                meeting_id=meeting_id,
                timestamp=segment["start"],
                text=segment["text"],
                confidence=segment.get("confidence", 1.0)
            )
            db.add(db_segment)
        
        meeting.status = "processing_analysis"
        db.commit()
        
        # Queue next task: diarization
        diarize_speakers_task.delay(meeting_id, audio_path)
        
        print(f"✓ Transcribed {meeting_id}")
        
    except Exception as e:
        print(f"✗ Transcription failed: {e}")
        db.rollback()

@celery_app.task(name='diarize_speakers')
def diarize_speakers_task(meeting_id: str, audio_path: str):
    """Identify speakers in audio"""
    
    from pyannote.audio import Pipeline
    import torch
    
    try:
        # Initialize diarization pipeline
        diarization = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.0",
            use_auth_token=os.getenv("HUGGINGFACE_TOKEN")
        ).to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
        
        # Run diarization
        diarization_result = diarization(audio_path)
        
        db = SessionLocal()
        
        # Extract speaker info and update segments
        speaker_map = {}
        speaker_count = 1
        
        for turn, _, speaker_id in diarization_result.itertracks(yield_label=True):
            if speaker_id not in speaker_map:
                speaker = Speaker(
                    meeting_id=meeting_id,
                    display_name=f"Speaker {speaker_count}",
                    total_speaking_time=0
                )
                db.add(speaker)
                db.flush()
                speaker_map[speaker_id] = speaker.id
                speaker_count += 1
            
            # Update segments with speaker info
            # (Find segment that overlaps with this turn)
        
        db.commit()
        
        # Queue analysis task
        extract_entities_task.delay(meeting_id)
        
        print(f"✓ Diarized {meeting_id}")
        
    except Exception as e:
        print(f"✗ Diarization failed: {e}")
```

#### Day 10-11: Real-time WebSocket Streaming
```python
# backend/app/main.py - Add streaming endpoint

import asyncio
import json

@app.websocket("/ws/meetings/{meeting_id}/transcribe")
async def transcribe_realtime(websocket: WebSocket, meeting_id: str):
    """Real-time transcription via WebSocket"""
    await websocket.accept()
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        await websocket.close(code=4004, reason="Meeting not found")
        return
    
    audio_buffer = b""
    CHUNK_SIZE = 16000 * 2 * 10  # 10 seconds of audio (16kHz, 16-bit)
    
    try:
        while True:
            # Receive audio chunk from client
            data = await websocket.receive_bytes()
            audio_buffer += data
            
            # When we have enough audio, transcribe
            if len(audio_buffer) >= CHUNK_SIZE:
                # Get first CHUNK_SIZE bytes
                chunk_to_process = audio_buffer[:CHUNK_SIZE]
                audio_buffer = audio_buffer[CHUNK_SIZE:]
                
                # Transcribe in background
                result = whisper_model.transcribe(
                    chunk_to_process,
                    language="en"
                )
                
                # Send back to client
                await websocket.send_json({
                    "type": "transcript",
                    "text": result["text"],
                    "timestamp": len(meeting.segments),
                    "confidence": result.get("confidence", 0.95)
                })
                
                # Save segment
                segment = Segment(
                    meeting_id=meeting_id,
                    timestamp=float(len(meeting.segments)),
                    text=result["text"],
                    confidence=result.get("confidence", 0.95)
                )
                db.add(segment)
                db.commit()
    
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close(code=1011, reason=str(e))

# Frontend WebSocket client
// frontend/src/hooks/useRealTimeTranscript.js
import { useEffect, useRef, useState } from 'react';

export function useRealTimeTranscript(meetingId) {
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [transcript, setTranscript] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Connect WebSocket
    wsRef.current = new WebSocket(
      `ws://localhost:8000/ws/meetings/${meetingId}/transcribe`
    );

    wsRef.current.onopen = () => setIsConnected(true);
    wsRef.current.onclose = () => setIsConnected(false);

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'transcript') {
        setTranscript(prev => [...prev, {
          text: data.text,
          timestamp: data.timestamp,
          confidence: data.confidence
        }]);
      }
    };

    return () => {
      wsRef.current?.close();
    };
  }, [meetingId]);

  const startStreaming = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 128000
    });

    const sendAudioChunk = () => {
      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      });
    };

    // Send every 10 seconds
    setInterval(() => {
      mediaRecorder.requestData();
    }, 10000);

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;

    return () => {
      mediaRecorder.stop();
      stream.getTracks().forEach(t => t.stop());
    };
  };

  return {
    transcript,
    isConnected,
    startStreaming
  };
}
```

**Deliverable:** Real-time transcription with Whisper + WebSocket

---

### Week 3: Speaker Identification & Entity Extraction

**Goal:** Know who's speaking and extract action items

#### Day 15-16: Entity Extraction
```python
# backend/app/services/nlp.py
from spacy import load
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
import re

nlp = load("en_core_web_sm")
llm = OpenAI(temperature=0)

def extract_action_items(text: str) -> list:
    """Extract action items from text using LLM"""
    
    prompt = PromptTemplate(
        input_variables=["text"],
        template="""Extract action items from this meeting transcript. 
An action item is a task someone needs to do.
Format as JSON: [{{"task": "...", "owner": "...", "deadline": "..."}}]

Transcript:
{text}

Action items (JSON only):"""
    )
    
    chain = LLMChain(llm=llm, prompt=prompt)
    result = chain.run(text=text)
    
    import json
    try:
        return json.loads(result)
    except:
        return []

def extract_decisions(text: str) -> list:
    """Extract key decisions"""
    
    prompt = PromptTemplate(
        input_variables=["text"],
        template="""Extract key decisions made in this meeting.
Format as JSON: [{{"decision": "...", "rationale": "..."}}]

Transcript:
{text}

Decisions (JSON only):"""
    )
    
    chain = LLMChain(llm=llm, prompt=prompt)
    result = chain.run(text=text)
    
    import json
    try:
        return json.loads(result)
    except:
        return []

def extract_entities(text: str) -> dict:
    """Extract NER entities"""
    
    doc = nlp(text)
    
    entities = {
        "PERSON": [],
        "ORG": [],
        "GPE": [],  # Location
        "DATE": [],
        "MONEY": []
    }
    
    for ent in doc.ents:
        if ent.label_ in entities:
            entities[ent.label_].append({
                "text": ent.text,
                "label": ent.label_
            })
    
    return entities

# backend/app/tasks.py - Add extraction task

@celery_app.task(name='extract_insights')
def extract_insights_task(meeting_id: str):
    """Extract entities, action items, decisions"""
    
    from app.services.nlp import (
        extract_action_items,
        extract_decisions,
        extract_entities
    )
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting.transcript_text:
        return
    
    # Extract action items
    action_items = extract_action_items(meeting.transcript_text)
    for item in action_items:
        db_item = ActionItem(
            meeting_id=meeting_id,
            title=item.get("task", ""),
            owner=item.get("owner"),
            confidence=0.85
        )
        db.add(db_item)
    
    # Extract entities
    entities = extract_entities(meeting.transcript_text)
    # Store metadata
    meeting.metadata = {
        "extracted_entities": entities,
        "action_items_count": len(action_items)
    }
    
    db.commit()
    print(f"✓ Extracted insights for {meeting_id}")
```

#### Day 17-18: API Endpoints for Analysis
```python
@app.get("/api/meetings/{meeting_id}/action-items")
async def get_action_items(meeting_id: str):
    """Get extracted action items"""
    db = SessionLocal()
    items = db.query(ActionItem).filter(
        ActionItem.meeting_id == meeting_id
    ).all()
    
    return {
        "action_items": [
            {
                "id": item.id,
                "title": item.title,
                "owner": item.owner,
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "completed": item.completed_at is not None,
                "confidence": item.confidence
            }
            for item in items
        ]
    }

@app.get("/api/meetings/{meeting_id}/summary")
async def get_summary(meeting_id: str):
    """Get meeting summary"""
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting.summary and meeting.transcript_text:
        # Generate summary
        from langchain.llms import OpenAI
        from langchain.chains.summarize import load_summarize_chain
        
        llm = OpenAI()
        chain = load_summarize_chain(llm, chain_type="map_reduce")
        
        # This is simplified - use real document splitting in prod
        from langchain.schema import Document
        docs = [Document(page_content=meeting.transcript_text)]
        summary = chain.run(docs)
        
        meeting.summary = summary
        db.commit()
    
    return {
        "meeting_id": meeting_id,
        "summary": meeting.summary
    }
```

**Deliverable:** Extract entities, action items, and generate summaries

---

### Week 4: Agentic Reasoning & Advanced Features

**Goal:** Build intelligent agent for complex reasoning

#### Day 19-20: LangChain Agent
```python
# backend/app/services/agent.py
from langchain.agents import initialize_agent, AgentType, tool
from langchain.llms import OpenAI
from langchain.tools import Tool
from app.models import Meeting, ActionItem, Segment
from app.database import SessionLocal

llm = OpenAI(temperature=0.2)

@tool
def analyze_sentiment(text: str) -> str:
    """Analyze sentiment of text"""
    from transformers import pipeline
    classifier = pipeline("sentiment-analysis")
    result = classifier(text[:512])  # Truncate for safety
    return result[0]['label']

@tool
def find_action_item_owners(meeting_transcript: str) -> list:
    """Identify who owns which action items"""
    from langchain.prompts import PromptTemplate
    
    prompt = PromptTemplate(
        input_variables=["transcript"],
        template="""Analyze this meeting to find action items and their owners.
Extract: task, owner, deadline (if mentioned).

Transcript:
{transcript}

For each action item, provide the owner's name.
Format as JSON."""
    )
    
    chain = prompt | llm
    result = chain.invoke({"transcript": meeting_transcript})
    return result

@tool
def identify_decisions(meeting_transcript: str) -> list:
    """Identify key decisions made"""
    from langchain.prompts import PromptTemplate
    
    prompt = PromptTemplate(
        input_variables=["transcript"],
        template="""What are the key decisions made in this meeting?
List each decision and the rationale behind it.

Transcript:
{transcript}

Decisions:"""
    )
    
    chain = prompt | llm
    return chain.invoke({"transcript": meeting_transcript})

@tool
def assess_meeting_productivity(meeting_data: dict) -> dict:
    """Assess how productive the meeting was"""
    
    criteria = {
        "has_action_items": len(meeting_data.get("action_items", [])) > 0,
        "has_clear_outcomes": len(meeting_data.get("decisions", [])) > 0,
        "meeting_duration": meeting_data.get("duration_minutes", 0),
        "participant_count": meeting_data.get("participant_count", 0),
    }
    
    productivity_score = (
        (20 if criteria["has_action_items"] else 0) +
        (20 if criteria["has_clear_outcomes"] else 0) +
        (10 if 30 <= criteria["meeting_duration"] <= 60 else 0) +
        (10 if criteria["participant_count"] <= 8 else 5) +
        40  # Base score
    )
    
    return {
        "productivity_score": min(100, productivity_score),
        "assessment": criteria
    }

# Create agent
tools = [
    Tool(
        name="Analyze Sentiment",
        func=analyze_sentiment,
        description="Analyze the sentiment of meeting transcript"
    ),
    Tool(
        name="Find Action Items",
        func=find_action_item_owners,
        description="Find action items and their owners from transcript"
    ),
    Tool(
        name="Identify Decisions",
        func=identify_decisions,
        description="Identify key decisions from meeting"
    ),
    Tool(
        name="Assess Productivity",
        func=assess_meeting_productivity,
        description="Assess meeting productivity"
    ),
]

meeting_agent = initialize_agent(
    tools,
    llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True
)

def analyze_meeting_comprehensive(meeting_id: str) -> dict:
    """Comprehensive meeting analysis using agent"""
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting.transcript_text:
        return {"error": "No transcript available"}
    
    # Prepare meeting data
    meeting_data = {
        "meeting_id": meeting.id,
        "title": meeting.title,
        "transcript": meeting.transcript_text,
        "duration_minutes": meeting.duration_minutes,
        "action_items": db.query(ActionItem).filter(
            ActionItem.meeting_id == meeting_id
        ).count(),
        "participant_count": len(meeting.speakers)
    }
    
    # Run agent
    result = meeting_agent.run(f"""
        Analyze this meeting comprehensively:
        
        Title: {meeting_data['title']}
        Duration: {meeting_data['duration_minutes']} minutes
        
        Transcript:
        {meeting_data['transcript']}
        
        Please:
        1. Assess sentiment of the meeting
        2. Find and list action items
        3. Identify key decisions
        4. Evaluate overall productivity
        5. Provide recommendations for next meeting
        
        Format your response as structured JSON.
    """)
    
    return {
        "meeting_id": meeting_id,
        "analysis": result,
        "timestamp": datetime.utcnow().isoformat()
    }
```

#### Day 21: Real-time Agent Processing
```python
# Update WebSocket to use agent for live insights

@app.websocket("/ws/meetings/{meeting_id}/insights")
async def insights_websocket(websocket: WebSocket, meeting_id: str):
    """Real-time insights via agent"""
    await websocket.accept()
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    try:
        while True:
            # Every 60 seconds, re-analyze
            await asyncio.sleep(60)
            
            if meeting.transcript_text:
                # Quick analysis using agent
                result = meeting_agent.run(f"""
                    Quick analysis of recent transcript:
                    {meeting.transcript_text[-2000:]}  # Last 2000 chars
                    
                    Identify:
                    - Any new action items
                    - Key points discussed
                    - Who's driving the meeting
                """)
                
                await websocket.send_json({
                    "type": "insights_update",
                    "analysis": result,
                    "timestamp": datetime.utcnow().isoformat()
                })
    
    except Exception as e:
        print(f"Insights WebSocket error: {e}")
    finally:
        await websocket.close()
```

**Deliverable:** Intelligent agent-driven meeting analysis

---

### Week 5-6: Post-Meeting Dashboard & Deployment

**Goal:** Beautiful summary dashboard and production deployment

#### Day 22-23: Summary Dashboard
```jsx
// frontend/src/pages/MeetingSummary.jsx
import { useParams, useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Download, Share2, Edit2 } from 'lucide-react';

export default function MeetingSummary() {
  const { meetingId } = useParams();
  const [meeting, setMeeting] = useState(null);
  const [summary, setSummary] = useState(null);
  const [actionItems, setActionItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMeetingData();
  }, [meetingId]);

  const fetchMeetingData = async () => {
    try {
      // Fetch meeting details
      const meetRes = await fetch(`/api/meetings/${meetingId}`);
      const meetData = await meetRes.json();
      setMeeting(meetData);

      // Fetch summary
      const summRes = await fetch(`/api/meetings/${meetingId}/summary`);
      const summData = await summRes.json();
      setSummary(summData.summary);

      // Fetch action items
      const itemsRes = await fetch(`/api/meetings/${meetingId}/action-items`);
      const itemsData = await itemsRes.json();
      setActionItems(itemsData.action_items);

    } catch (err) {
      console.error('Failed to fetch meeting data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{meeting?.title}</h1>
          <p className="text-gray-600">
            {new Date(meeting?.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button>
            <Download size={18} className="mr-2" />
            Export PDF
          </Button>
          <Button variant="outline">
            <Share2 size={18} className="mr-2" />
            Share
          </Button>
        </div>
      </div>

      {/* Summary Card */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h2 className="text-xl font-semibold mb-3">Meeting Summary</h2>
        <p className="text-gray-700 leading-relaxed">{summary}</p>
      </Card>

      {/* Action Items */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Action Items ({actionItems.length})</h2>
        <div className="space-y-3">
          {actionItems.map((item) => (
            <div
              key={item.id}
              className="p-4 border rounded-lg flex items-start gap-3 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={item.completed}
                className="mt-1 cursor-pointer"
              />
              <div className="flex-1">
                <h3 className="font-medium">{item.title}</h3>
                {item.owner && <p className="text-sm text-gray-600">Owner: {item.owner}</p>}
                {item.due_date && <p className="text-sm text-gray-600">Due: {item.due_date}</p>}
              </div>
              <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                {(item.confidence * 100).toFixed(0)}% confident
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Transcript */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Full Transcript</h2>
        <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
          {/* Transcript segments */}
        </div>
      </Card>
    </div>
  );
}
```

#### Day 24-25: PDF Export
```python
# backend/app/services/pdf_generator.py
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from datetime import datetime

def generate_meeting_pdf(meeting, summary, action_items):
    """Generate PDF report of meeting"""
    
    filename = f"/tmp/meeting_{meeting.id}.pdf"
    doc = SimpleDocTemplate(filename, pagesize=letter)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1e3a8a'),
        spaceAfter=30,
    )
    
    # Build PDF elements
    elements = []
    
    # Title
    elements.append(Paragraph(meeting.title, title_style))
    elements.append(Spacer(1, 0.3*inch))
    
    # Meeting info
    info_data = [
        ['Date:', datetime.fromisoformat(meeting.created_at).strftime('%B %d, %Y')],
        ['Duration:', f'{meeting.duration_minutes} minutes'],
        ['Status:', meeting.status.title()],
    ]
    
    info_table = Table(info_data, colWidths=[1.5*inch, 4*inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.lightgrey),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
    ]))
    
    elements.append(info_table)
    elements.append(Spacer(1, 0.3*inch))
    
    # Summary
    elements.append(Paragraph('Summary', styles['Heading2']))
    elements.append(Spacer(1, 0.15*inch))
    elements.append(Paragraph(summary, styles['BodyText']))
    elements.append(Spacer(1, 0.3*inch))
    
    # Action Items
    elements.append(Paragraph(f'Action Items ({len(action_items)})', styles['Heading2']))
    elements.append(Spacer(1, 0.15*inch))
    
    item_data = [['Task', 'Owner', 'Due Date', 'Status']]
    for item in action_items:
        item_data.append([
            item['title'],
            item.get('owner', '-'),
            item.get('due_date', '-'),
            '✓' if item.get('completed') else '○'
        ])
    
    items_table = Table(item_data, colWidths=[2.5*inch, 1.5*inch, 1.5*inch, 0.5*inch])
    items_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.beige),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
    ]))
    
    elements.append(items_table)
    
    # Build PDF
    doc.build(elements)
    
    return filename

# API endpoint
@app.post("/api/meetings/{meeting_id}/export/pdf")
async def export_pdf(meeting_id: str):
    """Export meeting as PDF"""
    from fastapi.responses import FileResponse
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    action_items = db.query(ActionItem).filter(
        ActionItem.meeting_id == meeting_id
    ).all()
    
    pdf_path = generate_meeting_pdf(
        meeting,
        meeting.summary or "No summary available",
        [{"title": ai.title, "owner": ai.owner, "completed": ai.completed_at is not None}
         for ai in action_items]
    )
    
    return FileResponse(
        pdf_path,
        filename=f"{meeting.title}.pdf",
        media_type="application/pdf"
    )
```

#### Day 26-27: Deployment
```bash
# Docker setup
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY ./backend ./app

# Expose port
EXPOSE 8000

# Run FastAPI
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
      POSTGRES_DB: meeting_assistant
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://admin:password@postgres:5432/meeting_assistant
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis
    command: uvicorn app.main:app --host 0.0.0.0 --reload

  celery:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://admin:password@postgres:5432/meeting_assistant
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis
    command: celery -A app.tasks.celery_app worker --loglevel=info

volumes:
  postgres_data:

# Deploy to Railway
# 1. Create Railway account (railway.app)
# 2. Connect GitHub repo
# 3. Create PostgreSQL plugin
# 4. Create Redis plugin
# 5. Deploy automatically

# .railway/docker-entrypoint.sh
#!/bin/bash
python -m alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port $PORT

# Frontend to Vercel
# 1. Push frontend to GitHub
# 2. Import project to Vercel
# 3. Set environment variables:
#    VITE_API_URL=https://your-backend-url.railway.app
# 4. Deploy automatically on push
```

**Deliverable:** Production-ready meeting assistant deployed

---

## 💻 Core Code Implementation

### Full FastAPI Backend Structure

```python
# backend/app/main.py - Complete example
from fastapi import FastAPI, UploadFile, File, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import os
from datetime import datetime
import uuid
import json

from app.database import SessionLocal, engine, Base
from app.models import Meeting, Segment, ActionItem, Speaker
from app.tasks import (
    transcribe_audio_task,
    diarize_speakers_task,
    extract_insights_task
)
from app.services.agent import analyze_meeting_comprehensive
from app.services.pdf_generator import generate_meeting_pdf

# Create tables
Base.metadata.create_all(bind=engine)

# Initialize FastAPI
app = FastAPI(
    title="Meeting Assistant API",
    description="AI-powered meeting transcription and analysis",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============= ENDPOINTS =============

@app.post("/api/meetings")
async def create_meeting(audio: UploadFile = File(...), title: str = "Untitled Meeting"):
    """Create a new meeting and start processing"""
    
    meeting_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    audio_path = f"/tmp/meetings/{meeting_id}_{timestamp}.webm"
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(audio_path), exist_ok=True)
    
    # Save audio
    with open(audio_path, "wb") as f:
        content = await audio.read()
        f.write(content)
    
    # Create meeting in database
    db = SessionLocal()
    meeting = Meeting(
        id=meeting_id,
        title=title,
        audio_file_path=audio_path,
        status="processing"
    )
    db.add(meeting)
    db.commit()
    
    # Queue transcription
    transcribe_audio_task.delay(meeting_id, audio_path)
    
    return JSONResponse({
        "meeting_id": meeting_id,
        "status": "processing",
        "message": "Audio received, processing started",
        "estimated_completion": "5-10 minutes"
    })

@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    """Get meeting details"""
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        return JSONResponse({"error": "Meeting not found"}, status_code=404)
    
    return {
        "id": meeting.id,
        "title": meeting.title,
        "status": meeting.status,
        "duration_minutes": meeting.duration_minutes,
        "created_at": meeting.start_time.isoformat(),
        "summary": meeting.summary,
        "speaker_count": len(meeting.speakers),
        "action_item_count": len(meeting.action_items)
    }

@app.get("/api/meetings/{meeting_id}/transcript")
async def get_transcript(meeting_id: str, skip: int = 0, limit: int = 100):
    """Get transcript segments"""
    db = SessionLocal()
    
    segments = db.query(Segment).filter(
        Segment.meeting_id == meeting_id
    ).order_by(Segment.timestamp).offset(skip).limit(limit).all()
    
    return {
        "meeting_id": meeting_id,
        "segments": [
            {
                "id": s.id,
                "timestamp": s.timestamp,
                "speaker": s.speaker.display_name if s.speaker else "Unknown",
                "text": s.text,
                "confidence": s.confidence,
                "sentiment": s.sentiment
            }
            for s in segments
        ],
        "total_segments": db.query(Segment).filter(
            Segment.meeting_id == meeting_id
        ).count()
    }

@app.get("/api/meetings/{meeting_id}/summary")
async def get_summary(meeting_id: str):
    """Get meeting summary"""
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        return JSONResponse({"error": "Meeting not found"}, status_code=404)
    
    return {
        "meeting_id": meeting_id,
        "title": meeting.title,
        "summary": meeting.summary,
        "status": meeting.status
    }

@app.get("/api/meetings/{meeting_id}/action-items")
async def get_action_items(meeting_id: str):
    """Get extracted action items"""
    db = SessionLocal()
    items = db.query(ActionItem).filter(
        ActionItem.meeting_id == meeting_id
    ).all()
    
    return {
        "meeting_id": meeting_id,
        "action_items": [
            {
                "id": item.id,
                "title": item.title,
                "owner": item.owner,
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "completed": item.completed_at is not None,
                "confidence": item.confidence,
                "timestamp": item.segment_timestamp
            }
            for item in items
        ],
        "total_count": len(items)
    }

@app.post("/api/meetings/{meeting_id}/export/pdf")
async def export_pdf(meeting_id: str):
    """Export meeting as PDF"""
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        return JSONResponse({"error": "Meeting not found"}, status_code=404)
    
    action_items = db.query(ActionItem).filter(
        ActionItem.meeting_id == meeting_id
    ).all()
    
    pdf_path = generate_meeting_pdf(
        meeting,
        meeting.summary or "No summary available",
        [
            {
                "title": ai.title,
                "owner": ai.owner or "Unassigned",
                "due_date": ai.due_date.isoformat() if ai.due_date else "No date",
                "completed": ai.completed_at is not None
            }
            for ai in action_items
        ]
    )
    
    return FileResponse(
        pdf_path,
        filename=f"{meeting.title.replace(' ', '_')}.pdf",
        media_type="application/pdf"
    )

@app.websocket("/ws/meetings/{meeting_id}/live")
async def websocket_live_transcript(websocket: WebSocket, meeting_id: str):
    """Real-time transcript updates"""
    await websocket.accept()
    
    db = SessionLocal()
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    
    if not meeting:
        await websocket.close(code=4004, reason="Meeting not found")
        return
    
    try:
        last_segment_count = 0
        
        while True:
            # Every 2 seconds, check for new segments
            import asyncio
            await asyncio.sleep(2)
            
            segments = db.query(Segment).filter(
                Segment.meeting_id == meeting_id
            ).order_by(Segment.timestamp).all()
            
            if len(segments) > last_segment_count:
                new_segments = segments[last_segment_count:]
                
                await websocket.send_json({
                    "type": "transcript_update",
                    "new_segments": [
                        {
                            "speaker": s.speaker.display_name if s.speaker else "Unknown",
                            "text": s.text,
                            "timestamp": s.timestamp,
                            "confidence": s.confidence
                        }
                        for s in new_segments
                    ]
                })
                
                last_segment_count = len(segments)
    
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        await websocket.close()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 🚀 Deployment Strategy

### Option 1: Railway (Recommended for MVP)

```bash
# 1. Create account at railway.app
# 2. Install Railway CLI
npm i -g @railway/cli

# 3. Login
railway login

# 4. Create project
railway init

# 5. Add plugins
railway add --plugin postgres
railway add --plugin redis

# 6. Set environment variables
railway variables set OPENAI_API_KEY=sk-...

# 7. Deploy
git push origin main
# (Auto-deploys from Git)
```

### Option 2: AWS EC2 + RDS

```bash
# 1. Launch EC2 instance (Ubuntu 22.04)
# 2. Install Docker
sudo apt update && apt install docker.io

# 3. Setup RDS PostgreSQL
# 4. Push Docker image to ECR
# 5. Deploy with ECS or manually

aws ecr create-repository --repository-name meeting-assistant

docker build -t meeting-assistant:latest .
docker tag meeting-assistant:latest {account}.dkr.ecr.us-east-1.amazonaws.com/meeting-assistant:latest
docker push {account}.dkr.ecr.us-east-1.amazonaws.com/meeting-assistant:latest
```

### Frontend Deployment (Vercel)

```bash
cd frontend

# Connect to Vercel
vercel link

# Set environment variables
vercel env add VITE_API_URL

# Deploy
vercel --prod
```

---

## 💰 Monetization Ideas

### 1. B2B SaaS

```
Pricing Tiers:

Free:
├─ 5 meetings/month
├─ Basic transcription
└─ No action item tracking

Pro: $15/month
├─ Unlimited meetings
├─ Full transcription
├─ Action item tracking
├─ PDF export
└─ Email summaries

Business: $50/month
├─ Everything in Pro
├─ Team collaboration (5 users)
├─ API access
├─ Custom integrations
└─ Priority support

Enterprise: Custom pricing
├─ Everything in Business
├─ Unlimited users
├─ On-premise option
├─ Dedicated support
└─ SLA guarantee
```

### 2. Zoom/Teams Integration

```
Distribute as:
├─ Zoom App Marketplace (revenue share)
├─ Microsoft Teams App Source
└─ Slack integration

Revenue: $2-5 per user per month from marketplace
```

### 3. API-First Business

```
Developers pay:
├─ $0.10-0.50 per meeting transcribed
├─ $10-100/month for API tier
└─ Custom pricing for high volume
```

### 4. White-Label Solution

```
Agencies/Companies can:
├─ License the software
├─ Brand with their logo
├─ Offer to their customers
└─ Revenue share (30-50%)
```

---

## 🎯 Interview Talking Points

### Technical Depth

1. **Real-time Systems**
   - "Built WebSocket infrastructure handling concurrent meetings"
   - "Implemented streaming transcription with Whisper API"
   - "Optimized latency for sub-second transcript updates"

2. **Multi-Modal AI**
   - "Integrated speech-to-text, speaker diarization, NLP"
   - "Handled audio streaming, processing, and analysis"
   - "Used Whisper for 99% accuracy across 99 languages"

3. **Agentic Design**
   - "Built LangChain agent for complex meeting analysis"
   - "Agent decides: what to transcribe, how to analyze, when to escalate"
   - "Implemented multi-step reasoning for action item extraction"

4. **Production Architecture**
   - "Async processing with Celery for scalability"
   - "Redis caching for performance optimization"
   - "PostgreSQL with proper indexing for query speed"

### Business Impact

1. **Market Opportunity**
   - "TAM: $15B+ for meeting productivity tools"
   - "50M meeting rooms searching for AI solutions"
   - "Potential $100K+ ARR in first year"

2. **Competitive Advantage**
   - "Better real-time performance than Otter.ai"
   - "Open-source foundation, customizable"
   - "Privacy-first (on-premise option)"

3. **User Value**
   - "Saves 5-10 hours/week on meeting management"
   - "Increases action item completion by 35%"
   - "Enables better decision-making"

### Engineering Excellence

1. **Code Quality**
   - "Type hints throughout (Pydantic, FastAPI)"
   - "Comprehensive error handling"
   - "99.9% uptime through proper monitoring"

2. **Scalability**
   - "Handles 100+ concurrent meetings"
   - "Processes video to summary in < 15 minutes"
   - "Database optimized for millions of records"

3. **Deployment**
   - "CI/CD pipeline with GitHub Actions"
   - "Docker containerization for consistency"
   - "Multi-region deployment capability"

---

## 📊 Metrics to Track

```
User Metrics:
├─ Active users per month
├─ Meetings processed per day
├─ Average meeting duration
└─ User retention rate

Product Metrics:
├─ Transcription accuracy (% correct)
├─ Action item extraction confidence
├─ Summary quality (user ratings)
├─ Processing time (avg)
└─ Feature usage (which features used most)

Business Metrics:
├─ Churn rate
├─ Customer acquisition cost
├─ Lifetime value
├─ Revenue per user
└─ Net retention
```

---

## 🎓 Learning Resources

### Speech Processing
- Whisper API: https://platform.openai.com/docs/guides/speech-to-text
- PyAnnote: https://github.com/pyannote/pyannote-audio
- Hugging Face Audio: https://huggingface.co/tasks/automatic-speech-recognition

### Real-Time Systems
- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- Celery: https://docs.celeryproject.org/
- Async Python: https://realpython.com/async-io-python/

### NLP & Agents
- LangChain: https://python.langchain.com/
- spaCy: https://spacy.io/
- OpenAI API: https://platform.openai.com/docs

### Deployment
- Railway: https://railway.app/
- Docker: https://docs.docker.com/
- Vercel: https://vercel.com/docs

---

## ✅ Success Checklist

- [x] Week 1: Audio recording & upload working
- [x] Week 2: Real-time transcription with Whisper
- [x] Week 3: Speaker identification & entity extraction
- [x] Week 4: Agent-driven analysis
- [x] Week 5: Summary generation & dashboard
- [x] Week 6: PDF export & deployment
- [ ] Deploy to production (Railway + Vercel)
- [ ] Share on GitHub with detailed README
- [ ] Write blog post about building it
- [ ] Submit to product hunt
- [ ] Demo in interviews

---

## 🚀 Next Steps

1. **This week:** Setup project, install dependencies
2. **Next 2 weeks:** Build audio recording + Whisper integration
3. **Week 3-4:** Add speaker ID + action item extraction
4. **Week 5-6:** Polish UI + deploy
5. **Week 7:** Market & get feedback
6. **Ongoing:** Iterate based on feedback

---

**Start building! You've got this. 🎤🚀**

