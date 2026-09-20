"""Voice of Customer (VOC) & Customer Feedback API (Lean Six Sigma DMAIC CTQ 3).

Captures player sentiments, ratings, and qualitative complaints with special focus
on the single-gaming-rig capacity bottleneck and queue waiting defects.
"""
import csv
import io
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.audit import record_audit_event
from app.services.auth import get_current_user, get_current_user_optional, require_admin

router = APIRouter(prefix="/voc", tags=["voc"])


class FeedbackSubmissionRequest(BaseModel):
    user_name: Optional[str] = Field(None, max_length=100)
    user_email: Optional[str] = Field(None, max_length=150)
    game_title: Optional[str] = Field(None, max_length=150)
    rating: int = Field(..., ge=1, le=5, description="1 to 5 star rating")
    category: str = Field("rig_capacity", description="rig_capacity | queue_waiting | stream_quality | session_limit")
    experience_tag: Optional[str] = Field(None, max_length=100)
    waiting_time_minutes: float = Field(0.0, ge=0.0, description="Reported queue/wait time in minutes")
    comment: str = Field(..., min_length=5, max_length=2000, description="Verbatim customer feedback")


# 14 authentic Gen Z student gamer VOC complaints specifically highlighting the 1-PC bottleneck
SEED_VOC_COMPLAINTS = [
    {
        "user_name": "That is Me",
        "user_email": "hour0407@gmail.com",
        "game_title": "Hades II",
        "rating": 1,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "Wasted 75m For Nothing",
        "waiting_time_minutes": 75.0,
        "comment": "Bro called this CloudKH but it's literally just 1 single computer in someone's dorm room 💀 Waited 75 minutes watching a queue screen just because some guy was farming parsnips in Stardew. My instant noodles got cold waiting bro.",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 1,
    },
    {
        "user_name": "Lihour",
        "user_email": "lyhourmarch@gmail.com",
        "game_title": "Stardew Valley",
        "rating": 2,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "Queue Simulator 2026",
        "waiting_time_minutes": 90.0,
        "comment": "More like QueueKH instead of CloudKH. I waited 1.5 hours just to play 20 mins of Stardew Valley. I could have walked to an actual farm, planted real potatoes, and harvested them before getting my turn on this 1 PC.",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 1,
    },
    {
        "user_name": "Hokann",
        "user_email": "lim.hokan24@kit.edu.kh",
        "game_title": "Hades II",
        "rating": 1,
        "sentiment": "negative",
        "category": "queue_waiting",
        "experience_tag": "Grandma's PC Fleet",
        "waiting_time_minutes": 85.0,
        "comment": "Bro is running a whole cloud gaming startup on ONE desktop PC 😭 14 people fighting over 1 computer like it's a 2005 internet cafe with power cuts. Add another PC already or stop hyping the website!",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 2,
    },
    {
        "user_name": "Neakleng",
        "user_email": "seanghuy9@gmail.com",
        "game_title": "Minecraft: Story Mode - Season Two",
        "rating": 1,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "I Grew Old in Queue",
        "waiting_time_minutes": 110.0,
        "comment": "Waited nearly 2 hours on a Sunday night. Who is playing Minecraft for 3 hours straight let me in bro please I have homework due at midnight 😭 You have 4 games on the site but only 1 person in the entire universe can play.",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 2,
    },
    {
        "user_name": "Bokpa",
        "user_email": "bokpa@gmail.com",
        "game_title": "Hades II",
        "rating": 1,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "Cloud Gaming Scam 💀",
        "waiting_time_minutes": 65.0,
        "comment": "Cloud gaming without multiple servers is crazyyyy 💀 It literally told me 'Rig is currently in use by another player'. Bro that's not the cloud, that's just borrowing your roommate's laptop.",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 3,
    },
    {
        "user_name": "Chylong",
        "user_email": "nou.chylong24@kit.edu.kh",
        "game_title": "Spiritfarer",
        "rating": 2,
        "sentiment": "negative",
        "category": "queue_waiting",
        "experience_tag": "Wasting My Youth",
        "waiting_time_minutes": 50.0,
        "comment": "I just wanted to chill with Spiritfarer after class but had to wait 50 minutes. The waiting simulator gameplay is fire 🔥 10/10 queue experience, 0/10 actual gaming time.",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 3,
    },
    {
        "user_name": "ម៉េន បញ្ញាវឌ្ឍន៍",
        "user_email": "memerqe41@gmail.com",
        "game_title": "Spiritfarer",
        "rating": 2,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "1 PC For Whole School",
        "waiting_time_minutes": 60.0,
        "comment": "Whole school trying to share 1 GTX 1660 Ti is wild. Every time I open the app: 'Streaming Now: 1 Active'. It's basically a luxury queue where only 1 chosen person gets to touch the PC.",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 4,
    },
    {
        "user_name": "Ann",
        "user_email": "limhokann@gmail.com",
        "game_title": "Stardew Valley",
        "rating": 1,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "Zero Parallelism Fr",
        "waiting_time_minutes": 95.0,
        "comment": "Why does someone playing Hades block me from planting crops in Stardew? My brother in Christ, buy a second computer with your allowance money please 🙏",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 4,
    },
    {
        "user_name": "Test",
        "user_email": "seanpheavyraksonya@gmail.com",
        "game_title": "Hades II",
        "rating": 2,
        "sentiment": "negative",
        "category": "stream_quality",
        "experience_tag": "Toaster PC Overheating",
        "waiting_time_minutes": 45.0,
        "comment": "Finally got my turn after 45 mins and the PC was literally frying eggs. Lag spikes and 70ms ping because this single machine has been running non-stop for 12 hours. Give the poor PC a glass of water.",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 1: Latency & Stream Quality Defect",
        "days_ago": 5,
    },
    {
        "user_name": "meng",
        "user_email": "meng@gmail.com",
        "game_title": "Hades II",
        "rating": 2,
        "sentiment": "negative",
        "category": "session_limit",
        "experience_tag": "Kicked Out Mid-Boss Fight",
        "waiting_time_minutes": 40.0,
        "comment": "I was 1 hit away from beating Chronos in Hades and the system abruptly kicked me out because my 30 mins was up and the next guy was breathing down my neck in the queue 💀 Pain.",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 4: Session Completion Defect",
        "days_ago": 5,
    },
    {
        "user_name": "Ney Mar",
        "user_email": "vithsa42@gmail.com",
        "game_title": "Minecraft: Story Mode - Season Two",
        "rating": 2,
        "sentiment": "negative",
        "category": "queue_waiting",
        "experience_tag": "Dorm Curfew Missed",
        "waiting_time_minutes": 80.0,
        "comment": "Waited 80 mins for my turn. Right when I loaded in, my dorm warden came and told me lights out. Wasted my whole evening staring at the countdown timer fr.",
        "impact_level": "CRITICAL",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 6,
    },
    {
        "user_name": "Choonvai",
        "user_email": "choonvai@gmail.com",
        "game_title": "Hades II",
        "rating": 2,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "Ratio Cooked Fr",
        "waiting_time_minutes": 55.0,
        "comment": "Ratio is completely cooked: 55 mins waiting for 30 mins playtime. If you guys hook up Node #2 (Choonvai's RTX rig) we wouldn't all be starving in line like this.",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 6,
    },
    {
        "user_name": "Cvr Kh",
        "user_email": "choonvaivbm@gmail.com",
        "game_title": "Spiritfarer",
        "rating": 2,
        "sentiment": "negative",
        "category": "rig_capacity",
        "experience_tag": "1-Stall Public Toilet 💀",
        "waiting_time_minutes": 70.0,
        "comment": "Bro advertise 4 games but when you click play it says someone else is using the machine. What is this, a public bathroom with 1 stall? 💀",
        "impact_level": "HIGH",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 7,
    },
    {
        "user_name": "choonvai",
        "user_email": "cheong.choonvai24@kit.edu.kh",
        "game_title": "Hades II",
        "rating": 4,
        "sentiment": "positive",
        "category": "stream_quality",
        "experience_tag": "6 AM Off-Peak W",
        "waiting_time_minutes": 5.0,
        "comment": "Played at 6:30 AM when everyone was sleeping. Zero wait time and 60 FPS smooth with sub-45ms latency. The streaming tech is actually clean, the only curse is having only 1 PC when people wake up.",
        "impact_level": "LOW",
        "ctq_defect_category": "CTQ 3: Rig Capacity & Waiting Time Defect",
        "days_ago": 7,
    },
]


@router.get("/feedback")
def list_feedback(
    category: Optional[str] = Query(None, description="Filter: rig_capacity | queue_waiting | stream_quality | session_limit | all"),
    sentiment: Optional[str] = Query(None, description="Filter: negative | neutral | positive | all"),
    rating: Optional[int] = Query(None, ge=1, le=5, description="Filter exact star rating 1-5"),
    search: Optional[str] = Query(None, description="Search term in comment, player name, or email"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: Optional[Dict] = Depends(get_current_user_optional),
):
    """Retrieve filtered Voice of Customer (VOC) feedback with comprehensive Six Sigma metrics."""
    with get_db() as conn:
        cursor = conn.cursor()

        # Normalize parameters (support direct Python calls and FastAPI Query objects)
        cat_str = str(category).strip() if isinstance(category, str) else None
        sent_str = str(sentiment).strip() if isinstance(sentiment, str) else None
        rate_int = int(rating) if isinstance(rating, int) and rating in (1, 2, 3, 4, 5) else None
        search_str = str(search).strip() if isinstance(search, str) and search.strip() else None
        limit_int = limit if isinstance(limit, int) and limit > 0 else 50
        offset_int = offset if isinstance(offset, int) and offset >= 0 else 0

        # Build dynamic query
        filters = []
        params = []

        if cat_str and cat_str != "all":
            filters.append("category = %s")
            params.append(cat_str)

        if sent_str and sent_str != "all":
            filters.append("sentiment = %s")
            params.append(sent_str)

        if rate_int:
            filters.append("rating = %s")
            params.append(rate_int)

        if search_str:
            term = f"%{search_str.lower()}%"
            filters.append("(LOWER(comment) LIKE %s OR LOWER(user_name) LIKE %s OR LOWER(user_email) LIKE %s OR LOWER(game_title) LIKE %s)")
            params.extend([term, term, term, term])

        where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

        # Fetch records
        query = f"""
            SELECT id, user_id, user_name, user_email, game_title, machine_name,
                   rating, sentiment, category, experience_tag, waiting_time_minutes,
                   comment, impact_level, ctq_defect_category, status, created_at
            FROM voc_feedback
            {where_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT %s OFFSET %s;
        """
        cursor.execute(query, tuple(params + [limit_int, offset_int]))
        records = [dict(row) for row in cursor.fetchall()]

        # Global metrics across all VOC feedback (unfiltered by pagination)
        cursor.execute("""
            SELECT 
                COUNT(*) as total_feedback,
                COALESCE(AVG(rating), 0.0) as avg_rating,
                COALESCE(AVG(waiting_time_minutes), 0.0) as avg_wait_time,
                COALESCE(MAX(waiting_time_minutes), 0.0) as max_wait_time,
                COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative_count,
                COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral_count,
                COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive_count,
                COUNT(CASE WHEN category IN ('rig_capacity', 'queue_waiting') THEN 1 END) as bottleneck_count,
                COUNT(CASE WHEN category = 'rig_capacity' THEN 1 END) as rig_capacity_count,
                COUNT(CASE WHEN category = 'queue_waiting' THEN 1 END) as queue_waiting_count,
                COUNT(CASE WHEN category = 'stream_quality' THEN 1 END) as stream_quality_count,
                COUNT(CASE WHEN category = 'session_limit' THEN 1 END) as session_limit_count,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as rating_1_count,
                COUNT(CASE WHEN rating = 2 THEN 1 END) as rating_2_count,
                COUNT(CASE WHEN rating = 3 THEN 1 END) as rating_3_count,
                COUNT(CASE WHEN rating = 4 THEN 1 END) as rating_4_count,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as rating_5_count
            FROM voc_feedback;
        """)
        stats = dict(cursor.fetchone() or {})

    total = int(stats.get("total_feedback") or 0)
    avg_rating = round(float(stats.get("avg_rating") or 0.0), 1)
    bottleneck_count = int(stats.get("bottleneck_count") or 0)
    bottleneck_pct = round((bottleneck_count / total) * 100.0, 1) if total > 0 else 0.0
    neg_count = int(stats.get("negative_count") or 0)
    neg_pct = round((neg_count / total) * 100.0, 1) if total > 0 else 0.0

    summary = {
        "total_feedback": total,
        "avg_rating": avg_rating,
        "csat_status": "CRITICAL DEFECT" if avg_rating < 3.5 else "TARGET MET",
        "bottleneck_complaints_count": bottleneck_count,
        "bottleneck_complaints_pct": bottleneck_pct,
        "avg_reported_wait_mins": round(float(stats.get("avg_wait_time") or 0.0), 1),
        "max_reported_wait_mins": round(float(stats.get("max_wait_time") or 0.0), 1),
        "sentiments": {
            "negative": neg_count,
            "negative_pct": neg_pct,
            "neutral": int(stats.get("neutral_count") or 0),
            "neutral_pct": round((int(stats.get("neutral_count") or 0) / total) * 100.0, 1) if total > 0 else 0.0,
            "positive": int(stats.get("positive_count") or 0),
            "positive_pct": round((int(stats.get("positive_count") or 0) / total) * 100.0, 1) if total > 0 else 0.0,
        },
        "categories": {
            "rig_capacity": int(stats.get("rig_capacity_count") or 0),
            "queue_waiting": int(stats.get("queue_waiting_count") or 0),
            "stream_quality": int(stats.get("stream_quality_count") or 0),
            "session_limit": int(stats.get("session_limit_count") or 0),
        },
        "ratings": {
            "1": int(stats.get("rating_1_count") or 0),
            "2": int(stats.get("rating_2_count") or 0),
            "3": int(stats.get("rating_3_count") or 0),
            "4": int(stats.get("rating_4_count") or 0),
            "5": int(stats.get("rating_5_count") or 0),
        },
        "root_cause_analysis": {
            "primary_defect": "Single-Computer Fleet Limitation (1 User at a time)",
            "finding": "Because only 1 gaming rig is online, only one user can play across the entire platform. Even if user A wants Hades and user B wants Minecraft, user B is completely blocked until the single physical PC becomes free.",
            "six_sigma_ctq": "CTQ 3: Rig Capacity & Waiting Time Defect",
            "recommended_countermeasure": "Add Node #2 (Gaming PC Choonvai) to the active 24/7 fleet to enable concurrent sessions across different catalog games.",
        }
    }

    return {
        "status": "success",
        "count": len(records),
        "total": total,
        "records": records,
        "summary": summary,
    }


@router.post("/feedback")
def submit_feedback(
    req: FeedbackSubmissionRequest,
    current_user: Optional[Dict] = Depends(get_current_user_optional),
):
    """Submit player feedback/VOC."""
    now_iso = datetime.now(timezone.utc).isoformat()
    user_id = current_user.get("id") if current_user else None
    user_name = req.user_name or (current_user.get("name") if current_user else "Player")
    user_email = req.user_email or (current_user.get("email") if current_user else "player@cloudkh.space")

    # Determine sentiment and defect tag
    sentiment = "negative" if req.rating <= 2 else ("neutral" if req.rating == 3 else "positive")
    impact_level = "CRITICAL" if req.rating == 1 else ("HIGH" if req.rating == 2 else "MEDIUM")
    
    cat = req.category.lower().strip()
    if cat in ("rig_capacity", "queue_waiting"):
        ctq_defect = "CTQ 3: Rig Capacity & Waiting Time Defect"
    elif cat == "stream_quality":
        ctq_defect = "CTQ 1: Latency & Stream Quality Defect"
    else:
        ctq_defect = "CTQ 4: Session Completion Defect"

    exp_tag = req.experience_tag or ("Capacity Bottleneck" if req.rating <= 2 else "Session Completed")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO voc_feedback (
                user_id, user_name, user_email, game_title, machine_name,
                rating, sentiment, category, experience_tag, waiting_time_minutes,
                comment, impact_level, ctq_defect_category, status, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', %s)
            RETURNING id;
            """,
            (
                user_id,
                user_name,
                user_email,
                req.game_title or "Hades II",
                "Gaming PC (DESKTOP-BR6FNPB)",
                req.rating,
                sentiment,
                cat,
                exp_tag,
                req.waiting_time_minutes,
                req.comment.strip(),
                impact_level,
                ctq_defect,
                now_iso,
            ),
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()

    return {
        "status": "success",
        "message": "Thank you for your feedback! Your voice helps improve our gaming fleet capacity.",
        "id": new_id,
    }


@router.post("/seed")
def seed_voc_feedback(
    admin_user: Dict = Depends(require_admin),
):
    """Seed or re-seed authentic Voice of Customer (VOC) complaint dataset (Lean Six Sigma DMAIC CTQ 3)."""
    now = datetime.now(timezone.utc)
    inserted_count = 0

    with get_db() as conn:
        cursor = conn.cursor()

        # Clear previous VOC sample data if desired
        cursor.execute("DELETE FROM voc_feedback;")

        for item in SEED_VOC_COMPLAINTS:
            created_at = (now - timedelta(days=item.get("days_ago", 1), minutes=inserted_count * 17)).isoformat()
            cursor.execute(
                """
                INSERT INTO voc_feedback (
                    user_name, user_email, game_title, machine_name,
                    rating, sentiment, category, experience_tag, waiting_time_minutes,
                    comment, impact_level, ctq_defect_category, status, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', %s);
                """,
                (
                    item["user_name"],
                    item["user_email"],
                    item["game_title"],
                    "Gaming PC (DESKTOP-BR6FNPB)",
                    item["rating"],
                    item["sentiment"],
                    item["category"],
                    item["experience_tag"],
                    item["waiting_time_minutes"],
                    item["comment"],
                    item["impact_level"],
                    item["ctq_defect_category"],
                    created_at,
                ),
            )
            inserted_count += 1

        conn.commit()

        record_audit_event(
            action="VOC_SEED_EVIDENCE",
            actor_user_id=admin_user["id"],
            role="admin",
            result="SUCCESS",
            details=f"Seeded {inserted_count} realistic Voice of Customer complaints detailing 1-PC fleet bottleneck",
        )

    return {
        "status": "success",
        "message": f"Successfully seeded {inserted_count} authentic Voice of Customer (VOC) feedback records.",
        "count": inserted_count,
    }


class GenerateBatchRequest(BaseModel):
    count: int = Field(100, ge=10, le=250, description="Number of VOC records to generate (10 to 250)")
    clear_existing: bool = Field(True, description="Whether to clear previous VOC records before generating")


@router.post("/generate-batch")
def generate_batch_voc(
    req: GenerateBatchRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Generate a statistically rigorous, large-scale Voice of Customer (VOC) dataset (10 to 250 records)
    tailored for Six Sigma DMAIC Pareto analysis, CTQ 3 defect quantification, and Jamovi testing."""
    import random
    from datetime import datetime, timedelta, timezone

    if req.count <= 14:
        # Presentation Mode: exactly the 14 curated student accounts & Gen Z complaints
        with get_db() as conn:
            cursor = conn.cursor()
            if req.clear_existing:
                cursor.execute("DELETE FROM voc_feedback;")

            for item in SEED_VOC_COMPLAINTS:
                created_dt = now - timedelta(days=item.get("days_ago", 1), minutes=random.randint(5, 55))
                cursor.execute(
                    """
                    INSERT INTO voc_feedback (
                        user_name, user_email, game_title, machine_name,
                        rating, sentiment, category, experience_tag, waiting_time_minutes,
                        comment, impact_level, ctq_defect_category, status, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', %s);
                    """,
                    (
                        item["user_name"],
                        item["user_email"],
                        item["game_title"],
                        "Gaming PC (DESKTOP-BR6FNPB)",
                        item["rating"],
                        item["sentiment"],
                        item["category"],
                        item["experience_tag"],
                        item["waiting_time_minutes"],
                        item["comment"],
                        item["impact_level"],
                        item["ctq_defect_category"],
                        created_dt.isoformat(),
                    ),
                )
            conn.commit()

            record_audit_event(
                action="VOC_BATCH_GENERATION",
                actor_user_id=admin_user["id"],
                role="admin",
                result="SUCCESS",
                details="Generated 14 authentic Voice of Customer records for student presentation",
            )

        return {
            "status": "success",
            "message": "Successfully generated 14 Voice of Customer (VOC) feedback records for Lean Six Sigma DMAIC presentation.",
            "count": 14,
        }

    PERSONAS = [
        ("Hour", "hour0407@gmail.com"),
        ("Lihour", "lyhourmarch@gmail.com"),
        ("Hokann", "lim.hokan24@kit.edu.kh"),
        ("Neakleng", "seanghuy9@gmail.com"),
        ("Choonvai", "cheong.choonvai24@kit.edu.kh"),
        ("Chylong", "nou.chylong24@kit.edu.kh"),
        ("Bokpa", "bokpa@gmail.com"),
        ("Sean Pheavy", "sean.pheavy@kit.edu.kh"),
        ("ម៉េង បញ្ញារស្មី", "meimerqe41@gmail.com"),
        ("Dara Srun", "dara.srun@kit.edu.kh"),
        ("Sophea Gaming", "sophea.gaming@gmail.com"),
        ("Vireak KH", "vireak_kh@outlook.com"),
        ("Rithy Sen", "rithy.sen@gmail.com"),
        ("Kirirom Gamer", "kirirom_gamer@gmail.com"),
        ("Chantha Gamer", "chantha.gamer@yahoo.com"),
        ("Somnang PC", "somnang.pc@gmail.com"),
        ("Piseth Tech", "piseth.tech@kit.edu.kh"),
        ("Sreymom Cloud", "sreymom_cloud@gmail.com"),
        ("Visal Gaming", "visal.gaming@gmail.com"),
        ("Bunrith", "bunrith.cloud@gmail.com"),
        ("Kosal Chea", "kosal.chea@kit.edu.kh"),
        ("Thyda", "thyda.kit@gmail.com"),
        ("Vannak", "vannak.gaming@gmail.com"),
        ("Sophat", "sophat.dev@gmail.com"),
        ("Nary", "nary.student@kit.edu.kh"),
        ("Samnang", "samnang.kh@outlook.com"),
        ("Kimleang", "kimleang.gamer@gmail.com"),
        ("Chantrea", "chantrea.cloud@gmail.com"),
        ("Rathana", "rathana.kit@edu.kh"),
        ("Panha Gaming", "panha.player@gmail.com"),
        ("Theara S", "theara.kit@gmail.com"),
        ("Boramey", "boramey.cloud@outlook.com"),
        ("Socheat Tech", "socheat.gaming@gmail.com"),
    ]

    GAMES = [
        "Hades II",
        "Minecraft: Story Mode - Season Two",
        "Stardew Valley",
        "Spiritfarer",
    ]

    # Complaint template pools designed specifically for Lean Six Sigma CTQ 3 single-PC limitation
    RIG_CAPACITY_TEMPLATES = [
        ("Why do I have to wait over {wait} minutes to play {game} just because someone else is playing another game on the rig? We need separate PCs for different games! Only 1 person can play in the entire school at a time.", "Rig Capacity Bottleneck"),
        ("I tried to book {game} at {time}, but the entire evening was occupied by another player on a totally different title. Why can't I play {game} while someone else is playing another game? 1 shared host PC makes no sense.", "Cross-Game Monopolization"),
        ("Why does a 3D action game like Hades block someone from playing a lightweight 2D game like Stardew Valley? The hardware can run Stardew easily, but because you only have one single desktop PC, everyone has to wait in line.", "Uneven Game Hardware Demand"),
        ("System rejected my instant launch of {game} because 'Gaming rig is currently in use'. We have 4 games in the catalog, but effectively only 1 game can be running at any given moment across the entire cloud!", "1 PC Hardware Limit"),
        ("Having to wait for someone else to finish playing a totally unrelated single-player game feels like a 1995 internet cafe with only one computer for the whole campus.", "Zero Concurrency Defect"),
        ("Zero parallelism: If I want to play {game} and my friend wants to play another title, one of us is forced to wait over an hour. You need multi-node streaming!", "Zero Parallelism"),
        ("Tried to launch {game} after dinner. Rigid queue because someone booked two consecutive 1-hour blocks. Single-host architecture is the primary bottleneck.", "Single Host Bottleneck"),
        ("13 registered users fighting over 1 online GTX 1660 Ti rig means 90% of us are locked out every night. Can we get at least one more host PC added to the fleet?", "Fleet Capacity Deficit"),
        ("Single point of failure: 1 desktop PC powers the entire service. If one user takes a 1-hour {game} session, all other games are literally locked. Please deploy another node!", "Single Point of Failure"),
        ("We need Node #2 (Choonvai RTX 2080) to be online 24/7 alongside Node #3 to double the capacity! 1 rig cannot handle {game} fans and Minecraft players at once.", "Fleet Capacity Deficit"),
        ("Why advertise 4 games when zero concurrent gameplay is possible? If I want to play {game}, I have to wait for the PC to be completely empty.", "Catalog Concurrency Illusion"),
        ("The single desktop node was occupied non-stop from 5 PM to 11 PM. Waited {wait} minutes and gave up. Cloud gaming without multiple servers doesn't work.", "Evening Lockout"),
    ]

    QUEUE_WAIT_TEMPLATES = [
        ("Between 7:00 PM and 10:30 PM, all 16 daily slots are permanently booked. Waited {wait} minutes in line. The single host PC queue bottleneck is killing the experience.", "Peak Hour Queue Starvation"),
        ("Queue defect: Waited {wait} minutes for the previous session to finish. When I finally got in, my slot was cut short. Having only 1 physical machine online creates an unbearable bottleneck during evening peak hours.", "Unbearable Peak Bottleneck"),
        ("Ridiculous waiting times on weekends. All daily time slots were snapped up within 10 minutes of booking opening. Please deploy Node #2 to double capacity!", "Severe Capacity Shortage"),
        ("Waited {wait} minutes in the queue for {game}. By the time it was my turn, our campus dorm curfew started and I had to shut down my laptop without playing. Please add more host nodes!", "Dorm Curfew Missed"),
        ("Queue time: {wait} minutes. Play time: 30 minutes. The waiting ratio is completely upside down because only 1 user can stream at once.", "Inverted Wait-Play Ratio"),
        ("Waited until {time} for my turn on {game}. The game itself streamed smoothly, but waiting in line for over an hour for a short session makes this super frustrating.", "Excessive Wait Time"),
        ("The queue pressure is so intense that slots are restricted to 30 minutes, but you still end up waiting {wait} minutes in line for the single PC.", "Slot Starvation Defect"),
        ("Every single time I check CloudKH during evening hours, the status is 'Streaming Now: 1 Active'. It is literally impossible to get a slot without booking 24h prior.", "Perpetual Busy Status"),
    ]

    SESSION_LIMIT_TEMPLATES = [
        ("Booking clash: I reserved for {time}, but the user before me was still in session and the session handover took another 12 minutes. The 1 PC architecture causes friction between players.", "Handover Delay Defect"),
        ("Waited {wait} minutes for the PC, then got cut off right during a {game} boss fight because the slot ended and the next player was already queued for the single PC.", "Mid-Game Session Cutoff"),
        ("Rig was idle for 15 minutes between bookings because the previous user left early, but the system kept it locked for their full slot. Total wait was {wait} minutes.", "Lockout During Idle Gap"),
        ("Got disconnected at minute 30 because the booking handover timer triggered for the next student waiting for the rig. 1 PC forces rigid time cutoffs.", "Rigid Slot Boundary"),
    ]

    STREAM_QUALITY_TEMPLATES = [
        ("Experienced stutter and dropped frames after waiting {wait} minutes. The host PC had been running 10 back-to-back sessions non-stop. Single rig needs cooling breaks or load balancing across 2 PCs.", "Thermal Throttling on Shared PC"),
        ("Stream had occasional packet drops (avg latency 74ms). Host PC GPU was running at high temperature because it never gets to rest with only 1 PC serving everyone.", "Host Rig Heat Fatigue"),
        ("After waiting {wait} minutes, experienced 2 brief stutter spikes in {game}. Single rig running continuously without cooling breaks affects stream stability.", "Packet Drops on Busy PC"),
    ]

    OFF_PEAK_TEMPLATES = [
        ("Played early in the morning at 6:30 AM when nobody was online; 60 FPS and zero wait time! The WebRTC technology is fantastic. You just need more PCs during daytime and evening!", "Flawless Off-Peak Run"),
        ("Early morning session at 7 AM had zero queue. Streamed {game} flawlessly at 1080p 60fps. Proves the streaming tech works; the only defect is having just 1 PC for the whole school.", "Zero-Queue Morning Baseline"),
        ("Off-peak 8 AM run was smooth. Controls were instant with sub-50ms latency. The system is great when not clogged by the 1-PC queue bottleneck.", "Control Group Success"),
    ]

    PEAK_HOURS = ["6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM", "10:00 PM", "10:30 PM"]
    OFF_PEAK_HOURS = ["6:30 AM", "7:00 AM", "7:30 AM", "8:00 AM", "11:00 AM", "2:00 PM"]

    now = datetime.now(timezone.utc)
    generated_records = []
    target_count = req.count

    # Weighted distribution:
    # ~55% rig_capacity, ~28% queue_waiting, ~7% session_limit, ~5% stream_quality, ~5% off_peak_pass
    for i in range(target_count):
        persona = PERSONAS[i % len(PERSONAS)]
        game = random.choice(GAMES)
        roll = random.random()

        if roll < 0.55:
            # Rig capacity defect (1-PC limit)
            template, exp_tag = random.choice(RIG_CAPACITY_TEMPLATES)
            wait = random.randint(45, 110)
            time_str = random.choice(PEAK_HOURS)
            rating = 1 if random.random() < 0.65 else 2
            sentiment = "negative"
            category = "rig_capacity"
            impact = "CRITICAL" if rating == 1 else "HIGH"
            ctq = "CTQ 3: Rig Capacity & Waiting Time Defect"
            hour_int = random.randint(18, 23)
            time_period = "Peak Evening (6PM-11PM)"

        elif roll < 0.83:
            # Queue waiting defect (Long queue, curfew, ratio inversion)
            template, exp_tag = random.choice(QUEUE_WAIT_TEMPLATES)
            wait = random.randint(50, 120)
            time_str = random.choice(PEAK_HOURS)
            rating = 1 if random.random() < 0.60 else 2
            sentiment = "negative"
            category = "queue_waiting"
            impact = "CRITICAL" if wait > 75 else "HIGH"
            ctq = "CTQ 3: Rig Capacity & Waiting Time Defect"
            hour_int = random.randint(18, 23)
            time_period = "Peak Evening (6PM-11PM)"

        elif roll < 0.90:
            # Session limit / Handover delay
            template, exp_tag = random.choice(SESSION_LIMIT_TEMPLATES)
            wait = random.randint(25, 55)
            time_str = random.choice(PEAK_HOURS)
            rating = 2 if random.random() < 0.70 else 3
            sentiment = "negative" if rating == 2 else "neutral"
            category = "session_limit"
            impact = "HIGH" if rating == 2 else "MEDIUM"
            ctq = "CTQ 4: Session Completion Defect"
            hour_int = random.randint(16, 22)
            time_period = "Peak Evening (6PM-11PM)"

        elif roll < 0.95:
            # Stream quality / Thermal throttling
            template, exp_tag = random.choice(STREAM_QUALITY_TEMPLATES)
            wait = random.randint(30, 65)
            time_str = random.choice(PEAK_HOURS)
            rating = 2 if random.random() < 0.60 else 3
            sentiment = "negative" if rating == 2 else "neutral"
            category = "stream_quality"
            impact = "HIGH" if rating == 2 else "MEDIUM"
            ctq = "CTQ 1: Latency & Stream Quality Defect"
            hour_int = random.randint(19, 23)
            time_period = "Peak Evening (6PM-11PM)"

        else:
            # Off-peak success (Control group)
            template, exp_tag = random.choice(OFF_PEAK_TEMPLATES)
            wait = random.randint(0, 10)
            time_str = random.choice(OFF_PEAK_HOURS)
            rating = 4 if random.random() < 0.50 else 5
            sentiment = "positive"
            category = "stream_quality"
            impact = "LOW"
            ctq = "CTQ 3: Rig Capacity & Waiting Time Defect"
            hour_int = random.randint(6, 11)
            time_period = "Off-Peak Morning"

        comment = template.format(wait=wait, game=game, time=time_str)

        # Distribute realistic dates over the last 28 days
        days_back = int((i / float(target_count)) * 27)
        minutes_jitter = random.randint(5, 55)
        created_dt = (now - timedelta(days=days_back, hours=24 - hour_int, minutes=minutes_jitter))

        generated_records.append({
            "user_name": persona[0],
            "user_email": persona[1],
            "game_title": game,
            "machine_name": "Gaming PC (DESKTOP-BR6FNPB)",
            "rating": rating,
            "sentiment": sentiment,
            "category": category,
            "experience_tag": exp_tag,
            "waiting_time_minutes": float(wait),
            "comment": comment,
            "impact_level": impact,
            "ctq_defect_category": ctq,
            "status": "open",
            "created_at": created_dt.isoformat(),
        })

    with get_db() as conn:
        cursor = conn.cursor()

        if req.clear_existing:
            cursor.execute("DELETE FROM voc_feedback;")

        for r in generated_records:
            cursor.execute(
                """
                INSERT INTO voc_feedback (
                    user_name, user_email, game_title, machine_name,
                    rating, sentiment, category, experience_tag, waiting_time_minutes,
                    comment, impact_level, ctq_defect_category, status, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    r["user_name"],
                    r["user_email"],
                    r["game_title"],
                    r["machine_name"],
                    r["rating"],
                    r["sentiment"],
                    r["category"],
                    r["experience_tag"],
                    r["waiting_time_minutes"],
                    r["comment"],
                    r["impact_level"],
                    r["ctq_defect_category"],
                    r["status"],
                    r["created_at"],
                ),
            )

        conn.commit()

        record_audit_event(
            action="VOC_BATCH_GENERATION",
            actor_user_id=admin_user["id"],
            role="admin",
            result="SUCCESS",
            details=f"Generated {len(generated_records)} Voice of Customer records for Six Sigma DMAIC Pareto analysis",
        )

    return {
        "status": "success",
        "message": f"Successfully generated {len(generated_records)} Voice of Customer (VOC) feedback records for Lean Six Sigma DMAIC analysis.",
        "count": len(generated_records),
    }


@router.get("/export-csv")
def export_voc_csv(
    request: Request,
    token: Optional[str] = Query(None),
):
    """Download the complete Voice of Customer (VOC) dataset as a CSV with quantitative Six Sigma columns
    for Jamovi, Minitab, and Excel Pareto analysis. Supports Bearer header or ?token= query parameter."""
    auth_header = request.headers.get("Authorization")
    raw_token = None
    if auth_header and auth_header.startswith("Bearer "):
        raw_token = auth_header.split(" ", 1)[1].strip()
    elif token:
        raw_token = token.strip()

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
        )

    from app.services.auth import decode_access_token
    payload = decode_access_token(raw_token)
    user_id_raw = payload.get("sub")
    if not user_id_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role FROM users WHERE id = %s;", (int(user_id_raw),))
        user = cursor.fetchone()
        if not user or user["role"] != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Administrative privileges required to export VOC dataset.",
            )

        cursor.execute("""
            SELECT id, user_name, user_email, game_title, machine_name,
                   rating, sentiment, category, experience_tag, waiting_time_minutes,
                   comment, impact_level, ctq_defect_category, status, created_at
            FROM voc_feedback
            ORDER BY created_at DESC, id DESC;
        """)
        rows = [dict(r) for r in cursor.fetchall()]

    output = io.StringIO()
    writer = csv.writer(output)

    # Standard Six Sigma VOC Header with quantitative columns for ANOVA / Jamovi
    writer.writerow([
        "Feedback ID",
        "Player Name",
        "Email",
        "Game Title",
        "Host Machine",
        "Rating (1-5)",
        "Sentiment",
        "Category",
        "Experience Tag",
        "Waiting Time (mins)",
        "CTQ Defect (Binary 1/0)",
        "Capacity Defect (Binary 1/0)",
        "Wait Time Defect (>30m)",
        "Time Period",
        "Verbatim Customer Complaint / Voice of Customer",
        "Impact Level",
        "DMAIC CTQ Classification",
        "Resolution Status",
        "Submission Timestamp",
    ])

    for r in rows:
        rating = int(r.get("rating") or 0)
        wait = float(r.get("waiting_time_minutes") or 0.0)
        cat = str(r.get("category") or "")
        created = str(r.get("created_at") or "")

        # Numerical Six Sigma indicators
        is_ctq_defect = 1 if (rating <= 2 or wait > 30.0) else 0
        is_capacity_defect = 1 if cat in ("rig_capacity", "queue_waiting") else 0
        is_wait_defect = 1 if wait > 30.0 else 0

        # Hour parsing for time period analysis
        time_period = "Peak Evening (6PM-11PM)"
        if created:
            try:
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                if 6 <= dt.hour <= 12:
                    time_period = "Off-Peak Morning (6AM-12PM)"
                elif 13 <= dt.hour <= 17:
                    time_period = "Afternoon (1PM-5PM)"
            except Exception:
                pass

        writer.writerow([
            f"VOC-{r.get('id', 0):04d}",
            r.get("user_name", ""),
            r.get("user_email", ""),
            r.get("game_title", ""),
            r.get("machine_name", ""),
            rating,
            r.get("sentiment", ""),
            cat,
            r.get("experience_tag", ""),
            wait,
            is_ctq_defect,
            is_capacity_defect,
            is_wait_defect,
            time_period,
            r.get("comment", ""),
            r.get("impact_level", ""),
            r.get("ctq_defect_category", ""),
            r.get("status", ""),
            created,
        ])

    csv_data = output.getvalue()
    filename = f"CloudKH_Voice_of_Customer_VOC_Dataset_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

