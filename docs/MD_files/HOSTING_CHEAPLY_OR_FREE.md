# 🚀 Hosting Meetings Without Expensive Servers

**Complete guide to P2P, serverless, and free/cheap hosting options**

---

## 1️⃣ PEER-TO-PEER (P2P) - NO CENTRAL SERVER NEEDED

### What is P2P?
Videos/audio go directly between peers, not through your server. Your server only helps peers find each other (signaling).

### Best Free Options:

#### **A. PeerJS (RECOMMENDED FOR MVP)**
```
What: Free, open-source WebRTC abstraction
Cost: FREE
Hosting: Self-hosted or use free server
Setup: 5 minutes

// frontend/src/services/peerConnection.js
import Peer from 'peerjs';

export function createPeerConnection(meetingId) {
  const peer = new Peer({
    host: 'localhost', // Or your signaling server
    port: 9000,
    path: '/'
  });
  
  peer.on('open', (id) => {
    console.log(`Your peer ID: ${id}`);
    // Share this ID with others to join
  });
  
  // Receive call
  peer.on('call', (call) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        call.answer(stream);
        
        call.on('stream', (remoteStream) => {
          // Display remote video
          const video = document.createElement('video');
          video.srcObject = remoteStream;
          video.play();
          document.body.appendChild(video);
        });
      });
  });
  
  return peer;
}

// Make a call to another peer
export function makeCall(peer, peerId, localStream) {
  const call = peer.call(peerId, localStream);
  
  call.on('stream', (remoteStream) => {
    // Display remote video
  });
  
  return call;
}
```

**Pros:**
- ✅ Free
- ✅ No video server costs
- ✅ Low latency
- ✅ Better privacy

**Cons:**
- ❌ Scalability (max 5-10 people practical)
- ❌ Need signaling server (simple Node.js is enough)

---

#### **B. Livekit (CHEAPEST PAID OPTION)**
```
What: Self-hostable WebRTC server
Cost: FREE (self-hosted), $0.005/minute (cloud)
Setup: Docker in 5 minutes

// Docker compose
version: '3'
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
    environment:
      LIVEKIT_API_KEY: devkey
      LIVEKIT_API_SECRET: secret
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml

// Frontend
import { LiveKitRoom, useParticipants } from '@livekit/react';

export function MeetingRoom({ roomName, userName }) {
  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl="ws://your-server:7880"
      roomName={roomName}
    >
      <Participants />
    </LiveKitRoom>
  );
}
```

**Pros:**
- ✅ Free self-hosted
- ✅ Scales to 100+ people
- ✅ Official support
- ✅ Cloud option is super cheap

**Cons:**
- ❌ Requires server to run
- ❌ Uses bandwidth

**Cost Breakdown (if using cloud):**
```
5 participants, 30-min meeting:
= 5 people × 30 min = 150 participant-minutes
= 150 × $0.005 = $0.75 per meeting

100 meetings/month = $75/month
```

---

#### **C. Metered (TOTALLY FREE FOR HOBBY)**
```
What: Free TURN/STUN services
Cost: FREE (up to limits)
No self-hosting needed

// Just add these servers to config
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

// Use with PeerJS
const peer = new Peer({
  config: {
    iceServers: iceServers
  }
});
```

**Pros:**
- ✅ Completely free
- ✅ No setup needed
- ✅ Google's infrastructure

**Cons:**
- ❌ Requires both peers on same network/public IP
- ❌ Doesn't work well behind NAT

---

## 2️⃣ SELF-HOSTED SIGNALING SERVER (CHEAP)

### What You Need
```
1. Signaling server: $5-10/month (Lightsail, Digital Ocean, Heroku)
2. Database: Free tier (PostgreSQL)
3. Frontend: Free (Vercel, Netlify)

Total: ~$5-10/month
```

### Minimal Signaling Server
```python
# backend/signaling_server.py
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active connections
class ConnectionManager:
    def __init__(self):
        self.rooms = {}  # room_id -> {user_id -> websocket}
    
    async def connect(self, room_id: str, user_id: str, websocket: WebSocket):
        await websocket.accept()
        
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        
        self.rooms[room_id][user_id] = websocket
        
        # Notify others that new user joined
        await self.broadcast(room_id, {
            "type": "user_joined",
            "user_id": user_id,
            "users": list(self.rooms[room_id].keys())
        }, exclude=user_id)
    
    async def disconnect(self, room_id: str, user_id: str):
        if room_id in self.rooms:
            del self.rooms[room_id][user_id]
            
            # Notify others
            await self.broadcast(room_id, {
                "type": "user_left",
                "user_id": user_id
            })
    
    async def broadcast(self, room_id: str, message: dict, exclude: str = None):
        if room_id in self.rooms:
            for user_id, websocket in self.rooms[room_id].items():
                if exclude and user_id == exclude:
                    continue
                
                try:
                    await websocket.send_json(message)
                except:
                    pass
    
    async def send_to_user(self, room_id: str, user_id: str, message: dict):
        if room_id in self.rooms and user_id in self.rooms[room_id]:
            await self.rooms[room_id][user_id].send_json(message)

manager = ConnectionManager()

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await manager.connect(room_id, user_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # Relay SDP offers/answers between peers
            if data.get("type") in ["offer", "answer", "candidate"]:
                target_user = data.get("to")
                await manager.send_to_user(room_id, target_user, {
                    "type": data["type"],
                    "from": user_id,
                    "data": data.get("data")
                })
    
    except:
        pass
    finally:
        await manager.disconnect(room_id, user_id)

# This is it! Just 70 lines of code
```

**Deploy on:**
- Digital Ocean: $4/month
- AWS Lightsail: $3.50/month
- Heroku: Free tier (or $5/month)
- Railway: $5/month (simplest)

```bash
# Deploy to Railway in 2 minutes
railway login
railway init
git push origin main
# Done! Your signaling server is live
```

---

## 3️⃣ TOTALLY FREE OPTIONS

### **Option A: Free Tier Services**
```
Frontend: Vercel (FREE)
├─ Unlimited free tier
├─ Automatic deployments
└─ No credit card needed

Signaling: Railway/Render (FREE TIER)
├─ 500 hours/month free
├─ That's enough for ~16 concurrent users 24/7
└─ Zero payment info needed

Database: Supabase (FREE)
├─ PostgreSQL
├─ 500MB storage
└─ Enough for 10K+ messages

Total Cost: $0
```

### **Option B: Use Existing Free Meeting Services**
```
Don't build your own? Use:
- Jitsi (open-source, free)
- Big Blue Button (free)
- Nextcloud Talk (free)

Then add your AI assistant on top!

# Install Jitsi on free server
docker run --name jitsi -d \
  -p 80:80 -p 443:443 \
  jitsi/jitsi-meet
```

---

## 4️⃣ ARCHITECTURE RECOMMENDATIONS

### **For MVP (First 6 Weeks)**

```
Diagram:
┌─────────────────────────────────┐
│ Frontend (Vercel) - FREE        │
│ - React meeting UI              │
│ - PeerJS client                 │
└────────────┬────────────────────┘
             │
    ┌────────▼─────────┐
    │ Signaling Server │
    │ (Railway) - FREE │
    │ 70 lines code    │
    └────────┬─────────┘
             │
    ┌────────▼────────────┐
    │ Database            │
    │ (Supabase) - FREE   │
    │ Only stores metadata│
    └─────────────────────┘

P2P Connection (Direct, free):
User A ←──────────────→ User B
(Audio/Video bypass server)

Cost: $0/month
```

### **For Production (After MVP)**

```
Option 1: Stay Free (Limited)
├─ Frontend: Vercel ($0)
├─ Signaling: Railway free tier ($0)
├─ P2P: Direct connections ($0)
└─ Total: $0 (but max ~50 concurrent users)

Option 2: Scale Cheaply
├─ Frontend: Vercel ($0)
├─ Signaling: Railway paid ($10)
├─ WebRTC: Livekit self-hosted on same server ($0)
├─ Database: Supabase paid tier ($10)
└─ Total: $20/month (for unlimited users)

Option 3: Cloud Solution
├─ Frontend: Vercel ($0)
├─ WebRTC: Livekit Cloud ($0.005/min)
├─ Database: Supabase ($10)
└─ Total: $10 + usage (50 meetings = ~$50)
```

---

## 5️⃣ STEP-BY-STEP SETUP (COMPLETELY FREE)

### **Step 1: Create Frontend (Vercel)**
```bash
npm create vite@latest meeting-app -- --template react
cd meeting-app
npm install peerjs

# Commit to GitHub
git init
git add .
git commit -m "Initial commit"
git push -u origin main

# Deploy on Vercel (connect GitHub)
# Takes 2 minutes, automatic deploys
```

### **Step 2: Create Signaling Server (Railway)**
```bash
# Create Node.js signaling server
mkdir signaling-server
cd signaling-server
npm init -y

# Install deps
npm install fastapi uvicorn python-dotenv

# Create app.py (code from section 2️⃣ above)

# Deploy to Railway
# 1. railway init
# 2. railway up
# Done!
```

### **Step 3: Create Database (Supabase)**
```bash
# 1. Sign up at supabase.com (free)
# 2. Create project
# 3. Get connection string

# In your backend:
from supabase import create_client

supabase = create_client(
    "https://your-project.supabase.co",
    "your-api-key"
)

# Store meeting metadata
supabase.table('meetings').insert({
    'room_id': room_id,
    'created_at': datetime.now(),
    'participants': []
})
```

### **Step 4: Connect Everything**
```jsx
// frontend/src/App.jsx
import Peer from 'peerjs';
import { useEffect, useState } from 'react';
import axios from 'axios';

export default function MeetingRoom() {
  const [peer, setPeer] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const roomId = 'room-123';
  
  useEffect(() => {
    // Create peer connection
    const p = new Peer({
      host: 'your-railway-domain.railway.app',
      port: 443,
      secure: true,
      path: '/peer'
    });
    
    setPeer(p);
    
    // Get local stream
    navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    }).then(setLocalStream);
    
    // Connect to signaling server
    const ws = new WebSocket(
      `wss://your-railway-domain.railway.app/ws/${roomId}/user-123`
    );
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'user_joined') {
        // Make call to new user
        const call = peer.call(data.user_id, localStream);
        
        call.on('stream', (remoteStream) => {
          // Display remote video
        });
      }
    };
  }, []);
  
  return (
    <div>
      <video autoPlay muted></video>
      <div id="remote-videos"></div>
    </div>
  );
}
```

---

## 6️⃣ COMPARISON TABLE

```
Method              Cost      Setup    Scalability   P2P?
────────────────────────────────────────────────────────
PeerJS              FREE      5 min    ~5 people     YES
Livekit Free        FREE      15 min   ~50 people    NO
Livekit Cloud       $0.005/m  15 min   Unlimited     NO
Metered STUN        FREE      2 min    Depends       YES
DIY Signaling       $5-10     30 min   ~100 people   YES
Free Tiers          FREE      30 min   ~50 people    YES
Jitsi Free          FREE      30 min   ~50 people    NO
────────────────────────────────────────────────────────
```

---

## 7️⃣ MY RECOMMENDATION (BEST FOR YOU)

### **For MVP (Weeks 1-3):**
```
✅ Frontend: React on Vercel (FREE)
✅ WebRTC: PeerJS (FREE)
✅ Signaling: 70-line Flask server on Railway (FREE tier)
✅ Database: Supabase free (FREE)

Total: $0
Scalability: ~20-30 concurrent meetings
Setup time: 1-2 hours
```

### **After MVP (Week 4+):**
```
If users love it:
✅ Upgrade Railway to paid ($10)
✅ Move to Livekit self-hosted ($0 extra, same server)
✅ Upgrade Supabase ($10)

Total: $20/month
Scalability: Unlimited
```

### **If You Get Traction:**
```
Upgrade to:
✅ Livekit Cloud ($0.005/minute)
✅ AWS Auto-scaling
✅ Managed database

Cost: Scales with usage (~$100-500/month for 1000 meetings)
```

---

## 8️⃣ QUICK SETUP CHECKLIST

### **Day 1: Get It Running**
- [ ] Frontend repo → Vercel deploy (5 min)
- [ ] Signaling server → Railway deploy (5 min)
- [ ] Database → Supabase (5 min)
- [ ] Connect frontend to backend (10 min)
- [ ] Test P2P connection (10 min)

### **Day 2: Add Features**
- [ ] Add voice commands
- [ ] Add transcription
- [ ] Add notes storage

---

## 9️⃣ COST CALCULATOR

```python
# Calculate your actual costs

def calculate_meeting_cost(num_meetings, avg_participants, avg_duration_min):
    """Calculate monthly infrastructure cost"""
    
    # If using Livekit Cloud
    participant_minutes = num_meetings * avg_participants * avg_duration_min
    livekit_cost = participant_minutes * 0.005
    
    # Other services
    supabase_cost = 10  # Paid tier
    railway_cost = 10   # Signaling server
    
    total = livekit_cost + supabase_cost + railway_cost
    
    return {
        "livekit": livekit_cost,
        "supabase": supabase_cost,
        "railway": railway_cost,
        "total": total,
        "per_meeting": total / num_meetings if num_meetings > 0 else 0
    }

# Examples:
# 50 meetings/month, 4 people, 30 min each
cost = calculate_meeting_cost(50, 4, 30)
# Output: $17.50/month ($0.35 per meeting)

# 10 meetings/month, 2 people, 20 min each
cost = calculate_meeting_cost(10, 2, 20)
# Output: $10.67/month ($1.07 per meeting)

# Free tier (first month):
cost = calculate_meeting_cost(100, 3, 15)
# Output: $20.50 (once you hit limits, upgrade)
```

---

## 🔟 BANDWIDTH COSTS

### **If Self-Hosting (Important to Know)**
```
P2P: No bandwidth cost (direct between peers)
Signaling Server: ~1KB per SDP exchange = negligible
Database: ~1MB per 1000 messages

Self-hosted Livekit (on Railway):
├─ Incoming: $0.10/GB
├─ Outgoing: $0.10/GB
├─ For 100 meetings (4 people, 30 min): ~500GB = $50
└─ Not economical, use cloud version instead

Recommendation: Use Livekit Cloud instead
├─ $0.005 per participant-minute
├─ Same 100 meetings: ~600K minutes = $3000
└─ Actually Livekit Cloud might be expensive too for scale
```

---

## 🎯 FINAL RECOMMENDATION

### **Phase 1 (MVP - 6 Weeks): $0/month**
```
Architecture:
Frontend (Vercel) → Signaling (Railway free) → P2P (PeerJS)
                                            ↓
                                      Database (Supabase free)

Setup: ~2 hours
Cost: $0
Supports: 20-30 concurrent meetings
```

### **Phase 2 (After Validation): $20/month**
```
If you get users:
Upgrade Railway to paid ($10)
Upgrade Supabase to paid ($10)
Everything else same

Supports: 50+ concurrent meetings
```

### **Phase 3 (Scale): $50-200/month**
```
Move to Livekit Cloud
Auto-scaling backend
Premium support

Supports: Unlimited
Cost scales with usage
```

---

## ✅ QUICK ANSWERS

**Q: No server at all?**
```
A: P2P (PeerJS) with just a simple signaling server
   - Server doesn't see video/audio
   - Only helps peers find each other
   - Minimal bandwidth
```

**Q: Truly free?**
```
A: Yes for MVP:
   - Vercel (free forever)
   - Railway (500 hours free = 2 weeks 24/7)
   - Supabase (free tier)
   - PeerJS (open source)
```

**Q: What about large meetings?**
```
A: For 50+ people, use Livekit Cloud (~$0.005/min)
   Or self-host Livekit on $10/month server
```

**Q: Video/audio quality?**
```
A: Same as Zoom/Google Meet
   WebRTC is the same technology they use
```

**Q: Storage for recordings?**
```
A: S3/B2 = $0.10/GB (~$1 per hour of video)
   Or just store transcripts (free)
```

